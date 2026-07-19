// js/cluster-manager.js — ClusterManager

class ClusterManager {
  constructor(map, mapManager) {
    this._map = map;
    this._mapManager = mapManager || null;
    this._clusterers = new Map(); // layerId → MarkerClusterer
    this._markers = new Map();   // layerId → markers[] (source of truth)
    this._clusteredSets = new Map(); // layerId → Set of marker objects currently in clusterer
    this._idleListener = null;
    this._renderTimer = undefined;
    this._spiderfyMarkers = [];
    this._spiderMapListener = null;
    this._settings = this._loadSettings();
    // Reconcile runtime flag with persisted setting so a disabled state survives reload.
    this._enabled = this._settings.enabled !== false;
    // Optional predicate (featureData) => boolean. When set, markers that fail it
    // are hidden from both clustered and unclustered rendering. Used by plugins
    // like the Filter/Query panel and the Radius tool.
    this._featureFilter = null;
  }

  // A marker passes when there is no active filter or the filter accepts its data.
  _passesFilter(marker) {
    return !this._featureFilter || this._featureFilter(marker._featureData);
  }

  // Install (or clear, with null) a feature-level visibility predicate, then
  // re-render every layer so clusters recount and stray markers disappear.
  setFeatureFilter(predicate) {
    this._featureFilter = predicate || null;
    this._markers.forEach((markers, layerId) => {
      const layerData = this._mapManager?.getLayerData(layerId);
      const visible = layerData ? layerData.visible : true;
      markers.forEach(m => m.setMap(null));
      if (!visible) return;
      if (this._layerClusters(layerId)) {
        this._rebuildClusterer(layerId, markers);
      } else {
        this._setupIdleListener();
        this._showMarkersInViewport(markers);
      }
    });
  }

  _defaultSettings() {
    return {
      enabled: true,
      gridSize: 60,
      minClusterSize: 2,
      maxZoom: 16,
      spiderfy: true,
      spiderfyMaxMarkers: 10,
      pinScale: 1.0
    };
  }

  _loadSettings() {
    try {
      const stored = localStorage.getItem('salesMap_clusterSettings');
      if (stored) return { ...this._defaultSettings(), ...JSON.parse(stored) };
    } catch (e) {}
    return this._defaultSettings();
  }

  _saveSettings() {
    try {
      localStorage.setItem('salesMap_clusterSettings', JSON.stringify(this._settings));
    } catch (e) {}
  }

  // A layer is clustered only when the global toggle is on AND the layer hasn't
  // opted out via its per-layer clusterEnabled override.
  _layerClusters(layerId) {
    if (!this._enabled) return false;
    const layer = AppRegistry.has('layerManager')
      ? AppRegistry.get('layerManager').getLayer(layerId) : null;
    return !layer || layer.clusterEnabled !== false;
  }

  addMarkersToCluster(layerId, markers) {
    if (!markers || markers.length === 0) return;

    if (!this._markers.has(layerId)) this._markers.set(layerId, []);
    this._markers.get(layerId).push(...markers);

    if (!this._layerClusters(layerId)) {
      // Ensure viewport culling is active even when clustering started disabled on load.
      this._setupIdleListener();
      this._showMarkersInViewport(markers);
      return;
    }

    markers.forEach(m => m.setMap(null));
    this._clusterMarkers(layerId, markers);
  }

  _clusterMarkers(layerId, markers) {
    if (!markers || markers.length === 0) return;
    try {
      const MC = window.markerClusterer?.MarkerClusterer;
      if (!MC) {
        markers.forEach(m => m.setMap(this._map));
        return;
      }

      if (!this._clusterers.has(layerId)) {
        const algorithm = window.markerClusterer?.GridAlgorithm
          ? new markerClusterer.GridAlgorithm({ gridSize: this._settings.gridSize, maxZoom: this._settings.maxZoom, minClusterSize: this._settings.minClusterSize })
          : new markerClusterer.SuperClusterAlgorithm({ maxZoom: this._settings.maxZoom, radius: this._settings.gridSize, minPoints: this._settings.minClusterSize });

        const clusterer = new MC({
          map: this._map,
          markers: [],
          renderer: this._buildRenderer(),
          algorithm,
          onClusterClick: (event, cluster) => this._handleClusterClick(event, cluster)
        });
        this._clusterers.set(layerId, clusterer);
        this._clusteredSets.set(layerId, new Set());
      }

      const clusterer = this._clusterers.get(layerId);
      const tracked = this._clusteredSets.get(layerId);

      // Deduplicate: only add markers not already tracked, and honor the filter.
      const toAdd = markers.filter(m => !tracked.has(m) && this._passesFilter(m));
      if (toAdd.length === 0) return;

      toAdd.forEach(m => tracked.add(m));
      clusterer.addMarkers(toAdd, true); // noDraw — batch render via _scheduleRender
      this._scheduleRender();
    } catch (e) {
      console.warn('[ClusterManager] Clustering unavailable:', e.message);
      markers.forEach(m => m.setMap(this._map));
    }
  }

  // Fully tears down and recreates the clusterer for a layer, ensuring no stale
  // marker counts survive visibility toggles or heatmap show/hide cycles.
  _rebuildClusterer(layerId, markers) {
    const old = this._clusterers.get(layerId);
    if (old) {
      try { old.clearMarkers(); old.setMap(null); } catch (e) {}
      this._clusterers.delete(layerId);
    }
    this._clusteredSets.delete(layerId);
    this._clusterMarkers(layerId, markers);
  }

  // Debounce all render() calls so bulk marker adds produce a single render.
  _scheduleRender() {
    if (this._renderTimer !== undefined) clearTimeout(this._renderTimer);
    this._renderTimer = setTimeout(() => {
      this._renderTimer = undefined;
      this._clusterers.forEach(clusterer => {
        try { clusterer.render(); } catch (e) {}
      });
    }, 0);
  }

  // ── Cluster click / spider-out ────────────────────────────────────────────

  _handleClusterClick(event, cluster) {
    this._clearSpiderfy();
    const markers = cluster.markers;

    if (markers.length <= this._settings.spiderfyMaxMarkers && this._settings.spiderfy) {
      this._spiderfyCluster(cluster, markers);
    } else {
      this._zoomToClusterBounds(markers);
    }
  }

  _spiderfyCluster(cluster, markers) {
    const center = cluster.position;
    const count = markers.length;
    const angleStep = (2 * Math.PI) / count;
    const zoom = this._map.getZoom() || 12;
    // ~40px offset in meters at current zoom
    const metersPerPx = 156543.03 * Math.cos(center.lat() * Math.PI / 180) / Math.pow(2, zoom);
    const legMeters = metersPerPx * 40;

    this._spiderfyMarkers = markers.map((marker, i) => {
      const angle = angleStep * i - Math.PI / 2;
      let targetPos;
      try {
        targetPos = google.maps.geometry.spherical.computeOffset(center, legMeters, angle * 180 / Math.PI);
      } catch (e) {
        targetPos = marker.getPosition();
      }

      const line = new google.maps.Polyline({
        path: [center, targetPos],
        strokeColor: '#555',
        strokeOpacity: 0.5,
        strokeWeight: 1.5,
        map: this._map,
        zIndex: 999
      });

      const spiderMarker = new google.maps.Marker({
        position: targetPos,
        map: this._map,
        icon: marker.getIcon(),
        title: marker.getTitle(),
        zIndex: 1001
      });

      // Forward clicks to the original marker's listener
      spiderMarker.addListener('click', () => google.maps.event.trigger(marker, 'click'));

      return { marker: spiderMarker, line };
    });

    this._spiderMapListener = google.maps.event.addListenerOnce(this._map, 'click', () => this._clearSpiderfy());
  }

  _clearSpiderfy() {
    this._spiderfyMarkers.forEach(({ marker, line }) => {
      marker.setMap(null);
      line.setMap(null);
    });
    this._spiderfyMarkers = [];
    if (this._spiderMapListener) {
      google.maps.event.removeListener(this._spiderMapListener);
      this._spiderMapListener = null;
    }
  }

  _zoomToClusterBounds(markers) {
    const bounds = new google.maps.LatLngBounds();
    markers.forEach(m => bounds.extend(m.getPosition()));
    this._map.fitBounds(bounds);
    setTimeout(() => {
      if (this._map.getZoom() > 18) this._map.setZoom(18);
    }, 300);
  }

  // ── Layer management ──────────────────────────────────────────────────────

  removeLayer(layerId) {
    const clusterer = this._clusterers.get(layerId);
    if (clusterer) {
      try {
        clusterer.clearMarkers();
        clusterer.setMap(null);
      } catch (e) { /* ignore */ }
      this._clusterers.delete(layerId);
    }
    this._clusteredSets.delete(layerId);
    this._markers.delete(layerId);
  }

  clearLayer(layerId) {
    const clusterer = this._clusterers.get(layerId);
    if (clusterer) {
      try { clusterer.clearMarkers(); } catch (e) { /* ignore */ }
    }
    this._clusteredSets.delete(layerId);
    this._markers.delete(layerId);
  }

  setLayerVisible(layerId, visible) {
    const markers = this._markers.get(layerId) || [];
    if (!visible) {
      const clusterer = this._clusterers.get(layerId);
      if (clusterer) try { clusterer.clearMarkers(); } catch (e) {}
      this._clusteredSets.delete(layerId);
      markers.forEach(m => m.setMap(null));
    } else if (this._layerClusters(layerId)) {
      this._rebuildClusterer(layerId, markers);
    } else {
      this._setupIdleListener();
      this._showMarkersInViewport(markers);
    }
  }

  // Heatmap-specific: visually hide/show without changing logical layer state.
  hideLayerForHeatmap(layerId) {
    const clusterer = this._clusterers.get(layerId);
    if (clusterer) try { clusterer.clearMarkers(); } catch (e) {}
    this._clusteredSets.delete(layerId);
    (this._markers.get(layerId) || []).forEach(m => m.setMap(null));
  }

  showLayerForHeatmap(layerId) {
    const layerData = this._mapManager?.getLayerData(layerId);
    const visible = layerData ? layerData.visible : true;
    if (!visible) return;
    const markers = this._markers.get(layerId) || [];
    if (this._layerClusters(layerId)) {
      this._rebuildClusterer(layerId, markers);
    } else {
      this._setupIdleListener();
      this._showMarkersInViewport(markers);
    }
  }

  setEnabled(enabled) {
    if (this._enabled === enabled) return;
    this._enabled = enabled;
    this._settings.enabled = enabled;
    this._saveSettings();

    if (!enabled) {
      this._clusterers.forEach(clusterer => {
        try { clusterer.clearMarkers(); } catch (e) {}
      });
      this._clusteredSets.clear();
      this._refreshUnclustered();
      this._setupIdleListener();
    } else {
      this._markers.forEach((markers, layerId) => {
        const layerData = this._mapManager?.getLayerData(layerId);
        const visible = layerData ? layerData.visible : true;
        if (!visible) return;
        markers.forEach(m => m.setMap(null));
        if (this._layerClusters(layerId)) {
          this._rebuildClusterer(layerId, markers);
        } else {
          this._setupIdleListener();
          this._showMarkersInViewport(markers);
        }
      });
    }
  }

  // ── Viewport culling (unclustered mode) ───────────────────────────────────

  _setupIdleListener() {
    if (this._idleListener) return;
    let _cullingTimer;
    this._idleListener = google.maps.event.addListener(this._map, 'bounds_changed', () => {
      clearTimeout(_cullingTimer);
      _cullingTimer = setTimeout(() => this._refreshUnclustered(), 100);
    });
  }

  _removeIdleListener() {
    if (this._idleListener) {
      google.maps.event.removeListener(this._idleListener);
      this._idleListener = null;
    }
  }

  _refreshUnclustered() {
    const bounds = this._map.getBounds();
    this._markers.forEach((markers, layerId) => {
      // Clustered layers are managed by their clusterer — don't cull them here.
      if (this._layerClusters(layerId)) return;
      const layerData = this._mapManager?.getLayerData(layerId);
      const layerVisible = layerData ? layerData.visible : true;
      markers.forEach(m => {
        if (!layerVisible || !this._passesFilter(m)) { m.setMap(null); return; }
        if (!bounds) { m.setMap(this._map); return; }
        const pos = m.getPosition();
        m.setMap(pos && bounds.contains(pos) ? this._map : null);
      });
    });
  }

  _showMarkersInViewport(markers) {
    const bounds = this._map.getBounds();
    markers.forEach(m => {
      if (!this._passesFilter(m)) { m.setMap(null); return; }
      if (!bounds) { m.setMap(this._map); return; }
      const pos = m.getPosition();
      m.setMap(pos && bounds.contains(pos) ? this._map : null);
    });
  }

  // ── Cluster icon renderer ─────────────────────────────────────────────────

  // `size` is the pin width in px; height is derived from the pin aspect ratio.
  _getClusterStyle(count) {
    if (count < 10)  return { color: '#4CAF50', size: 34 };
    if (count < 50)  return { color: '#FF9800', size: 40 };
    if (count < 100) return { color: '#F44336', size: 46 };
    if (count < 500) return { color: '#9C27B0', size: 54 };
    return { color: '#E91E63', size: 62 };
  }

  _lightenColor(hex, pct) {
    const n = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * pct);
    const r = Math.min(255, (n >> 16) + amt);
    const g = Math.min(255, ((n >> 8) & 0xff) + amt);
    const b = Math.min(255, (n & 0xff) + amt);
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  _formatCount(count) {
    return count >= 1000 ? (count / 1000).toFixed(1) + 'K' : String(count);
  }

  // Cluster pins reuse the single-marker teardrop shape (AppConfig.marker.pinPath)
  // scaled up, with the count rendered inside the pin head — so a lone marker and
  // a cluster read as the same visual family.
  _buildClusterPinSvg(count) {
    const { color, size } = this._getClusterStyle(count);
    const light = this._lightenColor(color, 20);
    const label = this._formatCount(count);
    const fontSize = label.length <= 2 ? 12 : (label.length === 3 ? 10 : 8.5);
    const w = size;
    const h = Math.round(size * 46 / 26); // viewBox is 26 wide × 46 tall
    const uid = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const pinPath = AppConfig.marker.pinPath;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="-13 -44 26 46">
      <defs>
        <radialGradient id="${uid}" cx="35%" cy="30%">
          <stop offset="0%" style="stop-color:${light};stop-opacity:1"/>
          <stop offset="100%" style="stop-color:${color};stop-opacity:1"/>
        </radialGradient>
      </defs>
      <path d="${pinPath}" fill="url(#${uid})" stroke="white" stroke-width="1.5"/>
      <text x="0" y="-30" text-anchor="middle" dominant-baseline="central" fill="white" font-size="${fontSize}" font-family="Arial,sans-serif" font-weight="bold">${label}</text>
    </svg>`;

    return { svg, w, h };
  }

  _buildRenderer() {
    return {
      render: ({ count, position }) => {
        const { svg, w, h } = this._buildClusterPinSvg(count);
        return new google.maps.Marker({
          position,
          icon: {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
            scaledSize: new google.maps.Size(w, h),
            anchor: new google.maps.Point(w / 2, h) // tip of the pin
          },
          label: '',
          zIndex: 1000 + count
        });
      }
    };
  }

  setGridSize(px) {
    this._settings.gridSize = px;
    this._saveSettings();
    this._reclusterAll();
  }

  setMaxZoom(z) {
    this._settings.maxZoom = z;
    this._saveSettings();
    this._reclusterAll();
  }

  setMinClusterSize(n) {
    this._settings.minClusterSize = n;
    this._saveSettings();
    this._reclusterAll();
  }

  setPinScale(scale) {
    this._settings.pinScale = scale;
    this._saveSettings();
    // Pin scale lives on the marker icons, so every layer must be re-rendered.
    const lm = AppRegistry.has('layerManager') ? AppRegistry.get('layerManager') : null;
    if (lm) lm.getAllLayers().forEach(l => lm.refreshLayerDisplay(l.id));
  }

  // Tear down every clusterer and rebuild from the source-of-truth markers so a
  // settings change (gridSize/maxZoom/minClusterSize) takes effect immediately.
  _reclusterAll() {
    if (!this._enabled) return;
    this._markers.forEach((markers, layerId) => {
      const layerData = this._mapManager?.getLayerData(layerId);
      const visible = layerData ? layerData.visible : true;
      if (!visible) return;
      markers.forEach(m => m.setMap(null));
      this._rebuildClusterer(layerId, markers);
    });
  }

  getSettings() { return { ...this._settings, enabled: this._enabled }; }

  resetSettings() {
    const d = this._defaultSettings();
    this._settings = { ...d, enabled: this._enabled };
    this._saveSettings();
    this.setPinScale(d.pinScale);
    this._reclusterAll();
  }

  // Small inline toggle for the layers toolbar.
  renderSettingsPanel() {
    const panel = Utils.createElement('div', { className: 'cluster-settings' });

    const toggle = Utils.createElement('label', { className: 'settings-toggle' });
    const cb = Utils.createElement('input', { type: 'checkbox' });
    cb.checked = this._enabled;
    cb.addEventListener('change', () => this.setEnabled(cb.checked));
    toggle.appendChild(cb);
    toggle.appendChild(document.createTextNode(' Cluster'));
    panel.appendChild(toggle);

    return panel;
  }

  // Full settings UI rendered into the Plugins-modal drawer.
  renderSettingsDrawer() {
    const wrap = Utils.createElement('div', { className: 'cluster-settings-drawer' });

    const slider = (label, key, min, max, step, decimals, getVal, onInput) => {
      const group = Utils.createElement('div', { className: 'form-group' });
      const row = Utils.createElement('div', { className: 'styler-slider-label-row' });
      const lbl = Utils.createElement('label', { className: 'form-label' }, label);
      const val = Utils.createElement('span', { className: 'styler-slider-value' });
      const fmt = v => Number(v).toFixed(decimals);
      val.textContent = fmt(getVal());
      row.appendChild(lbl);
      row.appendChild(val);
      const input = Utils.createElement('input', { type: 'range', className: 'styler-slider' });
      input.min = min; input.max = max; input.step = step; input.value = getVal();
      input.addEventListener('input', () => {
        val.textContent = fmt(input.value);
        onInput(parseFloat(input.value));
      });
      group.appendChild(row);
      group.appendChild(input);
      wrap.appendChild(group);
      return input;
    };

    // Enable clustering
    const enableGroup = Utils.createElement('div', { className: 'form-group' });
    const enableToggle = Utils.createElement('label', { className: 'settings-toggle' });
    const enableCb = Utils.createElement('input', { type: 'checkbox' });
    enableCb.checked = this._enabled;
    enableCb.addEventListener('change', () => this.setEnabled(enableCb.checked));
    enableToggle.appendChild(enableCb);
    enableToggle.appendChild(document.createTextNode(' Enable marker clustering'));
    enableGroup.appendChild(enableToggle);
    wrap.appendChild(enableGroup);

    // Pin size (global)
    slider('Pin Size (×)', 'pinScale', 0.4, 2.5, 0.1, 1,
      () => this._settings.pinScale ?? 1.0,
      v => this.setPinScale(v));

    // Cluster radius (gridSize)
    slider('Cluster Radius (px)', 'gridSize', 20, 160, 5, 0,
      () => this._settings.gridSize ?? 60,
      v => this.setGridSize(v));

    // Max zoom to cluster
    slider('Cluster Up To Zoom', 'maxZoom', 4, 20, 1, 0,
      () => this._settings.maxZoom ?? 16,
      v => this.setMaxZoom(v));

    // Min cluster size
    slider('Min Markers Per Cluster', 'minClusterSize', 2, 10, 1, 0,
      () => this._settings.minClusterSize ?? 2,
      v => this.setMinClusterSize(v));

    // Spiderfy
    const spiderGroup = Utils.createElement('div', { className: 'form-group' });
    const spiderToggle = Utils.createElement('label', { className: 'settings-toggle' });
    const spiderCb = Utils.createElement('input', { type: 'checkbox' });
    spiderCb.checked = this._settings.spiderfy;
    spiderCb.addEventListener('change', () => {
      this._settings.spiderfy = spiderCb.checked;
      this._saveSettings();
    });
    spiderToggle.appendChild(spiderCb);
    spiderToggle.appendChild(document.createTextNode(' Spider-out small clusters on click'));
    spiderGroup.appendChild(spiderToggle);
    wrap.appendChild(spiderGroup);

    // Reset
    const resetBtn = Utils.createElement('button', { className: 'btn btn-secondary btn-sm' }, 'Reset to Defaults');
    resetBtn.style.marginTop = '10px';
    resetBtn.addEventListener('click', () => {
      this.resetSettings();
      // Re-render the drawer to reflect reset values
      const parent = wrap.parentNode;
      if (parent) { parent.innerHTML = ''; parent.appendChild(this.renderSettingsDrawer()); }
    });
    wrap.appendChild(resetBtn);

    return wrap;
  }
}
