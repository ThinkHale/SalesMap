// plugins/heatmap-overlay.js — Heatmap visualization plugin
// Renders natively on Google Maps via a canvas OverlayView (no second map engine).
// Uses the same brush-accumulation algorithm as leaflet.heat, so the live map and
// the leaflet.heat-based exports/share views look consistent.

const HeatmapOverlayPlugin = {
  id: 'heatmap-overlay',
  name: 'Heatmap Overlay',
  version: '3.0.0',
  description: 'Renders point layers as a density heatmap using a Google Maps canvas overlay.',
  author: 'SalesMapper',
  minAppVersion: '4.0.0',
  headerToggle: true,

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
  _overlay: null,
  _isActive: false,
  _controlBtn: null,
  _hiddenLayerIds: [],
  _cachedPoints: null,

  // 6-stop [r,g,b,a] ramps. The leading transparent stop is dropped when building
  // the color palette; transparency on the map comes from accumulated brush alpha.
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
    if (savedRadius === 20 || savedRadius === 40) api.config.set('radius', 45);
    if (api.config.get('maxIntensity') !== undefined && api.config.get('intensity') === undefined) {
      api.config.set('intensity', 1);
    }

    this._controlBtn = api.ui.addToolbarButton({
      label: '🌡',
      tooltip: 'Toggle Heatmap',
      onClick: () => this._toggle()
    });

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
    this._destroyOverlay();
    this._showPointLayerMarkers();
  },

  _destroyOverlay() {
    if (this._overlay) {
      this._overlay.setMap(null);
      this._overlay = null;
    }
  },

  _toggle() {
    if (this._isActive) this._deactivate();
    else this._activate();
  },

  _activate() {
    if (typeof google === 'undefined' || !google.maps || !google.maps.OverlayView) {
      this._api.ui.toast.error('Map not ready — heatmap unavailable');
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
    this._overlay = this._createOverlay(this._cachedPoints);
    this._overlay.setParams(this._currentParams());
    this._overlay.setMap(map);

    this._isActive = true;
    this._api.storage.set('heatmap_active', true);
    if (this._controlBtn) this._controlBtn.classList.add('active');
    this._hidePointLayerMarkers();
    this._api.ui.toast.success(`Heatmap active (${this._cachedPoints.length} points)`);
  },

  _deactivate() {
    this._destroyOverlay();
    this._isActive = false;
    this._cachedPoints = null;
    this._api.storage.set('heatmap_active', false);
    if (this._controlBtn) this._controlBtn.classList.remove('active');
    this._showPointLayerMarkers();
    this._api.ui.toast.info('Heatmap disabled');
  },

  // Config changed (slider drag) — reuse cached points, just re-render.
  _refresh() {
    if (!this._isActive || !this._overlay) return;
    this._overlay.setParams(this._currentParams());
    this._overlay.render();
  },

  // Layer data changed — re-collect points.
  _refreshData() {
    if (!this._isActive || !this._overlay) return;
    this._cachedPoints = this._collectPoints();
    this._overlay.setData(this._cachedPoints);
    this._showPointLayerMarkers();
    this._hidePointLayerMarkers();
    this._overlay.render();
  },

  _currentParams() {
    const cfg = this._api.config.get();
    return {
      radius:    cfg.radius    || 45,
      intensity: cfg.intensity || 1,
      smoothing: cfg.threshold != null ? cfg.threshold : 0.1,
      opacity:   cfg.opacity   || 0.7,
      palette:   this._buildPalette(this._colorRanges[cfg.gradient] || this._colorRanges.default)
    };
  },

  // Build a 256-entry RGB lookup table from the gradient's colored stops.
  _buildPalette(stops) {
    const colored = stops.slice(1); // drop the leading transparent stop
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    colored.forEach((s, i) => {
      grad.addColorStop(i / (colored.length - 1), `rgb(${s[0]},${s[1]},${s[2]})`);
    });
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 1);
    return ctx.getImageData(0, 0, 256, 1).data;
  },

  // Build the OverlayView subclass (must run after google.maps is available).
  _createOverlay(points) {
    function makeBrush(radius, blur) {
      const pad = radius + blur;
      const c = document.createElement('canvas');
      c.width = c.height = pad * 2;
      const cx = c.getContext('2d');
      const g = cx.createRadialGradient(pad, pad, 0, pad, pad, pad);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = g;
      cx.fillRect(0, 0, pad * 2, pad * 2);
      return { canvas: c, pad };
    }

    class HeatCanvasOverlay extends google.maps.OverlayView {
      constructor(pts) {
        super();
        this._points = pts;
        this._canvas = null;
        this._brush = null;
        this._radius = 45;
        this._intensity = 1;
        this._smoothing = 0.1;
        this._opacity = 0.7;
        this._palette = null;
      }

      setData(pts) { this._points = pts; }

      setParams(p) {
        if (p.radius !== this._radius || p.smoothing !== this._smoothing) {
          this._brush = null; // brush size depends on radius + blur
        }
        this._radius = p.radius;
        this._intensity = p.intensity;
        this._smoothing = p.smoothing;
        this._opacity = p.opacity;
        this._palette = p.palette;
        if (this._canvas) this._canvas.style.opacity = this._opacity;
      }

      onAdd() {
        const canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.pointerEvents = 'none';
        canvas.style.opacity = this._opacity;
        this._canvas = canvas;
        this.getPanes().overlayLayer.appendChild(canvas);
      }

      onRemove() {
        if (this._canvas && this._canvas.parentNode) {
          this._canvas.parentNode.removeChild(this._canvas);
        }
        this._canvas = null;
        this._brush = null;
      }

      draw() { this.render(); }

      render() {
        const proj = this.getProjection();
        const map = this.getMap();
        if (!proj || !this._canvas || !map) return;
        const bounds = map.getBounds();
        if (!bounds) return;

        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        const trPx = proj.fromLatLngToDivPixel(ne);
        const blPx = proj.fromLatLngToDivPixel(sw);
        const left = blPx.x, top = trPx.y;
        const w = Math.max(1, Math.round(trPx.x - blPx.x));
        const h = Math.max(1, Math.round(blPx.y - trPx.y));

        const canvas = this._canvas;
        canvas.style.left = left + 'px';
        canvas.style.top = top + 'px';
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        const r = this._radius;
        const blur = Math.max(1, Math.round(r * (0.2 + this._smoothing)));
        if (!this._brush) this._brush = makeBrush(r, blur);
        const brush = this._brush;
        const pad = brush.pad;

        // Per-point alpha: low so dense areas accumulate toward the hot colors,
        // scaled by the intensity setting.
        const baseAlpha = Math.min(1, Math.max(0.03, 0.15 * this._intensity));

        for (const pt of this._points) {
          const dp = proj.fromLatLngToDivPixel(pt.latLng);
          const x = dp.x - left, y = dp.y - top;
          if (x < -pad || y < -pad || x > w + pad || y > h + pad) continue;
          ctx.globalAlpha = baseAlpha;
          ctx.drawImage(brush.canvas, x - pad, y - pad);
        }
        ctx.globalAlpha = 1;

        if (!this._palette) return;
        const img = ctx.getImageData(0, 0, w, h);
        const data = img.data;
        const pal = this._palette;
        for (let i = 3; i < data.length; i += 4) {
          const a = data[i];
          if (a) {
            const j = a * 4;
            data[i - 3] = pal[j];
            data[i - 2] = pal[j + 1];
            data[i - 1] = pal[j + 2];
          }
        }
        ctx.putImageData(img, 0, 0);
      }
    }

    return new HeatCanvasOverlay(points);
  },

  _collectPoints() {
    const layers = this._api.layers.getAll();
    const points = [];
    layers.forEach(layer => {
      if (!layer.visible || layer.type === 'polygon') return;
      (layer.features || []).forEach(feature => {
        const lat = parseFloat(feature.latitude);
        const lng = parseFloat(feature.longitude);
        if (!isNaN(lat) && !isNaN(lng)) {
          points.push({ latLng: new google.maps.LatLng(lat, lng), weight: 1 });
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
      // Layers flagged showOnHeatmap keep their pins visible above the heat canvas.
      if (layer.showOnHeatmap) return;
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
