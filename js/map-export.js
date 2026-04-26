// js/map-export.js — MapExport (static module)

const MapExport = {
  exportViewOnlyMap() {
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

    const html = this._buildExportHTML(layerData, mapCenter, mapZoom);
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

  _buildExportHTML(layerDataJSON, center, zoom) {
    const apiKey = AppConfig.googleMapsApiKey;
    const title = Utils.escapeHtml('SalesMap Export — ' + new Date().toLocaleDateString());

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; height: 100vh; display: flex; flex-direction: column; }
  #header { background: #0078d4; color: white; padding: 12px 20px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
  #header h1 { font-size: 16px; font-weight: 600; }
  #header .subtitle { font-size: 12px; opacity: 0.8; }
  #map { flex: 1; }
  .legend { position: absolute; bottom: 30px; left: 10px; background: white; border-radius: 8px; padding: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); max-width: 200px; max-height: 300px; overflow-y: auto; z-index: 1; }
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
<script>
const LAYER_DATA = ${layerDataJSON};
const TIER_COLORS = ${JSON.stringify(AppConfig.colors.tierMap)};
const PIN_PATH = ${JSON.stringify(AppConfig.marker.pinPath)};

function initMap() {
  const map = new google.maps.Map(document.getElementById('map'), {
    center: ${JSON.stringify(center)},
    zoom: ${zoom},
    mapTypeControl: true,
    streetViewControl: false
  });

  const infoWindow = new google.maps.InfoWindow();
  const legend = document.createElement('div');
  legend.className = 'legend';
  const legendTitle = document.createElement('div');
  legendTitle.className = 'legend-title';
  legendTitle.textContent = 'Layers';
  legend.appendChild(legendTitle);

  LAYER_DATA.forEach(layer => {
    if (!layer.visible) return;
    const legendItem = document.createElement('div');
    legendItem.className = 'legend-item';
    const dot = document.createElement('div');
    dot.className = 'legend-dot';
    dot.style.background = layer.color || '#0078d4';
    const name = document.createElement('span');
    name.textContent = layer.name;
    legendItem.appendChild(dot);
    legendItem.appendChild(name);
    legend.appendChild(legendItem);

    (layer.features || []).forEach(feature => {
      if (feature.wkt) {
        try {
          const parsed = wellknown ? wellknown.parse(feature.wkt) : null;
          if (parsed && parsed.coordinates) {
            const paths = parsed.coordinates[0].map(c => ({ lat: c[1], lng: c[0] }));
            const poly = new google.maps.Polygon({
              paths,
              fillColor: TIER_COLORS[String(feature.tier||'').toLowerCase()] || layer.color,
              fillOpacity: 0.35,
              strokeColor: layer.color,
              strokeWeight: 2,
              map
            });
            poly.addListener('click', (e) => showInfo(infoWindow, feature, map, e.latLng));
          }
        } catch(e) { }
      } else if (feature.latitude && feature.longitude) {
        const tierColor = TIER_COLORS[String(feature.tier||'').toLowerCase()];
        const marker = new google.maps.Marker({
          position: { lat: parseFloat(feature.latitude), lng: parseFloat(feature.longitude) },
          map,
          title: feature.name || '',
          icon: {
            path: PIN_PATH,
            fillColor: tierColor || layer.color || '#0078d4',
            fillOpacity: 0.9,
            strokeColor: '#ffffff',
            strokeWeight: 1.5,
            scale: 0.7,
            anchor: new google.maps.Point(0, 0)
          }
        });
        marker.addListener('click', () => showInfo(infoWindow, feature, map, marker.getPosition(), marker));
      }
    });
  });

  map.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(legend);
}

function showInfo(infoWindow, feature, map, position, marker) {
  const div = document.createElement('div');
  div.style.padding = '4px';
  const title = document.createElement('div');
  title.className = 'iw-title';
  title.textContent = feature.name || 'Feature';
  div.appendChild(title);
  ['description','tier','bdm','revenue'].forEach(prop => {
    if (feature[prop]) {
      const row = document.createElement('div');
      row.className = 'iw-row';
      const lbl = document.createElement('span');
      lbl.className = 'iw-label';
      lbl.textContent = prop + ':';
      const val = document.createElement('span');
      val.className = 'iw-value';
      val.textContent = feature[prop];
      row.appendChild(lbl);
      row.appendChild(val);
      div.appendChild(row);
    }
  });
  infoWindow.setContent(div);
  infoWindow.setPosition(position);
  if (marker) infoWindow.open(map, marker);
  else infoWindow.open(map);
}
</script>
<script src="https://unpkg.com/wellknown@0.5.0/wellknown.js"></script>
<script async src="https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry&callback=initMap"></script>
</body>
</html>`;
  }
};

AppRegistry.register('mapExport', MapExport);
