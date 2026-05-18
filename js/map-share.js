// js/map-share.js — MapShare (static module)

const MapShare = {
  async createShareLink() {
    const layerManager = AppRegistry.require('layerManager');
    const layers = layerManager.getAllLayers();
    const mapManager = AppRegistry.get('mapManager');

    const center = mapManager
      ? { lat: mapManager.map.getCenter().lat(), lng: mapManager.map.getCenter().lng() }
      : { lat: AppConfig.map.defaultCenter.lat, lng: AppConfig.map.defaultCenter.lng };
    const zoom = mapManager ? mapManager.map.getZoom() : AppConfig.map.defaultZoom;

    let heatmap = null;
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
          heatmap = {
            points,
            gradient: cfg.gradient || 'fire',
            radius: cfg.radius || 30,
            opacity: cfg.opacity || 0.7,
            maxIntensity: cfg.maxIntensity || 10
          };
        }
      }
    }

    const snapshot = {
      center,
      zoom,
      layers: layers.map(l => ({
        id: l.id,
        name: l.name,
        type: l.type,
        color: l.color,
        visible: l.visible,
        features: (l.features || []).map(f => ({ ...f }))
      })),
      tierColors: AppConfig.colors.tierMap,
      pinPath: AppConfig.marker.pinPath,
      heatmap,
      createdAt: new Date().toISOString()
    };

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await firebase.database().ref('salesTerritoryData/mapShares/' + id).set(snapshot);

    const shareUrl = new URL('share.html', window.location.href);
    shareUrl.searchParams.set('id', id);
    return shareUrl.toString();
  },

  showShareDialog(url) {
    document.getElementById('shareDialog')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'shareDialog';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:10px;padding:24px;width:460px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,0.25);';
    box.innerHTML = `
      <h2 style="font-size:16px;font-weight:600;margin-bottom:4px;color:#111;">Share Map</h2>
      <p style="font-size:13px;color:#555;margin-bottom:16px;">Anyone with this link can view a read-only snapshot of your current map.</p>
      <div style="display:flex;gap:8px;margin-bottom:20px;">
        <input id="shareLinkInput" type="text" readonly value="${Utils.escapeHtml(url)}"
          style="flex:1;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px;background:#f5f5f5;color:#333;min-width:0;">
        <button id="copyShareLink"
          style="padding:8px 14px;background:#0078d4;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap;flex-shrink:0;">
          Copy
        </button>
      </div>
      <div style="display:flex;justify-content:flex-end;">
        <button id="closeShareDialog"
          style="padding:8px 16px;background:#f0f0f0;border:none;border-radius:6px;font-size:13px;cursor:pointer;">
          Close
        </button>
      </div>`;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document.getElementById('copyShareLink').addEventListener('click', async () => {
      const btn = document.getElementById('copyShareLink');
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        document.getElementById('shareLinkInput').select();
        document.execCommand('copy');
      }
      btn.textContent = 'Copied!';
      btn.style.background = '#107c10';
      setTimeout(() => { btn.textContent = 'Copy'; btn.style.background = '#0078d4'; }, 2000);
    });

    const close = () => overlay.remove();
    document.getElementById('closeShareDialog').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.getElementById('shareLinkInput').addEventListener('click', e => e.target.select());
  }
};

AppRegistry.register('mapShare', MapShare);
