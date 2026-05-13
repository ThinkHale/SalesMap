// js/cluster-manager.js — ClusterManager

class ClusterManager {
  constructor(map, mapManager) {
    this._map = map;
    this._mapManager = mapManager || null;
    this._clusterers = new Map(); // layerId → MarkerClusterer
    this._markers = new Map();   // layerId → markers[] (source of truth)
    this._enabled = true;
    this._idleListener = null;
    this._renderTimer = undefined;
  }

  addMarkersToCluster(layerId, markers) {
    if (!markers || markers.length === 0) return;

    if (!this._markers.has(layerId)) this._markers.set(layerId, []);
    this._markers.get(layerId).push(...markers);

    if (!this._enabled) {
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
        const clusterer = new MC({
          map: this._map,
          markers: [],
          renderer: this._buildRenderer(),
          // maxZoom:16 — clusters dissolve at zoom 17, which is street level and
          // reachable on Google Maps. Beyond that each marker shows individually.
          // radius:80 at city zoom reduces the number of small clusters visible.
          algorithm: new markerClusterer.SuperClusterAlgorithm({ maxZoom: 16, radius: 80 })
        });
        this._clusterers.set(layerId, clusterer);
      }

      const clusterer = this._clusterers.get(layerId);
      clusterer.addMarkers(markers, true); // noDraw — batch render via _scheduleRender
      this._scheduleRender();
    } catch (e) {
      console.warn('[ClusterManager] Clustering unavailable:', e.message);
      markers.forEach(m => m.setMap(this._map));
    }
  }

  // Debounce all render() calls so bulk marker adds (CSV import, layer load)
  // produce a single render instead of one per marker (was O(n²) before).
  _scheduleRender() {
    if (this._renderTimer !== undefined) clearTimeout(this._renderTimer);
    this._renderTimer = setTimeout(() => {
      this._renderTimer = undefined;
      this._clusterers.forEach(clusterer => {
        try { clusterer.render(); } catch (e) {}
      });
    }, 0);
  }

  removeLayer(layerId) {
    const clusterer = this._clusterers.get(layerId);
    if (clusterer) {
      try {
        clusterer.clearMarkers();
        clusterer.setMap(null);
      } catch (e) { /* ignore */ }
      this._clusterers.delete(layerId);
    }
    this._markers.delete(layerId);
  }

  clearLayer(layerId) {
    const clusterer = this._clusterers.get(layerId);
    if (clusterer) {
      try { clusterer.clearMarkers(); } catch (e) { /* ignore */ }
    }
    this._markers.delete(layerId);
  }

  setLayerVisible(layerId, visible) {
    const markers = this._markers.get(layerId) || [];
    if (!visible) {
      const clusterer = this._clusterers.get(layerId);
      if (clusterer) try { clusterer.clearMarkers(); } catch (e) {}
      markers.forEach(m => m.setMap(null));
    } else if (this._enabled) {
      const clusterer = this._clusterers.get(layerId);
      if (clusterer) try { clusterer.clearMarkers(true); } catch (e) {}
      this._clusterMarkers(layerId, markers);
    } else {
      this._showMarkersInViewport(markers);
    }
  }

  setEnabled(enabled) {
    if (this._enabled === enabled) return;
    this._enabled = enabled;

    if (!enabled) {
      this._clusterers.forEach(clusterer => {
        try { clusterer.clearMarkers(); } catch (e) {}
      });
      this._refreshUnclustered();
      this._setupIdleListener();
    } else {
      this._removeIdleListener();
      this._markers.forEach((markers, layerId) => {
        const layerData = this._mapManager?.getLayerData(layerId);
        const visible = layerData ? layerData.visible : true;
        if (!visible) return;
        markers.forEach(m => m.setMap(null));
        this._clusterMarkers(layerId, markers);
      });
    }
  }

  // ── Viewport culling (unclustered mode) ────────────────────────────────────

  _setupIdleListener() {
    if (this._idleListener) return;
    // bounds_changed fires during pan/zoom; debounce to 100ms so we cull
    // off-screen markers quickly without triggering on every animation frame.
    let _cullingTimer;
    this._idleListener = google.maps.event.addListener(this._map, 'bounds_changed', () => {
      if (!this._enabled) {
        clearTimeout(_cullingTimer);
        _cullingTimer = setTimeout(() => this._refreshUnclustered(), 100);
      }
    });
  }

  _removeIdleListener() {
    if (this._idleListener) {
      google.maps.event.removeListener(this._idleListener);
      this._idleListener = null;
    }
  }

  // Show only markers within the current map viewport to limit DOM element count.
  _refreshUnclustered() {
    const bounds = this._map.getBounds();
    this._markers.forEach((markers, layerId) => {
      const layerData = this._mapManager?.getLayerData(layerId);
      const layerVisible = layerData ? layerData.visible : true;
      markers.forEach(m => {
        if (!layerVisible) { m.setMap(null); return; }
        if (!bounds) { m.setMap(this._map); return; }
        const pos = m.getPosition();
        m.setMap(pos && bounds.contains(pos) ? this._map : null);
      });
    });
  }

  _showMarkersInViewport(markers) {
    const bounds = this._map.getBounds();
    markers.forEach(m => {
      if (!bounds) { m.setMap(this._map); return; }
      const pos = m.getPosition();
      m.setMap(pos && bounds.contains(pos) ? this._map : null);
    });
  }

  // ── Cluster icon renderer ──────────────────────────────────────────────────

  _buildRenderer() {
    return {
      render({ count, position }) {
        const size = count < 10 ? 36 : count < 100 ? 42 : 48;
        const color = count < 10 ? '#0078d4' : count < 100 ? '#ffb900' : '#d13438';

        const svg = window.btoa(`
          <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
            <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}" fill="${color}" opacity="0.85" stroke="white" stroke-width="2"/>
            <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" fill="white" font-size="${size < 40 ? 12 : 14}" font-family="Arial,sans-serif" font-weight="bold">${count}</text>
          </svg>
        `);

        return new google.maps.Marker({
          position,
          icon: {
            url: `data:image/svg+xml;base64,${svg}`,
            scaledSize: new google.maps.Size(size, size),
            anchor: new google.maps.Point(size/2, size/2)
          },
          label: '',
          zIndex: 1000 + count
        });
      }
    };
  }

  renderSettingsPanel() {
    const panel = Utils.createElement('div', { className: 'cluster-settings' });
    const toggle = Utils.createElement('label', { className: 'settings-toggle' });
    const cb = Utils.createElement('input', { type: 'checkbox' });
    cb.checked = this._enabled;
    cb.addEventListener('change', () => {
      this.setEnabled(cb.checked);
    });
    const lbl = document.createTextNode(' Enable marker clustering');
    toggle.appendChild(cb);
    toggle.appendChild(lbl);
    panel.appendChild(toggle);
    return panel;
  }
}
