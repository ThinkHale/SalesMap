// js/cluster-manager.js — ClusterManager

class ClusterManager {
  constructor(map) {
    this._map = map;
    this._clusterers = new Map(); // layerId → MarkerClusterer
    this._enabled = true;
  }

  addMarkersToCluster(layerId, markers) {
    if (!this._enabled) return;
    if (!markers || markers.length === 0) return;

    try {
      if (typeof markerClusterer !== 'undefined' || (window.markerClusterer)) {
        const MC = window.markerClusterer?.MarkerClusterer;
        if (!MC) return;

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
      }
    } catch (e) {
      // Cluster library not available or failed — markers already added directly to map
      console.warn('[ClusterManager] Clustering unavailable:', e.message);
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
  }

  clearLayer(layerId) {
    const clusterer = this._clusterers.get(layerId);
    if (clusterer) {
      try {
        clusterer.clearMarkers();
      } catch (e) { /* ignore */ }
    }
  }

  setEnabled(enabled) {
    this._enabled = enabled;
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
      this._enabled = cb.checked;
      if (!this._enabled) {
        this._clusterers.forEach((c, id) => c.clearMarkers());
      }
    });
    const lbl = document.createTextNode(' Enable marker clustering');
    toggle.appendChild(cb);
    toggle.appendChild(lbl);
    panel.appendChild(toggle);
    return panel;
  }
}
