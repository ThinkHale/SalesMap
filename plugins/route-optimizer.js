// plugins/route-optimizer.js — Nearest-neighbor + 2-opt route ordering
// Orders the pins of a layer into an efficient visiting sequence and draws the
// route, with a numbered day-plan list and total distance / estimated drive time.

const RouteOptimizerPlugin = {
  id: 'route-optimizer',
  name: 'Route Optimizer',
  version: '1.0.0',
  description: 'Order a layer\'s pins into an efficient route (nearest-neighbor + 2-opt) with a numbered day plan.',
  author: 'SalesMapper',
  minAppVersion: '4.0.0',

  permissions: ['layers.read', 'map.read', 'map.write', 'ui.slot:toolbar', 'ui.modal', 'ui.toast'],
  configSchema: {},

  _api: null,
  _polyline: null,
  _markers: [],
  _drawerBody: null,

  init(api) {
    this._api = api;
    api.ui.addToolbarButton({
      icon: '🗺',
      tooltip: 'Optimize a visiting route',
      onClick: () => this._openPanel()
    });
  },

  destroy() { this._clearRoute(); },

  _pointLayers() {
    return this._api.layers.getAll().filter(l => l.visible &&
      (l.features || []).some(f => !isNaN(parseFloat(f.latitude)) && !isNaN(parseFloat(f.longitude))));
  },

  _openPanel() {
    const layers = this._pointLayers();
    if (layers.length === 0) { this._api.ui.toast.warning('No visible point layers to route'); return; }

    this._api.ui.modal.openDrawer(body => {
      this._drawerBody = body;
      body.innerHTML = '';

      const layGroup = Utils.createElement('div', { className: 'form-group' });
      layGroup.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Layer to route'));
      const laySel = Utils.createElement('select', { className: 'form-control' });
      layers.forEach(l => laySel.appendChild(Utils.createElement('option', { value: l.id },
        `${l.name} (${(l.features || []).filter(f => !isNaN(parseFloat(f.latitude))).length})`)));
      layGroup.appendChild(laySel);
      body.appendChild(layGroup);

      const startGroup = Utils.createElement('div', { className: 'form-group' });
      startGroup.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Start from'));
      const startSel = Utils.createElement('select', { className: 'form-control' });
      startSel.appendChild(Utils.createElement('option', { value: 'center' }, 'Nearest pin to map center'));
      startSel.appendChild(Utils.createElement('option', { value: 'first' }, 'First pin in layer'));
      startGroup.appendChild(startSel);
      body.appendChild(startGroup);

      const mphGroup = Utils.createElement('div', { className: 'form-group' });
      mphGroup.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Avg speed (mph) for time estimate'));
      const mph = Utils.createElement('input', { type: 'number', className: 'form-control', min: '5' });
      mph.value = 40;
      mphGroup.appendChild(mph);
      body.appendChild(mphGroup);

      const goBtn = Utils.createElement('button', { className: 'btn btn-primary', style: { marginTop: '10px' } }, 'Optimize Route');
      goBtn.addEventListener('click', () => this._optimize(laySel.value, startSel.value, parseFloat(mph.value) || 40));
      body.appendChild(goBtn);

      const clearBtn = Utils.createElement('button', { className: 'btn btn-secondary', style: { marginTop: '10px', marginLeft: '8px' } }, 'Clear');
      clearBtn.addEventListener('click', () => this._clearRoute());
      body.appendChild(clearBtn);

      const results = Utils.createElement('div', { id: 'routeResults', style: { marginTop: '14px' } });
      body.appendChild(results);
    }, 'Route Optimizer');
  },

  _dist(a, b) {
    return Utils.calculateDistance(a.lat, a.lng, b.lat, b.lng); // km
  },

  _routeLength(order) {
    let d = 0;
    for (let i = 1; i < order.length; i++) d += this._dist(order[i - 1], order[i]);
    return d;
  },

  _nearestNeighbor(points, startIdx) {
    const visited = new Array(points.length).fill(false);
    const order = [points[startIdx]];
    visited[startIdx] = true;
    for (let step = 1; step < points.length; step++) {
      const last = order[order.length - 1];
      let best = -1, bestD = Infinity;
      for (let i = 0; i < points.length; i++) {
        if (visited[i]) continue;
        const d = this._dist(last, points[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      visited[best] = true;
      order.push(points[best]);
    }
    return order;
  },

  // 2-opt local improvement (open path — endpoints not connected).
  _twoOpt(order) {
    let improved = true;
    let pass = 0;
    while (improved && pass < 20) {
      improved = false;
      pass++;
      for (let i = 0; i < order.length - 2; i++) {
        for (let k = i + 1; k < order.length - 1; k++) {
          const a = order[i], b = order[i + 1], c = order[k], d = order[k + 1];
          const delta = (this._dist(a, c) + this._dist(b, d)) - (this._dist(a, b) + this._dist(c, d));
          if (delta < -1e-9) {
            let lo = i + 1, hi = k;
            while (lo < hi) { const t = order[lo]; order[lo] = order[hi]; order[hi] = t; lo++; hi--; }
            improved = true;
          }
        }
      }
    }
    return order;
  },

  _optimize(layerId, startMode, mph) {
    const layer = this._api.layers.get(layerId);
    if (!layer) return;
    const points = (layer.features || [])
      .map(f => ({ lat: parseFloat(f.latitude), lng: parseFloat(f.longitude), name: f.name || 'Untitled' }))
      .filter(p => !isNaN(p.lat) && !isNaN(p.lng));

    if (points.length < 2) { this._api.ui.toast.warning('Need at least 2 pins to route'); return; }
    if (points.length > 500) { this._api.ui.toast.warning('Too many pins (>500) to optimize responsively'); return; }

    let startIdx = 0;
    if (startMode === 'center') {
      const c = this._api.map.getMap().getCenter();
      let best = Infinity;
      points.forEach((p, i) => {
        const d = Utils.calculateDistance(c.lat(), c.lng(), p.lat, p.lng);
        if (d < best) { best = d; startIdx = i; }
      });
    }

    let order = this._nearestNeighbor(points, startIdx);
    if (points.length <= 300) order = this._twoOpt(order);

    this._drawRoute(order);
    this._renderResults(order, mph);
  },

  _drawRoute(order) {
    this._clearRoute();
    const map = this._api.map.getMap();
    const path = order.map(p => ({ lat: p.lat, lng: p.lng }));

    this._polyline = new google.maps.Polyline({
      path, map,
      strokeColor: '#d13438', strokeOpacity: 0.9, strokeWeight: 3,
      icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2 }, repeat: '120px' }]
    });

    order.forEach((p, i) => {
      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng }, map,
        label: { text: String(i + 1), color: '#fff', fontSize: '11px', fontWeight: 'bold' },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 11, fillColor: '#d13438', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
        zIndex: 3000 + i
      });
      this._markers.push(marker);
    });

    const bounds = new google.maps.LatLngBounds();
    path.forEach(p => bounds.extend(p));
    map.fitBounds(bounds, 60);
  },

  _renderResults(order, mph) {
    const results = this._drawerBody && this._drawerBody.querySelector('#routeResults');
    if (!results) return;
    results.innerHTML = '';

    const totalKm = this._routeLength(order);
    const totalMi = totalKm * 0.621371;
    const hours = totalMi / mph;
    const timeStr = hours < 1 ? `${Math.round(hours * 60)} min` : `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`;

    results.appendChild(Utils.createElement('div', { className: 'plugin-panel-header' },
      `${order.length} stops · ${totalMi.toFixed(1)} mi · ~${timeStr} drive`));

    const list = Utils.createElement('div', { className: 'route-list' });
    let cum = 0;
    order.forEach((p, i) => {
      if (i > 0) cum += this._dist(order[i - 1], p) * 0.621371;
      const row = Utils.createElement('div', { className: 'route-list-row' });
      row.appendChild(Utils.createElement('span', { className: 'route-num' }, String(i + 1)));
      row.appendChild(Utils.createElement('span', { className: 'route-name' }, p.name));
      row.appendChild(Utils.createElement('span', { className: 'route-dist' }, i === 0 ? 'start' : `${cum.toFixed(1)} mi`));
      list.appendChild(row);
    });
    results.appendChild(list);
    this._api.ui.toast.success(`Route: ${order.length} stops, ${totalMi.toFixed(1)} mi`);
  },

  _clearRoute() {
    if (this._polyline) { this._polyline.setMap(null); this._polyline = null; }
    this._markers.forEach(m => m.setMap(null));
    this._markers = [];
  }
};

AppRegistry.whenReady('pluginRegistry', r => r.register(RouteOptimizerPlugin));
