// js/cluster-manager.js — ClusterManager

class ClusterManager {
  constructor(map, mapManager) {
    this._map = map;
    this._mapManager = mapManager || null; // optional, used to check layer visibility
    this._clusterers = new Map(); // layerId → MarkerClusterer
    this._markers = new Map();   // layerId → markers[] (source of truth for all markers)
    this._enabled = true;
  }

  addMarkersToCluster(layerId, markers) {
    if (!markers || markers.length === 0) return;

    // Store markers as source of truth (allows re-show on disable)
    if (!this._markers.has(layerId)) this._markers.set(layerId, []);
    this._markers.get(layerId).push(...markers);

    if (!this._enabled) {
      // Clustering disabled — show markers directly on the map
      markers.forEach(m => m.setMap(this._map));
      return;
    }

    // Clustering enabled — hand off control to the clusterer
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
          algorithm: new markerClusterer.SuperClusterAlgorithm({ maxZoom: 14, radius: 60 })
        });
        this._clusterers.set(layerId, clusterer);
      }

      const clusterer = this._clusterers.get(layerId);
      clusterer.addMarkers(markers, true);
      clusterer.render();
    } catch (e) {
      console.warn('[ClusterManager] Clustering unavailable:', e.message);
      markers.forEach(m => m.setMap(this._map));
    }
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
      try {
        clusterer.clearMarkers();
      } catch (e) { /* ignore */ }
    }
    // Clear stored markers — new ones will be registered when the layer is re-rendered
    this._markers.delete(layerId);
  }

  // Called by MapManager.toggleLayerVisibility to respect clustering state
  setLayerVisible(layerId, visible) {
    const markers = this._markers.get(layerId) || [];
    if (!visible) {
      const clusterer = this._clusterers.get(layerId);
      if (clusterer) try { clusterer.clearMarkers(); } catch (e) {}
      markers.forEach(m => m.setMap(null));
    } else if (this._enabled) {
      this._clusterMarkers(layerId, markers);
    } else {
      markers.forEach(m => m.setMap(this._map));
    }
  }

  setEnabled(enabled) {
    if (this._enabled === enabled) return;
    this._enabled = enabled;

    if (!enabled) {
      // Remove all cluster icons, show markers directly
      this._clusterers.forEach(clusterer => {
        try { clusterer.clearMarkers(); } catch (e) {}
      });
      this._markers.forEach((markers, layerId) => {
        const layerData = this._mapManager?.getLayerData(layerId);
        const visible = layerData ? layerData.visible : true;
        markers.forEach(m => m.setMap(visible ? this._map : null));
      });
    } else {
      // Re-cluster all visible layers
      this._markers.forEach((markers, layerId) => {
        const layerData = this._mapManager?.getLayerData(layerId);
        const visible = layerData ? layerData.visible : true;
        if (!visible) return;
        markers.forEach(m => m.setMap(null));
        this._clusterMarkers(layerId, markers);
      });
    }
  }

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
