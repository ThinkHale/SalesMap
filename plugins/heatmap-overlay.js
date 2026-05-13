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
      options: ['fire', 'cool', 'ocean', 'default'],
      default: 'fire',
      label: 'Color Gradient'
    },
    radius: {
      type: 'number',
      default: 40,
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
      default: 0,
      min: 0,
      max: 1000,
      label: 'Max Intensity (0 = auto)'
    }
  },

  _api: null,
  _heatmapLayer: null,
  _isActive: false,
  _controlBtn: null,

  _gradients: {
    fire: ['rgba(0,0,0,0)','rgba(255,160,0,1)','rgba(255,80,0,1)','rgba(255,0,0,1)'],
    cool: ['rgba(0,0,0,0)','rgba(0,255,255,0.5)','rgba(0,0,255,1)'],
    ocean: ['rgba(0,0,0,0)','rgba(0,200,255,0.5)','rgba(0,100,200,0.7)','rgba(0,0,100,1)'],
    default: null
  },

  init(api) {
    this._api = api;

    // Migrate old default radius (20) to new default (40) for existing users.
    if (api.config.get('radius') === 20) api.config.set('radius', 40);

    // Pre-load the visualization library immediately so it is ready when the
    // user clicks the button. With loading=async in the Maps API URL the library
    // is not guaranteed to be available synchronously.
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

    // Restore active state after layers are loaded.
    // importLayers (Firebase path) emits 'layers.imported', not 'features.added',
    // so we listen for both. A flag prevents double-activation.
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
  },

  destroy() {
    if (this._heatmapLayer) {
      this._heatmapLayer.setMap(null);
      this._heatmapLayer = null;
    }
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
      this._api.ui.toast.warning('No point data available for heatmap');
      return;
    }

    const cfg = this._api.config.get();
    const gradient = this._gradients[cfg.gradient];

    // maxIntensity=3: isolated points render at ~33% gradient (visible orange),
    // areas with 3+ overlapping points within the radius reach full red.
    // The user can override via plugin settings if they want finer control.
    const autoMaxIntensity = 3;

    const options = {
      data: points,
      radius: cfg.radius || 20,
      opacity: cfg.opacity || 0.7,
      maxIntensity: cfg.maxIntensity > 0 ? cfg.maxIntensity : autoMaxIntensity
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
      this._api.ui.toast.success(`Heatmap active (${points.length} points)`);
    };

    if (typeof google !== 'undefined' && google.maps.visualization?.HeatmapLayer) {
      // Library already loaded (normal path)
      doRender();
    } else if (typeof google !== 'undefined' && typeof google.maps.importLibrary === 'function') {
      // loading=async deferred the visualization library — import it now
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
    this._api.ui.toast.info('Heatmap disabled');
  },

  _refresh() {
    if (!this._isActive || !this._heatmapLayer) return;
    const points = this._collectPoints();
    this._heatmapLayer.setData(points);
  },

  _collectPoints() {
    const layers = this._api.layers.getAll();
    const points = [];
    layers.forEach(layer => {
      // Deliberately ignore layer.visible — the heatmap is an independent
      // visualization. Users hide markers to reduce clutter while keeping
      // the density overlay visible.
      if (layer.type === 'polygon') return;
      (layer.features || []).forEach(feature => {
        const lat = parseFloat(feature.latitude);
        const lng = parseFloat(feature.longitude);
        if (!isNaN(lat) && !isNaN(lng)) {
          points.push({
            location: new google.maps.LatLng(lat, lng),
            weight: 1
          });
        }
      });
    });
    return points;
  }
};

// Auto-registration
AppRegistry.whenReady('pluginRegistry', r => r.register(HeatmapOverlayPlugin));
