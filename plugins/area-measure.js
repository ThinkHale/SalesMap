// plugins/area-measure.js — Polygon area report
// Complements the core Distance/Radius tool by reporting the geodesic area of
// polygon features (acres / sq mi / km²), per feature and per layer.

const AreaMeasurePlugin = {
  id: 'area-measure',
  name: 'Polygon Area',
  version: '1.0.0',
  description: 'Report the geodesic area (acres, sq mi, km²) of polygon features, per feature and per layer.',
  author: 'SalesMapper',
  minAppVersion: '4.0.0',
  defaultEnabled: false,

  permissions: ['layers.read', 'map.read', 'ui.slot:toolbar', 'ui.modal', 'ui.toast'],
  configSchema: {},

  _api: null,

  init(api) {
    this._api = api;
    api.ui.addToolbarButton({
      icon: '📐',
      tooltip: 'Measure polygon areas',
      onClick: () => this._openReport()
    });
  },

  _hasGeometry() {
    return typeof google !== 'undefined' && google.maps.geometry && google.maps.geometry.spherical;
  },

  // Sum the geodesic area (m²) of every rendered polygon that belongs to a feature.
  _featureAreaSqM(layerId, featureId) {
    const layerData = this._api.map.getLayerData(layerId);
    if (!layerData) return 0;
    let sum = 0;
    layerData.polygons.forEach(p => {
      if (p._featureId !== featureId) return;
      sum += google.maps.geometry.spherical.computeArea(p.getPath());
    });
    return sum;
  },

  _fmt(sqm) {
    const acres = sqm * 0.000247105;
    const sqmi = sqm * 3.861021585e-7;
    const km2 = sqm / 1e6;
    return { acres, sqmi, km2 };
  },

  _openReport() {
    if (!this._hasGeometry()) {
      this._api.ui.toast.error('Google Maps geometry library not available');
      return;
    }
    const layers = this._api.layers.getAll().filter(l =>
      (l.type === 'polygon' || l.type === 'mixed') &&
      (l.features || []).some(f => f.wkt));
    if (layers.length === 0) {
      this._api.ui.toast.warning('No polygon layers to measure');
      return;
    }

    this._api.ui.modal.openDrawer(body => {
      body.innerHTML = '';

      layers.forEach(layer => {
        const section = Utils.createElement('div', { className: 'area-layer-section', style: { marginBottom: '16px' } });
        const polyFeatures = (layer.features || []).filter(f => f.wkt);
        let layerTotal = 0;

        const rows = polyFeatures.map(f => {
          const sqm = this._featureAreaSqM(layer.id, f.id);
          layerTotal += sqm;
          return { name: f.name || 'Untitled', ...this._fmt(sqm) };
        }).sort((a, b) => b.acres - a.acres);

        const total = this._fmt(layerTotal);
        const header = Utils.createElement('div', { className: 'plugin-panel-header' });
        header.textContent = `${layer.name} — ${Utils.formatNumber(Math.round(total.acres))} ac / ${total.sqmi.toFixed(1)} mi²`;
        section.appendChild(header);

        const table = Utils.createElement('table', { className: 'area-table' });
        const thead = Utils.createElement('tr');
        ['Feature', 'Acres', 'mi²', 'km²'].forEach(h => thead.appendChild(Utils.createElement('th', {}, h)));
        table.appendChild(thead);
        rows.forEach(r => {
          const tr = Utils.createElement('tr');
          tr.appendChild(Utils.createElement('td', {}, r.name));
          tr.appendChild(Utils.createElement('td', {}, Utils.formatNumber(Math.round(r.acres))));
          tr.appendChild(Utils.createElement('td', {}, r.sqmi.toFixed(2)));
          tr.appendChild(Utils.createElement('td', {}, r.km2.toFixed(2)));
          table.appendChild(tr);
        });
        section.appendChild(table);
        body.appendChild(section);
      });
    }, 'Polygon Area Report');
  }
};

AppRegistry.whenReady('pluginRegistry', r => r.register(AreaMeasurePlugin));
