// js/map-export.js — MapExport (static module)

const MapExport = {
  async _fetchInline(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      return await res.text();
    } catch {
      return null;
    }
  },

  async exportViewOnlyMap() {
    const layerManager = AppRegistry.require('layerManager');
    const layers = layerManager.getAllLayers();
    const center = AppRegistry.has('mapManager')
      ? AppRegistry.get('mapManager').map.getCenter()
      : { lat: () => AppConfig.map.defaultCenter.lat, lng: () => AppConfig.map.defaultCenter.lng };

    const mapCenter = { lat: center.lat(), lng: center.lng() };
    const mapZoom = AppRegistry.has('mapManager')
      ? AppRegistry.get('mapManager').map.getZoom()
      : AppConfig.map.defaultZoom;

    const layerData = JSON.stringify(layers.map(l => ({
      id: l.id,
      name: l.name,
      type: l.type,
      color: l.color,
      visible: l.visible,
      features: (l.features || []).map(f => ({ ...f }))
    })));

    const safeLayerData = encodeURIComponent(layerData);

    let heatmapData = null;
    if (AppRegistry.has('pluginRegistry')) {
      const pluginDef = AppRegistry.get('pluginRegistry').getDefinition('heatmap-overlay');
      if (pluginDef && pluginDef._isActive && pluginDef._api) {
        const cfg = pluginDef._api.config.get();
        const points = [];
        layers.forEach(layer => {
          if (!layer.visible || layer.type === 'polygon') return;
          (layer.features || []).forEach(feature => {
            const lat = parseFloat(feature.latitude);
            const lng = parseFloat(feature.longitude);
            if (!isNaN(lat) && !isNaN(lng)) points.push([lat, lng, 1]);
          });
        });
        if (points.length > 0) {
          heatmapData = {
            points,
            gradient: cfg.gradient || 'fire',
            radius: cfg.radius || 30,
            opacity: cfg.opacity || 0.7,
            maxIntensity: cfg.maxIntensity || 10
          };
        }
      }
    }

    const [leafletCSS, leafletJS, wellknownJS, leafletHeatJS] = await Promise.all([
      this._fetchInline('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'),
      this._fetchInline('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'),
      this._fetchInline('https://unpkg.com/wellknown@0.5.0/wellknown.js'),
      heatmapData ? this._fetchInline('https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js') : Promise.resolve(null)
    ]);

    const html = this._buildExportHTML(safeLayerData, mapCenter, mapZoom, heatmapData, { leafletCSS, leafletJS, wellknownJS, leafletHeatJS });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `salesmap_export_${new Date().toISOString().split('T')[0]}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toastManager.success('Map exported successfully');
  },

  _buildExportHTML(layerDataJSON, center, zoom, heatmapData, assets = {}) {
    const title = Utils.escapeHtml('SalesMap Export — ' + new Date().toLocaleDateString());
    const pinPath = AppConfig.marker.pinPath;

    const leafletCSSTag = assets.leafletCSS
      ? `<style>${assets.leafletCSS.replace(/<\/style>/gi, '<\\/style>')}</style>`
      : '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>';
    const leafletJSTag = assets.leafletJS
      ? `<script>${assets.leafletJS.replace(/<\/script>/gi, '<\\/script>')}<\/script>`
      : '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>';
    const wellknownJSTag = assets.wellknownJS
      ? `<script>${assets.wellknownJS.replace(/<\/script>/gi, '<\\/script>')}<\/script>`
      : '<script src="https://unpkg.com/wellknown@0.5.0/wellknown.js"><\/script>';
    const heatScript = heatmapData
      ? (assets.leafletHeatJS
          ? `<script>${assets.leafletHeatJS.replace(/<\/script>/gi, '<\\/script>')}<\/script>`
          : '<script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"><\/script>')
      : '';
    const heatInit = heatmapData ? `
var HEATMAP_GRADIENTS = {
  fire:    { 0.33: '#f00', 0.67: '#ffa500', 1.0: '#ff0' },
  cool:    { 0.25: '#00f', 0.5: '#0ff', 0.75: '#0f0', 1.0: '#ff0' },
  ocean:   { 0.25: '#00008b', 0.5: '#0064c8', 0.75: '#00bfff', 1.0: '#add8e6' },
  purple:  { 0.25: '#800080', 0.5: '#f0f', 0.75: '#ff80ff', 1.0: '#fff' },
  heat:    { 0.25: '#00f', 0.5: '#0f0', 0.75: '#ff0', 1.0: '#f00' }
};
var heatOpts = {
  radius: ${heatmapData.radius},
  max: ${heatmapData.maxIntensity},
  minOpacity: ${Math.max(0.05, heatmapData.opacity - 0.3)},
  blur: 15
};
var grad = HEATMAP_GRADIENTS[${JSON.stringify(heatmapData.gradient)}];
if (grad) heatOpts.gradient = grad;
L.heatLayer(${JSON.stringify(heatmapData.points)}, heatOpts).addTo(map);
` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
${leafletCSSTag}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; height: 100vh; display: flex; flex-direction: column; }
  #header { background: #0078d4; color: white; padding: 12px 20px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
  #header h1 { font-size: 16px; font-weight: 600; }
  #header .subtitle { font-size: 12px; opacity: 0.8; }
  #map { flex: 1; }
  .legend { background: white; border-radius: 8px; padding: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); max-width: 200px; max-height: 300px; overflow-y: auto; }
  .legend-title { font-weight: 600; font-size: 13px; margin-bottom: 8px; color: #333; }
  .legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; margin-bottom: 4px; color: #555; }
  .legend-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
  .iw-title { font-weight: 600; font-size: 14px; margin-bottom: 6px; color: #333; }
  .iw-row { font-size: 12px; margin-bottom: 3px; }
  .iw-label { font-weight: 500; color: #555; margin-right: 4px; }
  .iw-value { color: #333; }
  .read-only-badge { background: #e8f4fc; color: #0078d4; font-size: 11px; padding: 2px 8px; border-radius: 10px; border: 1px solid #b3d7f0; }
</style>
</head>
<body>
<div id="header">
  <div>
    <h1>SalesMap — Exported View</h1>
    <div class="subtitle">Read-only export generated ${new Date().toLocaleString()}</div>
  </div>
  <span class="read-only-badge">View Only</span>
</div>
<div id="map"></div>
${leafletJSTag}
${wellknownJSTag}
${heatScript}
<script>
const LAYER_DATA = JSON.parse(decodeURIComponent("${layerDataJSON}"));
const TIER_COLORS = ${JSON.stringify(AppConfig.colors.tierMap)};
const PIN_PATH = ${JSON.stringify(pinPath)};
const HEATMAP_MODE = ${heatmapData ? 'true' : 'false'};

const map = L.map('map').setView([${center.lat}, ${center.lng}], ${zoom});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '\\u00a9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

var LegendControl = L.Control.extend({
  onAdd: function() {
    var div = L.DomUtil.create('div', 'legend');
    var title = document.createElement('div');
    title.className = 'legend-title';
    title.textContent = 'Layers';
    div.appendChild(title);
    LAYER_DATA.forEach(function(layer) {
      if (!layer.visible) return;
      var item = document.createElement('div');
      item.className = 'legend-item';
      var dot = document.createElement('div');
      dot.className = 'legend-dot';
      dot.style.background = layer.color || '#0078d4';
      var name = document.createElement('span');
      name.textContent = layer.name;
      item.appendChild(dot);
      item.appendChild(name);
      div.appendChild(item);
    });
    return div;
  }
});
new LegendControl({ position: 'bottomleft' }).addTo(map);

function makeIcon(color) {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -42 24 42" width="24" height="42">'
    + '<path d="' + PIN_PATH + '" fill="' + color + '" stroke="white" stroke-width="1.5"/>'
    + '</svg>';
  return L.divIcon({ html: svg, className: '', iconSize: [24, 42], iconAnchor: [12, 42], popupAnchor: [0, -42] });
}

function makePopupContent(feature) {
  var html = '<div style="padding:4px"><div class="iw-title">' + (feature.name || 'Feature') + '</div>';
  ['description','tier','bdm','revenue'].forEach(function(prop) {
    if (feature[prop]) {
      html += '<div class="iw-row"><span class="iw-label">' + prop + ':</span>'
            + '<span class="iw-value">' + feature[prop] + '</span></div>';
    }
  });
  return html + '</div>';
}

LAYER_DATA.forEach(function(layer) {
  if (!layer.visible) return;
  (layer.features || []).forEach(function(feature) {
    if (feature.wkt) {
      try {
        var parsed = wellknown ? wellknown.parse(feature.wkt) : null;
        if (parsed && parsed.coordinates) {
          var latlngs = parsed.coordinates[0].map(function(c) { return [c[1], c[0]]; });
          var fillColor = TIER_COLORS[String(feature.tier || '').toLowerCase()] || layer.color || '#0078d4';
          L.polygon(latlngs, {
            fillColor: fillColor,
            fillOpacity: 0.35,
            color: layer.color || '#0078d4',
            weight: 2
          }).bindPopup(makePopupContent(feature)).addTo(map);
        }
      } catch(e) {}
    } else if (!HEATMAP_MODE && feature.latitude && feature.longitude) {
      var tierColor = TIER_COLORS[String(feature.tier || '').toLowerCase()];
      var color = tierColor || layer.color || '#0078d4';
      L.marker(
        [parseFloat(feature.latitude), parseFloat(feature.longitude)],
        { icon: makeIcon(color), title: feature.name || '' }
      ).bindPopup(makePopupContent(feature)).addTo(map);
    }
  });
});
${heatInit}
</script>
</body>
</html>`;
  }
};

AppRegistry.register('mapExport', MapExport);
