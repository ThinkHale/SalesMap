// plugins/route-optimizer.js — Nearest-neighbor + 2-opt route ordering
// Orders the pins of a layer into an efficient visiting sequence, then draws the
// real road-following route via the Google Directions service (with actual driving
// distance and time). Falls back to a dashed straight-line estimate if the
// Directions API is unavailable.

const RouteOptimizerPlugin = {
  id: 'route-optimizer',
  name: 'Route Optimizer',
  version: '1.0.0',
  description: 'Order a layer\'s pins into an efficient road-following route with a numbered day plan and real driving distance/time.',
  author: 'SalesMapper',
  minAppVersion: '4.0.0',
  defaultEnabled: false,

  permissions: ['layers.read', 'map.read', 'map.write', 'ui.slot:toolbar', 'ui.modal', 'ui.toast'],
  configSchema: {},

  _api: null,
  _polyline: null,
  _markers: [],
  _drawerBody: null,
  _routeToken: 0,
  _directionsService: null,

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
      mphGroup.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Avg speed (mph) — used only if road routing is unavailable'));
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

    this._clearRoute();          // cancels any in-flight directions request
    this._drawMarkers(order);
    const token = this._routeToken;

    // Prefer real road-following directions; fall back to a straight-line estimate
    // if the Directions service is unavailable (e.g. Directions API not enabled).
    if (typeof google !== 'undefined' && google.maps && typeof google.maps.DirectionsService === 'function') {
      this._api.ui.toast.info('Calculating road route…');
      this._buildRoadRoute(order).then(res => {
        if (token !== this._routeToken) return;   // a newer request superseded this one
        this._drawPolyline(res.path, false);
        this._renderResultsRoad(order, res.legMeters, res.totalMeters, res.totalSeconds);
      }).catch(err => {
        if (token !== this._routeToken) return;
        this._drawPolyline(order.map(p => ({ lat: p.lat, lng: p.lng })), true);
        this._renderResults(order, mph, `Road directions unavailable (${err.message}) — showing straight-line estimate`);
      });
    } else {
      this._drawPolyline(order.map(p => ({ lat: p.lat, lng: p.lng })), true);
      this._renderResults(order, mph, 'Road directions unavailable — showing straight-line estimate');
    }
  },

  // Request driving directions along the fixed order, chunked to respect the
  // Directions waypoint limit (25 points per request), and stitched together.
  async _buildRoadRoute(order) {
    const ds = this._directionsService || (this._directionsService = new google.maps.DirectionsService());
    const CHUNK = 25; // origin + up to 23 waypoints + destination
    const path = [];
    const legMeters = [];
    let totalMeters = 0, totalSeconds = 0;

    for (let i = 0; i < order.length - 1; i += (CHUNK - 1)) {
      const seg = order.slice(i, i + CHUNK);
      if (seg.length < 2) break;
      const origin = { lat: seg[0].lat, lng: seg[0].lng };
      const destination = { lat: seg[seg.length - 1].lat, lng: seg[seg.length - 1].lng };
      const waypoints = seg.slice(1, -1).map(p => ({ location: { lat: p.lat, lng: p.lng }, stopover: true }));

      const res = await new Promise((resolve, reject) => {
        ds.route({ origin, destination, waypoints, optimizeWaypoints: false, travelMode: google.maps.TravelMode.DRIVING },
          (r, status) => (status === 'OK' && r) ? resolve(r) : reject(new Error(status)));
      });

      const route = res.routes[0];
      route.legs.forEach(leg => {
        const m = leg.distance ? leg.distance.value : 0;
        legMeters.push(m);
        totalMeters += m;
        totalSeconds += leg.duration ? leg.duration.value : 0;
      });
      (route.overview_path || []).forEach(pt => path.push(pt));
      await Utils.wait(150); // gentle spacing to stay under QPS limits
    }

    return { path, legMeters, totalMeters, totalSeconds };
  },

  _drawMarkers(order) {
    const map = this._api.map.getMap();
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
    order.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
    map.fitBounds(bounds, 60);
  },

  _drawPolyline(path, dashed) {
    if (this._polyline) { this._polyline.setMap(null); this._polyline = null; }
    const map = this._api.map.getMap();
    const opts = { path, map, strokeColor: '#d13438', strokeWeight: 4, strokeOpacity: dashed ? 0 : 0.85, zIndex: 2000 };
    if (dashed) {
      // Dotted line signals a straight-line estimate rather than a real road route.
      opts.icons = [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, scale: 3 }, offset: '0', repeat: '12px' }];
    } else {
      opts.icons = [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2 }, repeat: '160px' }];
    }
    this._polyline = new google.maps.Polyline(opts);
  },

  _fmtDuration(seconds) {
    const min = Math.round(seconds / 60);
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)}h ${min % 60}m`;
  },

  _renderResultsRoad(order, legMeters, totalMeters, totalSeconds) {
    const results = this._drawerBody && this._drawerBody.querySelector('#routeResults');
    if (!results) return;
    results.innerHTML = '';

    const totalMi = totalMeters * 0.000621371;
    results.appendChild(Utils.createElement('div', { className: 'plugin-panel-header' },
      `${order.length} stops · ${totalMi.toFixed(1)} mi · ~${this._fmtDuration(totalSeconds)} drive (roads)`));

    const list = Utils.createElement('div', { className: 'route-list' });
    let cumMeters = 0;
    order.forEach((p, i) => {
      if (i > 0) cumMeters += (legMeters[i - 1] || 0);
      const row = Utils.createElement('div', { className: 'route-list-row' });
      row.appendChild(Utils.createElement('span', { className: 'route-num' }, String(i + 1)));
      row.appendChild(Utils.createElement('span', { className: 'route-name' }, p.name));
      row.appendChild(Utils.createElement('span', { className: 'route-dist' },
        i === 0 ? 'start' : `${(cumMeters * 0.000621371).toFixed(1)} mi`));
      list.appendChild(row);
    });
    results.appendChild(list);
    this._api.ui.toast.success(`Route: ${order.length} stops, ${totalMi.toFixed(1)} mi by road`);
  },

  _renderResults(order, mph, note) {
    const results = this._drawerBody && this._drawerBody.querySelector('#routeResults');
    if (!results) return;
    results.innerHTML = '';

    if (note) {
      this._api.ui.toast.warning(note);
      results.appendChild(Utils.createElement('div', { className: 'no-data-msg' }, note));
    }

    const totalKm = this._routeLength(order);
    const totalMi = totalKm * 0.621371;
    const hours = totalMi / mph;
    const timeStr = hours < 1 ? `${Math.round(hours * 60)} min` : `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`;

    results.appendChild(Utils.createElement('div', { className: 'plugin-panel-header' },
      `${order.length} stops · ${totalMi.toFixed(1)} mi · ~${timeStr} drive (straight-line)`));

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
  },

  _clearRoute() {
    this._routeToken++;   // invalidate any in-flight directions callback
    if (this._polyline) { this._polyline.setMap(null); this._polyline = null; }
    this._markers.forEach(m => m.setMap(null));
    this._markers = [];
  }
};

AppRegistry.whenReady('pluginRegistry', r => r.register(RouteOptimizerPlugin));
