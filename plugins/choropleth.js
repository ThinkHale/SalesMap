// plugins/choropleth.js — Thematic polygon shading by a numeric metric
// Colors polygons along a sequential gradient scaled to a chosen numeric field,
// with a live gradient legend. Distinct from the built-in categorical tier colors.

const ChoroplethPlugin = {
  id: 'choropleth',
  name: 'Choropleth Shading',
  version: '1.0.0',
  description: 'Shade polygons along a color gradient scaled to a numeric field (revenue, count, score) with a legend.',
  author: 'SalesMapper',
  minAppVersion: '4.0.0',
  defaultEnabled: false,

  permissions: ['layers.read', 'map.read', 'map.write', 'ui.slot:toolbar', 'ui.modal', 'ui.toast', 'events.listen'],
  configSchema: {},

  _api: null,
  _activeLayerId: null,
  _activeProp: null,
  _activeGradient: 'blue',
  _legendEl: null,

  _GRADIENTS: {
    blue:    ['#f7fbff', '#4292c6', '#08306b'],
    green:   ['#f7fcf5', '#41ab5d', '#00441b'],
    red:     ['#fff5f0', '#ef3b2c', '#67000d'],
    orange:  ['#fff5eb', '#f16913', '#7f2704'],
    viridis: ['#440154', '#21908c', '#fde725']
  },

  init(api) {
    this._api = api;
    api.ui.addToolbarButton({
      icon: '🎨',
      tooltip: 'Choropleth shading by metric',
      onClick: () => this._openDialog()
    });
    // Re-apply after re-renders that recreate polygon objects.
    const reapply = () => { if (this._activeLayerId) this._apply(); };
    api.events.on('features.added', reapply);
    api.events.on('feature.updated', reapply);
    api.events.on('layer.refreshed', reapply);
  },

  destroy() { this._removeLegend(); },

  // ── Color math ─────────────────────────────────────────────────────────────
  _hexToRgb(h) {
    const n = parseInt(h.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  },
  _rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  },
  _colorAt(t, stops) {
    t = Math.max(0, Math.min(1, t));
    const seg = 1 / (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t / seg));
    const local = (t - i * seg) / seg;
    const a = this._hexToRgb(stops[i]), b = this._hexToRgb(stops[i + 1]);
    return this._rgbToHex(a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local, a[2] + (b[2] - a[2]) * local);
  },

  _numericProps(layer) {
    const counts = {};
    (layer.features || []).forEach(f => {
      Object.keys(f).forEach(k => {
        if (['latitude', 'longitude', 'id', 'wkt', 'layerId', '_rowIndex'].includes(k)) return;
        if (!isNaN(Utils.parseNumber(f[k]))) counts[k] = (counts[k] || 0) + 1;
      });
    });
    // Keep properties numeric for at least half the features.
    const threshold = Math.max(1, (layer.features || []).length / 2);
    return Object.keys(counts).filter(k => counts[k] >= threshold);
  },

  _openDialog() {
    const polyLayers = this._api.layers.getAll().filter(l =>
      (l.type === 'polygon' || l.type === 'mixed') && (l.features || []).some(f => f.wkt));
    if (polyLayers.length === 0) {
      this._api.ui.toast.warning('No polygon layers to shade');
      return;
    }

    this._api.ui.modal.openDrawer(body => {
      body.innerHTML = '';

      const layGroup = Utils.createElement('div', { className: 'form-group' });
      layGroup.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Layer'));
      const laySel = Utils.createElement('select', { className: 'form-control' });
      polyLayers.forEach(l => laySel.appendChild(Utils.createElement('option', { value: l.id }, l.name)));
      laySel.value = this._activeLayerId && polyLayers.some(l => l.id === this._activeLayerId)
        ? this._activeLayerId : polyLayers[0].id;
      layGroup.appendChild(laySel);
      body.appendChild(layGroup);

      const propGroup = Utils.createElement('div', { className: 'form-group' });
      propGroup.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Numeric field'));
      const propSel = Utils.createElement('select', { className: 'form-control' });
      propGroup.appendChild(propSel);
      body.appendChild(propGroup);

      const fillProps = () => {
        propSel.innerHTML = '';
        const layer = this._api.layers.get(laySel.value);
        const props = this._numericProps(layer);
        if (props.length === 0) {
          propSel.appendChild(Utils.createElement('option', { value: '' }, '— no numeric fields —'));
          return;
        }
        props.forEach(p => propSel.appendChild(Utils.createElement('option', { value: p }, p)));
        if (this._activeProp && props.includes(this._activeProp)) propSel.value = this._activeProp;
      };
      laySel.addEventListener('change', fillProps);
      fillProps();

      const gradGroup = Utils.createElement('div', { className: 'form-group' });
      gradGroup.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Gradient'));
      const gradSel = Utils.createElement('select', { className: 'form-control' });
      Object.keys(this._GRADIENTS).forEach(g => gradSel.appendChild(Utils.createElement('option', { value: g }, g)));
      gradSel.value = this._activeGradient;
      gradGroup.appendChild(gradSel);
      body.appendChild(gradGroup);

      const applyBtn = Utils.createElement('button', { className: 'btn btn-primary', style: { marginTop: '10px' } }, 'Apply Shading');
      applyBtn.addEventListener('click', () => {
        if (!propSel.value) { this._api.ui.toast.warning('No numeric field selected'); return; }
        this._activeLayerId = laySel.value;
        this._activeProp = propSel.value;
        this._activeGradient = gradSel.value;
        this._apply();
      });
      body.appendChild(applyBtn);

      const clearBtn = Utils.createElement('button', { className: 'btn btn-secondary', style: { marginTop: '10px', marginLeft: '8px' } }, 'Clear');
      clearBtn.addEventListener('click', () => this._clear());
      body.appendChild(clearBtn);
    }, 'Choropleth Shading');
  },

  _apply() {
    const layer = this._api.layers.get(this._activeLayerId);
    const layerData = this._api.map.getLayerData(this._activeLayerId);
    if (!layer || !layerData) return;
    const prop = this._activeProp;
    const stops = this._GRADIENTS[this._activeGradient] || this._GRADIENTS.blue;

    const values = layerData.polygons
      .map(p => Utils.parseNumber(p._featureData[prop]))
      .filter(v => !isNaN(v));
    if (values.length === 0) { this._api.ui.toast.warning(`No numeric "${prop}" values`); return; }
    let min = Infinity, max = -Infinity;
    for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
    const span = (max - min) || 1;

    layerData.polygons.forEach(p => {
      const v = Utils.parseNumber(p._featureData[prop]);
      if (isNaN(v)) { p.setOptions({ fillColor: '#dddddd', strokeColor: '#bbbbbb', fillOpacity: 0.5 }); return; }
      const c = this._colorAt((v - min) / span, stops);
      p.setOptions({ fillColor: c, strokeColor: c, fillOpacity: 0.7 });
    });

    this._renderLegend(layer.name, prop, min, max, stops);
    this._api.ui.toast.success(`Shaded "${layer.name}" by ${prop}`);
  },

  _clear() {
    if (this._activeLayerId) {
      const layerData = this._api.map.getLayerData(this._activeLayerId);
      if (layerData) {
        // Restore the fill opacity we overrode, then let the layer's own style
        // rule decide the colors again.
        layerData.polygons.forEach(p => p.setOptions({ fillOpacity: AppConfig.polygon.fillOpacity }));
        this._api.map.applyLayerStyle(this._activeLayerId);
      }
    }
    this._activeLayerId = null;
    this._activeProp = null;
    this._removeLegend();
    this._api.ui.toast.info('Choropleth cleared');
  },

  _renderLegend(layerName, prop, min, max, stops) {
    this._removeLegend();
    const map = this._api.map.getMap();
    if (!map) return;

    const el = Utils.createElement('div', { className: 'choropleth-legend' });
    el.appendChild(Utils.createElement('div', { className: 'choropleth-legend-title' }, `${prop}`));
    const bar = Utils.createElement('div', { className: 'choropleth-legend-bar' });
    bar.style.background = `linear-gradient(to right, ${stops.join(',')})`;
    el.appendChild(bar);
    const scale = Utils.createElement('div', { className: 'choropleth-legend-scale' });
    scale.appendChild(Utils.createElement('span', {}, Utils.formatNumber(Math.round(min))));
    scale.appendChild(Utils.createElement('span', {}, Utils.formatNumber(Math.round(max))));
    el.appendChild(scale);

    map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(el);
    this._legendEl = el;
  },

  _removeLegend() {
    if (!this._legendEl) return;
    const map = this._api.map.getMap && this._api.map.getMap();
    if (map) {
      const arr = map.controls[google.maps.ControlPosition.RIGHT_BOTTOM];
      for (let i = 0; i < arr.getLength(); i++) {
        if (arr.getAt(i) === this._legendEl) { arr.removeAt(i); break; }
      }
    }
    this._legendEl = null;
  }
};

AppRegistry.whenReady('pluginRegistry', r => r.register(ChoroplethPlugin));
