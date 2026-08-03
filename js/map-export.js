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
      pinScale: l.pinScale ?? 1.0,
      showOnHeatmap: !!l.showOnHeatmap,
      clusterEnabled: l.clusterEnabled !== false,
      // Property styling + popup fields so the export matches the live map.
      styleRule: l.styleRule || null,
      infoFields: l.infoFields || null,
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
            // Pass the actual colorRange used by deck.gl so the export matches exactly
            colorRange: pluginDef._colorRanges[cfg.gradient] || pluginDef._colorRanges.default,
            radius:    cfg.radius    || 30,
            opacity:   cfg.opacity   || 0.7,
            intensity: cfg.intensity || 1,
            threshold: cfg.threshold || 0.05
          };
        }
      }
    }

    // Read current cluster settings so the export matches the live view. Cluster
    // settings are emitted even in heatmap mode so that layers flagged
    // showOnHeatmap still cluster their pins on top of the heat layer.
    let clusterSettings = null;
    let globalPinScale = 1.0;
    if (AppRegistry.has('clusterManager')) {
      const cm = AppRegistry.get('clusterManager');
      const s = cm._settings || cm._defaultSettings();
      globalPinScale = s.pinScale ?? 1.0;
      if (s.enabled !== false && cm._enabled !== false) {
        clusterSettings = {
          maxZoom:        s.maxZoom        ?? 16,
          minClusterSize: s.minClusterSize ?? 2,
          gridSize:       s.gridSize       ?? 60
        };
      }
    }

    const [leafletCSS, leafletJS, wellknownJS, leafletHeatJS, clusterCSS, clusterJS, propertyServiceJS] = await Promise.all([
      this._fetchInline('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'),
      this._fetchInline('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'),
      this._fetchInline('https://unpkg.com/wellknown@0.5.0/wellknown.js'),
      heatmapData ? this._fetchInline('https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js') : Promise.resolve(null),
      clusterSettings ? this._fetchInline('https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css') : Promise.resolve(null),
      clusterSettings ? this._fetchInline('https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js') : Promise.resolve(null),
      // Inlining the real PropertyService keeps exported colors and legends
      // identical to the live map instead of reimplementing the rules here.
      this._fetchInline('js/property-service.js')
    ]);

    const html = this._buildExportHTML(safeLayerData, mapCenter, mapZoom, heatmapData, clusterSettings, { leafletCSS, leafletJS, wellknownJS, leafletHeatJS, clusterCSS, clusterJS, propertyServiceJS }, globalPinScale);
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

  _buildExportHTML(layerDataJSON, center, zoom, heatmapData, clusterSettings, assets = {}, globalPinScale = 1.0) {
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
    const clusterCSSTag = clusterSettings
      ? (assets.clusterCSS
          ? `<style>${assets.clusterCSS.replace(/<\/style>/gi, '<\\/style>')}</style>`
          : '<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css"/>')
      : '';
    const clusterJSTag = clusterSettings
      ? (assets.clusterJS
          ? `<script>${assets.clusterJS.replace(/<\/script>/gi, '<\\/script>')}<\/script>`
          : '<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"><\/script>')
      : '';
    // When the service can't be inlined the export still renders — it just falls
    // back to tier/layer colors instead of property styling.
    const propertyServiceTag = assets.propertyServiceJS
      ? `<script>${assets.propertyServiceJS.replace(/<\/script>/gi, '<\\/script>')}<\/script>`
      : '';
    // Convert the deck.gl colorRange (array of 6 [r,g,b,a] stops) to leaflet.heat gradient format.
    // Stops are evenly spaced 0–1; alpha channel (0–255) becomes CSS opacity (0–1).
    const leafletGradient = heatmapData
      ? Object.fromEntries(
          heatmapData.colorRange.map(([r, g, b, a], i, arr) => [
            (i / (arr.length - 1)).toFixed(2),
            `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`
          ])
        )
      : null;

    const heatInit = heatmapData ? `
// Translate deck.gl params to leaflet.heat equivalents:
// intensity (deck.gl weight multiplier 0.1–5) → max inverted: higher intensity = lower max threshold
// threshold (deck.gl fade cutoff 0.01–0.5)    → minOpacity
var heatOpts = {
  radius:     ${heatmapData.radius},
  max:        ${(1 / (heatmapData.intensity || 1)).toFixed(3)},
  minOpacity: ${Math.max(0.02, heatmapData.threshold || 0.05)},
  blur:       15,
  gradient:   ${JSON.stringify(leafletGradient)}
};
L.heatLayer(${JSON.stringify(heatmapData.points)}, heatOpts).addTo(map);
` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
${leafletCSSTag}
${clusterCSSTag}
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
  .legend-sub-item { padding-left: 8px; font-size: 11px; color: #666; }
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
${clusterJSTag}
${propertyServiceTag}
<script>
const LAYER_DATA = JSON.parse(decodeURIComponent("${layerDataJSON}"));
const TIER_COLORS = ${JSON.stringify(AppConfig.colors.tierMap)};
const PIN_PATH = ${JSON.stringify(pinPath)};
const HEATMAP_MODE = ${heatmapData ? 'true' : 'false'};
const CLUSTER_SETTINGS = ${clusterSettings ? JSON.stringify(clusterSettings) : 'null'};
const GLOBAL_PIN_SCALE = ${Number(globalPinScale) || 1.0};
const DEFAULT_POPUP_FIELDS = ${JSON.stringify(AppConfig.featureInfo.displayProperties)};
const MAX_POPUP_FIELDS = ${AppConfig.featureInfo.maxPopupFields};
const SYSTEM_KEYS = ${JSON.stringify([...PropertyService.SYSTEM_PROPERTIES])};
const PS = typeof PropertyService !== 'undefined' ? PropertyService : null;

// Mirrors MapManager.featureColor: a property style rule wins, then tier, then layer color.
function featureColor(layer, feature) {
  if (PS && PS.isRule(layer.styleRule)) {
    return PS.resolveColor(layer.styleRule, feature, layer.color || '#0078d4');
  }
  return TIER_COLORS[String(feature.tier == null ? '' : feature.tier).toLowerCase()] || layer.color || '#0078d4';
}

function isSystemKey(key) {
  return SYSTEM_KEYS.indexOf(String(key).toLowerCase()) !== -1 || String(key).charAt(0) === '_';
}

// Mirrors MapManager.infoFieldsFor so exported popups show the same custom columns.
function popupFields(layer, feature) {
  if (layer.infoFields && layer.infoFields.length) return layer.infoFields;
  var fields = [], seen = { name: true };
  function add(key) {
    if (!key || seen[key] || isSystemKey(key)) return;
    seen[key] = true;
    fields.push(key);
  }
  if (layer.styleRule && layer.styleRule.property) add(layer.styleRule.property);
  DEFAULT_POPUP_FIELDS.forEach(add);
  Object.keys(feature).forEach(add);
  return fields.slice(0, MAX_POPUP_FIELDS);
}

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
      var styled = PS && PS.isRule(layer.styleRule);

      var item = document.createElement('div');
      item.className = 'legend-item';
      var dot = document.createElement('div');
      dot.className = 'legend-dot';
      dot.style.background = layer.color || '#0078d4';
      var name = document.createElement('span');
      name.textContent = styled ? layer.name + ' — ' + layer.styleRule.property : layer.name;
      if (!styled) item.appendChild(dot);
      item.appendChild(name);
      div.appendChild(item);

      // Styled layers list their groups so the colors on the map are decodable.
      if (!styled) return;
      PS.legendItems(layer.styleRule, layer.features || []).forEach(function(entry) {
        if (entry.count === 0) return;
        var row = document.createElement('div');
        row.className = 'legend-item legend-sub-item';
        var swatch = document.createElement('div');
        swatch.className = 'legend-dot';
        swatch.style.background = entry.color;
        var label = document.createElement('span');
        label.textContent = entry.label + (entry.count != null ? ' (' + entry.count + ')' : '');
        row.appendChild(swatch);
        row.appendChild(label);
        div.appendChild(row);
      });
    });
    return div;
  }
});
new LegendControl({ position: 'bottomleft' }).addTo(map);

function makeIcon(color, scale) {
  var s = scale || 1;
  var w = Math.round(24 * s), h = Math.round(42 * s);
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -42 24 42" width="' + w + '" height="' + h + '">'
    + '<path d="' + PIN_PATH + '" fill="' + color + '" stroke="white" stroke-width="1.5"/>'
    + '</svg>';
  return L.divIcon({ html: svg, className: '', iconSize: [w, h], iconAnchor: [w/2, h], popupAnchor: [0, -h] });
}

function escapeText(val) {
  return String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function makePopupContent(feature, layer) {
  var html = '<div style="padding:4px"><div class="iw-title">' + escapeText(feature.name || 'Feature') + '</div>';
  popupFields(layer, feature).forEach(function(prop) {
    var v = feature[prop];
    if (v === null || v === undefined || v === '') return;
    html += '<div class="iw-row"><span class="iw-label">' + escapeText(prop) + ':</span>'
          + '<span class="iw-value">' + escapeText(v) + '</span></div>';
  });
  return html + '</div>';
}

// Cluster icon styling — pin-shaped to match the single markers, mirroring the
// live app's renderer so exported clusters look identical to the in-app view.
function clusterStyle(count) {
  if (count < 10)  return { color: '#4CAF50', size: 34 };
  if (count < 50)  return { color: '#FF9800', size: 40 };
  if (count < 100) return { color: '#F44336', size: 46 };
  if (count < 500) return { color: '#9C27B0', size: 54 };
  return { color: '#E91E63', size: 62 };
}
function lightenColor(hex, pct) {
  var n = parseInt(hex.replace('#', ''), 16);
  var amt = Math.round(2.55 * pct);
  var r = Math.min(255, (n >> 16) + amt);
  var g = Math.min(255, ((n >> 8) & 0xff) + amt);
  var b = Math.min(255, (n & 0xff) + amt);
  return '#' + [r, g, b].map(function(v) { return v.toString(16).padStart(2, '0'); }).join('');
}
function formatCount(count) {
  return count >= 1000 ? (count / 1000).toFixed(1) + 'K' : String(count);
}
// Cluster color follows the layer's style rule (aggregated over the cluster's own
// markers) when there is one, mirroring ClusterManager._clusterStyleFor.
function clusterStyleFor(cluster, layer) {
  var byCount = clusterStyle(cluster.getChildCount());
  if (!PS || !PS.isRule(layer.styleRule) || layer.styleRule.applyToClusters === false) return byCount;
  var feats = cluster.getAllChildMarkers().map(function(m) { return m._feature; }).filter(Boolean);
  var agg = PS.aggregate(layer.styleRule, feats, layer.color || '#0078d4');
  return { color: (agg && agg.color) || byCount.color, size: byCount.size };
}

function makeClusterIcon(cluster, layer) {
  var count = cluster.getChildCount();
  var s = clusterStyleFor(cluster, layer);
  var light = lightenColor(s.color, 20);
  var label = formatCount(count);
  var fontSize = label.length <= 2 ? 12 : (label.length === 3 ? 10 : 8.5);
  var w = s.size, h = Math.round(s.size * 46 / 26);
  var uid = 'c' + Math.random().toString(36).slice(2);
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="-13 -44 26 46">'
    + '<defs><radialGradient id="' + uid + '" cx="35%" cy="30%">'
    + '<stop offset="0%" style="stop-color:' + light + ';stop-opacity:1"/>'
    + '<stop offset="100%" style="stop-color:' + s.color + ';stop-opacity:1"/>'
    + '</radialGradient></defs>'
    + '<path d="' + PIN_PATH + '" fill="url(#' + uid + ')" stroke="white" stroke-width="1.5"/>'
    + '<text x="0" y="-30" text-anchor="middle" dominant-baseline="central" fill="white" font-size="' + fontSize + '" font-family="Arial,sans-serif" font-weight="bold">' + label + '</text>'
    + '</svg>';
  return L.divIcon({ html: svg, className: '', iconSize: [w, h], iconAnchor: [w/2, h] });
}

LAYER_DATA.forEach(function(layer) {
  if (!layer.visible) return;

  // In heatmap mode, only layers flagged showOnHeatmap render their pins on top.
  var renderPins = !HEATMAP_MODE || layer.showOnHeatmap;
  var layerScale = GLOBAL_PIN_SCALE * (layer.pinScale != null ? layer.pinScale : 1);
  var layerClusters = CLUSTER_SETTINGS && layer.clusterEnabled !== false;

  // One cluster group per clustered point layer (polygons go straight to map)
  var clusterGroup = (layerClusters && typeof L.markerClusterGroup === 'function')
    ? L.markerClusterGroup({
        maxClusterRadius: CLUSTER_SETTINGS.gridSize,
        disableClusteringAtZoom: CLUSTER_SETTINGS.maxZoom + 1,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        chunkedLoading: true,
        iconCreateFunction: function(cluster) { return makeClusterIcon(cluster, layer); }
      })
    : null;

  (layer.features || []).forEach(function(feature) {
    if (feature.wkt) {
      try {
        var parsed = wellknown ? wellknown.parse(feature.wkt) : null;
        if (parsed && parsed.coordinates) {
          var latlngs = parsed.coordinates[0].map(function(c) { return [c[1], c[0]]; });
          var fillColor = featureColor(layer, feature);
          L.polygon(latlngs, {
            fillColor: fillColor,
            fillOpacity: 0.35,
            color: fillColor,
            weight: 2
          }).bindPopup(makePopupContent(feature, layer)).addTo(map);
        }
      } catch(e) {}
    } else if (renderPins && feature.latitude && feature.longitude) {
      var color = featureColor(layer, feature);
      var marker = L.marker(
        [parseFloat(feature.latitude), parseFloat(feature.longitude)],
        { icon: makeIcon(color, layerScale), title: feature.name || '' }
      ).bindPopup(makePopupContent(feature, layer));
      // Clusters need their members' data to compute an aggregate color.
      marker._feature = feature;
      if (clusterGroup) {
        clusterGroup.addLayer(marker);
      } else {
        marker.addTo(map);
      }
    }
  });

  if (clusterGroup) map.addLayer(clusterGroup);
});
${heatInit}
</script>
</body>
</html>`;
  }
};

AppRegistry.register('mapExport', MapExport);
