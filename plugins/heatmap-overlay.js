// plugins/heatmap-overlay.js — Heatmap visualization plugin (deck.gl HeatmapLayer)
// Replaces the deprecated Google Maps visualization.HeatmapLayer removed in Maps API v3.65.

const HeatmapOverlayPlugin = {
  id: 'heatmap-overlay',
  name: 'Heatmap Overlay',
  version: '2.0.0',
  description: 'Renders point layers as a density heatmap using deck.gl HeatmapLayer.',
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
  _deckOverlay: null,
  _isActive: false,
  _controlBtn: null,
  _hiddenLayerIds: [],

  // deck.gl colorRange: array of 6 [r, g, b, a] stops (low → high intensity)
  _colorRanges: {
    fire:    [[0,0,0,0], [100,0,0,120], [200,50,0,160], [255,100,0,200], [255,180,0,230], [255,255,0,255]],
    cool:    [[0,0,0,0], [0,0,180,80],  [0,150,255,140],[0,255,200,180], [100,255,100,220],[255,255,0,255]],
    ocean:   [[0,0,0,0], [0,0,100,80],  [0,50,160,130], [0,130,220,180],[0,200,255,220],  [180,230,255,255]],
    purple:  [[0,0,0,0], [60,0,80,80],  [130,0,180,140],[200,0,220,180],[255,100,255,220],[255,220,255,255]],
    heat:    [[0,0,0,0], [0,0,220,60],  [0,180,0,120],  [200,200,0,180],[255,100,0,220],  [255,0,0,255]],
    default: [[0,0,0,0], [0,180,180,80],[0,200,100,140],[100,220,0,180],[220,200,0,220],  [255,0,0,255]]
  },

  init(api) {
    this._api = api;
    this._hiddenLayerIds = [];

    const savedRadius = api.config.get('radius');
    if (savedRadius === 20 || savedRadius === 40) api.config.set('radius', 30);

    this._controlBtn = api.ui.addToolbarButton({
      label: '🌡',
      tooltip: 'Toggle Heatmap',
      onClick: () => this._toggle()
    });

    api.events.on('layer.created',            () => { if (this._isActive) this._refresh(); });
    api.events.on('layer.deleted',            () => { if (this._isActive) this._refresh(); });
    api.events.on('features.added',           () => { if (this._isActive) this._refresh(); });
    api.events.on('layer.visibility.changed', () => { if (this._isActive) this._refresh(); });

    const wasActive = api.storage.get('heatmap_active');
    if (wasActive) {
      let restored = false;
      const tryRestore = () => { if (!restored) { restored = true; this._activate(); } };
      api.events.once('features.added',   tryRestore);
      api.events.once('layers.imported',  tryRestore);
    }
  },

  onEnable() {
    if (this._isActive) this._activate();
  },

  onDisable() {
    this._destroyOverlay();
    this._showPointLayerMarkers();
  },

  destroy() {
    this._destroyOverlay();
    this._showPointLayerMarkers();
  },

  _destroyOverlay() {
    if (this._deckOverlay) {
      this._deckOverlay.setMap(null);
      this._deckOverlay.finalize();
      this._deckOverlay = null;
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
    if (typeof deck === 'undefined' || !deck.HeatmapLayer) {
      this._api.ui.toast.error('deck.gl failed to load — heatmap unavailable');
      return;
    }
    if (!deck.DeckOverlay && !deck.GoogleMapsOverlay) {
      this._api.ui.toast.error('deck.gl Google Maps overlay not loaded — heatmap unavailable');
      return;
    }

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

    this._destroyOverlay();
    this._deckOverlay = this._buildDeckOverlay(map, points);

    this._isActive = true;
    this._api.storage.set('heatmap_active', true);
    if (this._controlBtn) this._controlBtn.classList.add('active');
    this._hidePointLayerMarkers();
    this._api.ui.toast.success(`Heatmap active (${points.length} points)`);
  },

  _deactivate() {
    this._destroyOverlay();
    this._isActive = false;
    this._api.storage.set('heatmap_active', false);
    if (this._controlBtn) this._controlBtn.classList.remove('active');
    this._showPointLayerMarkers();
    this._api.ui.toast.info('Heatmap disabled');
  },

  _refresh() {
    if (!this._isActive) return;
    const map = this._api.map.getMap();
    if (!map) return;

    const points = this._collectPoints();
    this._destroyOverlay();

    if (points.length > 0) {
      this._deckOverlay = this._buildDeckOverlay(map, points);
    }

    this._showPointLayerMarkers();
    this._hidePointLayerMarkers();
  },

  _buildDeckOverlay(map, points) {
    const cfg = this._api.config.get();
    const colorRange = this._colorRanges[cfg.gradient] || this._colorRanges.default;

    const heatmapLayer = new deck.HeatmapLayer({
      id: 'salesmap-heatmap',
      data: points,
      getPosition: d => [d.lng, d.lat],
      getWeight:   d => d.weight,
      radiusPixels:  cfg.radius || 30,
      intensity:     1,
      threshold:     0.05,
      colorRange,
      opacity: cfg.opacity || 0.7,
      aggregation: 'SUM'
    });

    const OverlayClass = deck.DeckOverlay || deck.GoogleMapsOverlay;
    const overlay = new OverlayClass({ layers: [heatmapLayer] });
    overlay.setMap(map);
    return overlay;
  },

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
          points.push({ lat, lng, weight: 1 });
        }
      });
    });
    return points;
  },

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
