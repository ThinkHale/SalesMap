// plugins/heatmap-overlay.js — Heatmap visualization plugin

const HeatmapOverlayPlugin = {
  id: 'heatmap-overlay',
  name: 'Heatmap Overlay',
  version: '1.0.0',
  description: 'Renders point layers as a density heatmap using the Google Maps visualization library.',
  author: 'SalesMapper',
  minAppVersion: '4.0.0',

  permissions: [
    'layers.read',
    'map.read',
    'map.write',
    'ui.toast',
    'ui.slot:toolbar',
    'ui.slot:sidebar-panel',
    'storage.read',
    'storage.write',
    'events.listen'
  ],

  configSchema: {
    gradient: {
      type: 'select',
      options: ['fire', 'cool', 'ocean', 'purple', 'heat', 'default'],
      default: 'fire',
      label: 'Color Gradient'
    },
    radius: {
      type: 'number',
      default: 30,
      min: 5,
      max: 120,
      label: 'Radius (px)'
    },
    opacity: {
      type: 'number',
      default: 0.7,
      min: 0.1,
      max: 1.0,
      label: 'Opacity'
    },
    maxIntensity: {
      type: 'number',
      default: 10,
      min: 1,
      max: 100,
      label: 'Max Intensity'
    }
  },

  _api: null,
  _heatmapLayer: null,
  _isActive: false,
  _controlBtn: null,
  _hiddenLayerIds: [],

  _gradients: {
    fire:    ['rgba(0,0,0,0)', 'rgba(255,0,0,0.6)', 'rgba(255,165,0,0.8)', 'rgba(255,255,0,1)'],
    cool:    ['rgba(0,0,0,0)', 'rgba(0,0,255,0.4)', 'rgba(0,255,255,0.6)', 'rgba(0,255,0,0.8)', 'rgba(255,255,0,1)'],
    ocean:   ['rgba(0,0,0,0)', 'rgba(0,0,139,0.4)', 'rgba(0,100,200,0.6)', 'rgba(0,191,255,0.8)', 'rgba(173,216,230,1)'],
    purple:  ['rgba(0,0,0,0)', 'rgba(128,0,128,0.4)', 'rgba(255,0,255,0.6)', 'rgba(255,128,255,0.8)', 'rgba(255,255,255,1)'],
    heat:    ['rgba(0,0,0,0)', 'rgba(0,0,255,0.3)', 'rgba(0,255,0,0.5)', 'rgba(255,255,0,0.7)', 'rgba(255,0,0,1)'],
    default: null
  },

  init(api) {
    this._api = api;
    this._hiddenLayerIds = [];

    // Migrate old default radius (20) to new default (30).
    const savedRadius = api.config.get('radius');
    if (savedRadius === 20 || savedRadius === 40) api.config.set('radius', 30);

    // Pre-load the visualization library so it's ready when the user clicks.
    if (typeof google !== 'undefined' && typeof google.maps.importLibrary === 'function') {
      google.maps.importLibrary('visualization').catch(() => {});
    }

    // Add toolbar button
    this._controlBtn = api.ui.addToolbarButton({
      label: '🌡',
      tooltip: 'Toggle Heatmap',
      onClick: () => this._toggle()
    });

    // Listen for layer changes to update heatmap
    api.events.on('layer.created', () => { if (this._isActive) this._refresh(); });
    api.events.on('layer.deleted', () => { if (this._isActive) this._refresh(); });
    api.events.on('features.added', () => { if (this._isActive) this._refresh(); });
    api.events.on('layer.visibility.changed', () => { if (this._isActive) this._refresh(); });

    // Restore active state after layers load.
    // Firebase path emits 'layers.imported', CSV/manual path emits 'features.added'.
    const wasActive = api.storage.get('heatmap_active');
    if (wasActive) {
      let restored = false;
      const tryRestore = () => { if (!restored) { restored = true; this._activate(); } };
      api.events.once('features.added', tryRestore);
      api.events.once('layers.imported', tryRestore);
    }
  },

  onEnable() {
    if (this._isActive) this._activate();
  },

  onDisable() {
    if (this._heatmapLayer) {
      this._heatmapLayer.setMap(null);
    }
    this._showPointLayerMarkers();
  },

  destroy() {
    if (this._heatmapLayer) {
      this._heatmapLayer.setMap(null);
      this._heatmapLayer = null;
    }
    this._showPointLayerMarkers();
  },

  _toggle() {
    if (this._isActive) {
      this._deactivate();
    } else {
      this._activate();
    }
  },

  _activate() {
    const map = this._api.map.getMap();
    if (!map) {
      this._api.ui.toast.error('Map not ready');
      return;
    }

    const points = this._collectPoints();
    if (points.length === 0) {
      this._api.ui.toast.warning('No visible point data for heatmap');
      return;
    }

    const cfg = this._api.config.get();
    const gradient = this._gradients[cfg.gradient];

    const options = {
      data: points,
      radius: cfg.radius || 30,
      opacity: cfg.opacity || 0.7,
      maxIntensity: cfg.maxIntensity > 0 ? cfg.maxIntensity : 10,
      dissipating: true
    };
    if (gradient) options.gradient = gradient;

    if (this._heatmapLayer) {
      this._heatmapLayer.setMap(null);
    }

    const doRender = () => {
      this._heatmapLayer = new google.maps.visualization.HeatmapLayer(options);
      this._heatmapLayer.setMap(map);
      this._isActive = true;
      this._api.storage.set('heatmap_active', true);
      if (this._controlBtn) this._controlBtn.classList.add('active');
      this._hidePointLayerMarkers();
      this._api.ui.toast.success(`Heatmap active (${points.length} points)`);
    };

    if (typeof google !== 'undefined' && google.maps.visualization?.HeatmapLayer) {
      doRender();
    } else if (typeof google !== 'undefined' && typeof google.maps.importLibrary === 'function') {
      google.maps.importLibrary('visualization')
        .then(() => doRender())
        .catch(() => this._api.ui.toast.error('Heatmap visualization library not loaded'));
    } else {
      this._api.ui.toast.error('Heatmap visualization library not loaded');
    }
  },

  _deactivate() {
    if (this._heatmapLayer) {
      this._heatmapLayer.setMap(null);
    }
    this._isActive = false;
    this._api.storage.set('heatmap_active', false);
    if (this._controlBtn) this._controlBtn.classList.remove('active');
    this._showPointLayerMarkers();
    this._api.ui.toast.info('Heatmap disabled');
  },

  _refresh() {
    if (!this._isActive || !this._heatmapLayer) return;
    const points = this._collectPoints();
    const cfg = this._api.config.get();
    const gradient = this._gradients[cfg.gradient];

    this._heatmapLayer.setData(points);
    this._heatmapLayer.setOptions({
      radius: cfg.radius || 30,
      opacity: cfg.opacity || 0.7,
      maxIntensity: cfg.maxIntensity > 0 ? cfg.maxIntensity : 10,
      dissipating: true,
      gradient: gradient || undefined
    });

    // Re-apply marker hiding in case visibility changed
    this._showPointLayerMarkers();
    this._hidePointLayerMarkers();
  },

  // Collect points only from visible layers — heatmap reflects what is shown.
  _collectPoints() {
    const layers = this._api.layers.getAll();
    const points = [];
    layers.forEach(layer => {
      if (!layer.visible) return;
      if (layer.type === 'polygon') return;
      (layer.features || []).forEach(feature => {
        const lat = parseFloat(feature.latitude);
        const lng = parseFloat(feature.longitude);
        if (!isNaN(lat) && !isNaN(lng)) {
          points.push({ location: new google.maps.LatLng(lat, lng), weight: 1 });
        }
      });
    });
    return points;
  },

  // Hide markers for all visible point layers so the heatmap is unobstructed.
  _hidePointLayerMarkers() {
    const layers = this._api.layers.getAll();
    this._hiddenLayerIds = [];
    layers.forEach(layer => {
      if (!layer.visible || layer.type === 'polygon') return;
      this._api.map.hideLayerMarkers(layer.id);
      this._hiddenLayerIds.push(layer.id);
    });
  },

  _showPointLayerMarkers() {
    (this._hiddenLayerIds || []).forEach(layerId => {
      this._api.map.showLayerMarkers(layerId);
    });
    this._hiddenLayerIds = [];
  }
};

// Auto-registration
AppRegistry.whenReady('pluginRegistry', r => r.register(HeatmapOverlayPlugin));
