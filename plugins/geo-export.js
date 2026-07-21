// plugins/geo-export.js — Export layers as GeoJSON or KML
// A geodata sibling to the HTML export / share views: produces standards-based
// files that open in QGIS, ArcGIS, Google Earth, Mapbox, etc.

const GeoExportPlugin = {
  id: 'geo-export',
  name: 'GeoJSON / KML Export',
  version: '1.0.0',
  description: 'Download your layers as GeoJSON or KML for use in QGIS, ArcGIS, Google Earth, and other GIS tools.',
  author: 'SalesMapper',
  minAppVersion: '4.0.0',
  defaultEnabled: false,

  permissions: ['layers.read', 'ui.slot:toolbar', 'ui.modal', 'ui.toast'],
  configSchema: {},

  _api: null,
  _SYSTEM_KEYS: ['id', 'layerid', 'layerId', 'wkt', '_rowIndex', '_errors', '_geocodeConfidence', '_formattedAddress'],

  init(api) {
    this._api = api;
    api.ui.addToolbarButton({
      icon: '🌐',
      tooltip: 'Export layers as GeoJSON / KML',
      onClick: () => this._openDialog()
    });
  },

  _openDialog() {
    const layers = this._api.layers.getAll().filter(l => (l.features || []).length > 0);
    if (layers.length === 0) {
      this._api.ui.toast.warning('No layers with features to export');
      return;
    }

    this._api.ui.modal.openDrawer(body => {
      body.innerHTML = '';

      // Format
      const fmtGroup = Utils.createElement('div', { className: 'form-group' });
      fmtGroup.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Format'));
      const fmtSel = Utils.createElement('select', { className: 'form-control' });
      [['geojson', 'GeoJSON (.geojson)'], ['kml', 'KML (.kml)']].forEach(([v, t]) => {
        const o = Utils.createElement('option', { value: v }, t);
        fmtSel.appendChild(o);
      });
      fmtGroup.appendChild(fmtSel);
      body.appendChild(fmtGroup);

      // Layer selection
      const layGroup = Utils.createElement('div', { className: 'form-group' });
      layGroup.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Layers to include'));
      const checks = [];
      layers.forEach(l => {
        const row = Utils.createElement('label', { className: 'settings-toggle' });
        const cb = Utils.createElement('input', { type: 'checkbox' });
        cb.checked = true;
        cb._layerId = l.id;
        checks.push(cb);
        row.appendChild(cb);
        row.appendChild(document.createTextNode(` ${l.name} (${(l.features || []).length})`));
        layGroup.appendChild(row);
      });
      body.appendChild(layGroup);

      const exportBtn = Utils.createElement('button', { className: 'btn btn-primary', style: { marginTop: '12px' } }, 'Download');
      exportBtn.addEventListener('click', () => {
        const ids = checks.filter(c => c.checked).map(c => c._layerId);
        if (ids.length === 0) { this._api.ui.toast.warning('Select at least one layer'); return; }
        const chosen = layers.filter(l => ids.includes(l.id));
        if (fmtSel.value === 'kml') this._downloadKML(chosen);
        else this._downloadGeoJSON(chosen);
      });
      body.appendChild(exportBtn);
    }, 'Export GeoJSON / KML');
  },

  _cleanProps(feature) {
    const props = {};
    Object.keys(feature).forEach(k => {
      if (this._SYSTEM_KEYS.includes(k)) return;
      const v = feature[k];
      if (v === null || v === undefined || v === '') return;
      props[k] = v;
    });
    return props;
  },

  _featureGeometry(feature) {
    if (feature.wkt && String(feature.wkt).trim()) {
      try {
        const g = typeof wellknown !== 'undefined' ? wellknown.parse(String(feature.wkt)) : null;
        if (g) return g;
      } catch (e) { /* fall through */ }
      return null;
    }
    const lat = parseFloat(feature.latitude);
    const lng = parseFloat(feature.longitude);
    if (!isNaN(lat) && !isNaN(lng)) return { type: 'Point', coordinates: [lng, lat] };
    return null;
  },

  _buildGeoJSON(layers) {
    const features = [];
    layers.forEach(layer => {
      (layer.features || []).forEach(f => {
        const geometry = this._featureGeometry(f);
        if (!geometry) return;
        features.push({
          type: 'Feature',
          geometry,
          properties: { ...this._cleanProps(f), _layer: layer.name }
        });
      });
    });
    return { type: 'FeatureCollection', features };
  },

  _downloadGeoJSON(layers) {
    const gj = this._buildGeoJSON(layers);
    if (gj.features.length === 0) { this._api.ui.toast.warning('No exportable geometry found'); return; }
    this._download(JSON.stringify(gj, null, 2), 'application/geo+json', 'geojson');
    this._api.ui.toast.success(`Exported ${gj.features.length} features as GeoJSON`);
  },

  _kmlColor(hex) {
    // KML uses aabbggrr; default full opacity.
    const h = String(hex || '#0078d4').replace('#', '');
    if (h.length !== 6) return 'ff0000ff';
    const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
    return 'ff' + b + g + r;
  },

  _downloadKML(layers) {
    const esc = Utils.escapeHtml;
    let styles = '';
    let placemarks = '';
    let count = 0;

    layers.forEach((layer, li) => {
      const styleId = `layer${li}`;
      const color = this._kmlColor(layer.color);
      styles += `<Style id="${styleId}"><LineStyle><color>${color}</color><width>2</width></LineStyle>`
        + `<PolyStyle><color>7f${color.slice(2)}</color></PolyStyle>`
        + `<IconStyle><color>${color}</color></IconStyle></Style>\n`;

      (layer.features || []).forEach(f => {
        const geom = this._featureGeometry(f);
        if (!geom) return;
        count++;
        const name = esc(f.name || 'Feature');
        const desc = Object.entries(this._cleanProps(f))
          .map(([k, v]) => `${esc(k)}: ${esc(v)}`).join('<br/>');
        placemarks += `<Placemark><name>${name}</name><description><![CDATA[${desc}]]></description>`
          + `<styleUrl>#${styleId}</styleUrl>${this._geomToKML(geom)}</Placemark>\n`;
      });
    });

    if (count === 0) { this._api.ui.toast.warning('No exportable geometry found'); return; }

    const kml = `<?xml version="1.0" encoding="UTF-8"?>\n`
      + `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>\n`
      + `<name>SalesMap Export</name>\n${styles}${placemarks}</Document></kml>`;
    this._download(kml, 'application/vnd.google-earth.kml+xml', 'kml');
    this._api.ui.toast.success(`Exported ${count} features as KML`);
  },

  _ringToKML(ring) {
    const coords = ring.map(c => `${c[0]},${c[1]},0`).join(' ');
    return `<outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs>`;
  },

  _geomToKML(geom) {
    if (geom.type === 'Point') {
      return `<Point><coordinates>${geom.coordinates[0]},${geom.coordinates[1]},0</coordinates></Point>`;
    }
    if (geom.type === 'Polygon') {
      // First ring is the outer boundary (inner rings/holes omitted for simplicity).
      return `<Polygon>${this._ringToKML(geom.coordinates[0])}</Polygon>`;
    }
    if (geom.type === 'MultiPolygon') {
      const polys = geom.coordinates.map(p => `<Polygon>${this._ringToKML(p[0])}</Polygon>`).join('');
      return `<MultiGeometry>${polys}</MultiGeometry>`;
    }
    return '';
  },

  _download(text, mime, ext) {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `salesmap_export_${new Date().toISOString().split('T')[0]}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};

AppRegistry.whenReady('pluginRegistry', r => r.register(GeoExportPlugin));
