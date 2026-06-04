// plugins/heatmap-overlay.js — Heatmap visualization plugin (deck.gl HeatmapLayer)
// Replaces the deprecated Google Maps visualization.HeatmapLayer removed in Maps API v3.65.

const HeatmapOverlayPlugin = {
  id: 'heatmap-overlay',
  name: 'Heatmap Overlay',
  version: '2.1.0',
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
      type: 'range',
      default: 45,
      min: 5,
      max: 100,
      step: 2,
      decimals: 0,
      label: 'Radius (px)'
    },
    intensity: {
      type: 'range',
      default: 1,
      min: 0.1,
      max: 5,
      step: 0.1,
      decimals: 1,
      label: 'Intensity'
    },
    threshold: {
      type: 'range',
      default: 0.1,
      min: 0.01,
      max: 0.5,
      step: 0.01,
      decimals: 2,
      label: 'Smoothing (higher = softer blobs)'
    },
    opacity: {
      type: 'range',
      default: 0.7,
      min: 0.1,
      max: 1.0,
      step: 0.05,
      decimals: 2,
      label: 'Opacity'
    }
  },

  _api: null,
  _deckOverlay: null,
  _isActive: false,
  _controlBtn: null,
  _hiddenLayerIds: [],
  _cachedPoints: null,   // invalidated only when layer data changes
  _refreshTimer: null,   // debounce handle

  // 6-stop [r,g,b,a] ramps. Only the first stop is fully transparent; the rest
  // carry high alpha (130→255) so each point's broad footprint is visible and
  // overlapping footprints blend into a continuous field instead of sharp dots.
  _colorRanges: {
    fire:    [[0,0,0,0], [128,0,0,130],  [200,40,0,175],  [255,110,0,205], [255,180,30,232], [255,245,140,255]],
    cool:    [[0,0,0,0], [0,40,170,130], [0,140,230,175], [0,220,200,205], [120,240,90,232], [245,245,120,255]],
    ocean:   [[0,0,0,0], [0,30,90,130],  [0,70,150,175],  [0,130,210,205], [0,190,240,232],  [170,225,255,255]],
    purple:  [[0,0,0,0], [50,0,70,130],  [110,0,160,175], [180,30,210,205], [230,120,240,232],[250,220,255,255]],
    heat:    [[0,0,0,0], [0,0,200,130],  [0,170,160,175], [120,210,40,205], [240,200,0,232],  [230,40,30,255]],
    default: [[0,0,0,0], [0,160,170,130],[0,200,120,175], [120,210,40,205], [230,200,0,232],  [235,40,30,255]]
  },

  init(api) {
    this._api = api;
    this._hiddenLayerIds = [];

    const savedRadius = api.config.get('radius');
    if (savedRadius === 20 || savedRadius === 40) api.config.set('radius', 30);
    if (api.config.get('maxIntensity') !== undefined && api.config.get('intensity') === undefined) {
      api.config.set('intensity', 1);
    }

    this._controlBtn = api.ui.addToolbarButton({
      label: '🌡',
      tooltip: 'Toggle Heatmap',
      onClick: () => this._toggle()
    });

    // Layer data changes → invalidate point cache, re-collect
    api.events.on('layer.created',            () => this._refreshData());
    api.events.on('layer.deleted',            () => this._refreshData());
    api.events.on('features.added',           () => this._refreshData());
    api.events.on('layer.visibility.changed', () => this._refreshData());

    const wasActive = api.storage.get('heatmap_active');
    if (wasActive) {
      let restored = false;
      const tryRestore = () => { if (!restored) { restored = true; this._activate(); } };
      api.events.once('features.added',  tryRestore);
      api.events.once('layers.imported', tryRestore);
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
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
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

    this._cachedPoints = this._collectPoints();
    if (this._cachedPoints.length === 0) {
      this._api.ui.toast.warning('No visible point data for heatmap');
      return;
    }

    this._destroyOverlay();
    const OverlayClass = deck.DeckOverlay || deck.GoogleMapsOverlay;
    this._deckOverlay = new OverlayClass({ layers: [this._buildLayer(this._cachedPoints)] });
    this._deckOverlay.setMap(map);

    this._isActive = true;
    this._api.storage.set('heatmap_active', true);
    if (this._controlBtn) this._controlBtn.classList.add('active');
    this._hidePointLayerMarkers();
    this._api.ui.toast.success(`Heatmap active (${this._cachedPoints.length} points)`);
  },

  _deactivate() {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._destroyOverlay();
    this._isActive = false;
    this._cachedPoints = null;
    this._api.storage.set('heatmap_active', false);
    if (this._controlBtn) this._controlBtn.classList.remove('active');
    this._showPointLayerMarkers();
    this._api.ui.toast.info('Heatmap disabled');
  },

  // Called by plugin-api on every config change (slider drag, select change).
  // Reuses cached points — only updates props on the existing overlay.
  // Debounced at 50 ms so rapid slider movement coalesces into one render.
  _refresh() {
    if (!this._isActive) return;
    this._schedule(false, 50);
  },

  // Called when layer data changes. Invalidates cached points.
  // Slightly longer debounce since layer events can fire in bursts.
  _refreshData() {
    if (!this._isActive) return;
    this._cachedPoints = null;
    this._schedule(true, 100);
  },

  _schedule(rebuildData, delay) {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      this._applyUpdate(rebuildData);
    }, delay);
  },

  _applyUpdate(rebuildData) {
    const map = this._api.map.getMap();
    if (!map) return;

    if (rebuildData || !this._cachedPoints) {
      this._cachedPoints = this._collectPoints();
      this._showPointLayerMarkers();
      this._hidePointLayerMarkers();
    }

    if (!this._cachedPoints.length) return;

    const layer = this._buildLayer(this._cachedPoints);

    if (this._deckOverlay) {
      // Update the existing WebGL overlay in-place — no context teardown
      this._deckOverlay.setProps({ layers: [layer] });
    } else {
      const OverlayClass = deck.DeckOverlay || deck.GoogleMapsOverlay;
      this._deckOverlay = new OverlayClass({ layers: [layer] });
      this._deckOverlay.setMap(map);
    }
  },

  _buildLayer(points) {
    const cfg = this._api.config.get();
    const colorRange = this._colorRanges[cfg.gradient] || this._colorRanges.default;
    return new deck.HeatmapLayer({
      id: 'salesmap-heatmap',
      data: points,
      getPosition: d => [d.lng, d.lat],
      getWeight:   d => d.weight,
      radiusPixels: cfg.radius    || 30,
      intensity:    cfg.intensity || 1,
      threshold:    cfg.threshold || 0.05,
      colorRange,
      opacity:      cfg.opacity   || 0.7,
      aggregation: 'SUM'
    });
  },

  _collectPoints() {
    const layers = this._api.layers.getAll();
    const points = [];
    layers.forEach(layer => {
      if (!layer.visible || layer.type === 'polygon') return;
      (layer.features || []).forEach(feature => {
        const lat = parseFloat(feature.latitude);
        const lng = parseFloat(feature.longitude);
        if (!isNaN(lat) && !isNaN(lng)) points.push({ lat, lng, weight: 1 });
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
    (this._hiddenLayerIds || []).forEach(id => this._api.map.showLayerMarkers(id));
    this._hiddenLayerIds = [];
  }
};

AppRegistry.whenReady('pluginRegistry', r => r.register(HeatmapOverlayPlugin));
