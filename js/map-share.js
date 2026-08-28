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

    // Heatmap styling only — the share page derives the points from whichever
    // layers the viewer has visible, so they can switch the heatmap on even if it
    // was off when the link was made (and the snapshot stays much smaller).
    let heatmapParams = null;
    if (AppRegistry.has('pluginRegistry')) {
      const pluginDef = AppRegistry.get('pluginRegistry').getDefinition('heatmap-overlay');
      if (pluginDef && pluginDef._api) {
        const cfg = pluginDef._api.config.get();
        heatmapParams = {
          colorRange: pluginDef._colorRanges[cfg.gradient] || pluginDef._colorRanges.default,
          radius:    cfg.radius    || 30,
          opacity:   cfg.opacity   || 0.7,
          intensity: cfg.intensity || 1,
          threshold: cfg.threshold || 0.05
        };
      }
    }

    // Cluster settings are always emitted, with the author's on/off state as a
    // starting point the viewer can change. (They're also needed alongside a
    // heatmap so layers flagged showOnHeatmap still cluster their pins on top.)
    let globalPinScale = 1.0;
    let clusterSettings = { enabled: false, maxZoom: 16, minClusterSize: 2, gridSize: 60 };
    if (AppRegistry.has('clusterManager')) {
      const cm = AppRegistry.get('clusterManager');
      const s = cm._settings || cm._defaultSettings();
      globalPinScale = s.pinScale ?? 1.0;
      clusterSettings = {
        enabled:        s.enabled !== false && cm._enabled !== false,
        maxZoom:        s.maxZoom        ?? 16,
        minClusterSize: s.minClusterSize ?? 2,
        gridSize:       s.gridSize       ?? 60
      };
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
        pinScale: l.pinScale ?? 1.0,
        showOnHeatmap: !!l.showOnHeatmap,
        clusterEnabled: l.clusterEnabled !== false,
        // Property styling + popup fields so the shared view matches the live map.
        styleRule: l.styleRule || null,
        infoFields: l.infoFields || null,
        features: (l.features || []).map(f => ({ ...f }))
      })),
      tierColors: AppConfig.colors.tierMap,
      pinPath: AppConfig.marker.pinPath,
      globalPinScale,
      heatmapParams,
      clusterSettings,
      createdAt: new Date().toISOString()
    };

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await firebase.database().ref('salesTerritoryData/mapShares/' + id).set(snapshot);

    const shareUrl = new URL('share.html', window.location.href);
    shareUrl.searchParams.set('id', id);
    // The snapshot comes back with the URL so the dialog can offer the same data
    // as text, without a second read of every layer.
    return { url: shareUrl.toString(), snapshot };
  },

  showShareDialog(url, snapshot) {
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
      <div style="border-top:1px solid #eee;padding-top:16px;margin-bottom:20px;">
        <h3 style="font-size:13px;font-weight:600;margin-bottom:4px;color:#111;">Copy the data itself</h3>
        <p style="font-size:12px;color:#666;margin-bottom:10px;">
          The link opens an interactive map, but reads as blank to anything that can't run it —
          an AI assistant, a chat preview. Paste this text instead.
        </p>
        <div style="display:flex;gap:8px;">
          <button id="copyShareSummary" data-label="Copy summary"
            style="padding:7px 12px;background:#f0f0f0;border:1px solid #ddd;border-radius:6px;font-size:12px;cursor:pointer;">
            Copy summary
          </button>
          <button id="copyShareGeoJSON" data-label="Copy GeoJSON"
            style="padding:7px 12px;background:#f0f0f0;border:1px solid #ddd;border-radius:6px;font-size:12px;cursor:pointer;">
            Copy GeoJSON
          </button>
        </div>
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
      if (!await Clipboard.copyOrShow(url, 'Copy share link')) return;
      btn.textContent = 'Copied!';
      btn.style.background = '#107c10';
      setTimeout(() => { btn.textContent = 'Copy'; btn.style.background = '#0078d4'; }, 2000);
    });

    const wireDataButton = (id, build) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', async () => {
        const label = btn.dataset.label;
        const settle = text => {
          btn.textContent = text;
          setTimeout(() => { btn.textContent = label; }, 1800);
        };
        let payload;
        try {
          payload = build();
        } catch (err) {
          console.error(`[MapShare] ${label} failed:`, err);
          settle('Failed');
          return;
        }
        // A blocked copy opens the manual overlay instead of claiming success.
        if (await Clipboard.copyOrShow(payload, label)) settle('Copied!');
      });
    };
    // Guard the snapshot: an older caller may still pass only a URL.
    if (snapshot && typeof SnapshotData !== 'undefined') {
      wireDataButton('copyShareSummary', () => SnapshotData.toSummary(snapshot));
      wireDataButton('copyShareGeoJSON', () => SnapshotData.toGeoJSONText(snapshot));
    } else {
      ['copyShareSummary', 'copyShareGeoJSON'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'default'; }
      });
    }

    const close = () => overlay.remove();
    document.getElementById('closeShareDialog').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.getElementById('shareLinkInput').addEventListener('click', e => e.target.select());
  }
};

AppRegistry.register('mapShare', MapShare);
