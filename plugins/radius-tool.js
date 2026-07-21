// plugins/radius-tool.js — Radius / approximate drive-time coverage
// Drop a circle on the map and summarize the accounts inside it. Drive-time is an
// approximation (radius = avg speed × time); true isochrones need a routing API.

const RadiusToolPlugin = {
  id: 'radius-tool',
  name: 'Radius Coverage',
  version: '1.0.0',
  description: 'Drop a radius (or approximate drive-time) circle and summarize the accounts within it.',
  author: 'SalesMapper',
  minAppVersion: '4.0.0',
  defaultEnabled: false,

  permissions: ['layers.read', 'map.read', 'map.write', 'ui.slot:toolbar', 'ui.modal', 'ui.toast'],
  configSchema: {},

  _api: null,
  _circle: null,
  _centerMarker: null,
  _clickListener: null,
  _radiusMiles: 25,
  _drawerBody: null,

  init(api) {
    this._api = api;
    api.ui.addToolbarButton({
      icon: '◎',
      tooltip: 'Radius / drive-time coverage',
      onClick: () => this._openPanel()
    });
  },

  destroy() { this._clear(); },

  _openPanel() {
    this._api.ui.modal.openDrawer(body => {
      this._drawerBody = body;
      this._renderControls(body);
    }, 'Radius Coverage');
  },

  _renderControls(body) {
    body.innerHTML = '';

    // Radius (miles)
    const rGroup = Utils.createElement('div', { className: 'form-group' });
    rGroup.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Radius (miles)'));
    const rInput = Utils.createElement('input', { type: 'number', className: 'form-control', min: '1', step: '1' });
    rInput.value = this._radiusMiles;
    rInput.addEventListener('change', () => { this._radiusMiles = Math.max(1, parseFloat(rInput.value) || 25); });
    rGroup.appendChild(rInput);
    body.appendChild(rGroup);

    // Drive-time helper
    const dtGroup = Utils.createElement('div', { className: 'form-group' });
    dtGroup.appendChild(Utils.createElement('label', { className: 'form-label' }, '…or approximate drive time'));
    const dtRow = Utils.createElement('div', { className: 'filter-range-row' });
    const minutes = Utils.createElement('input', { type: 'number', className: 'form-control form-control-sm', placeholder: 'min', min: '1' });
    const mph = Utils.createElement('input', { type: 'number', className: 'form-control form-control-sm', placeholder: 'mph', min: '1' });
    mph.value = 40;
    const calcBtn = Utils.createElement('button', { className: 'btn btn-secondary btn-sm' }, 'Set');
    calcBtn.addEventListener('click', () => {
      const m = parseFloat(minutes.value), s = parseFloat(mph.value);
      if (isNaN(m) || isNaN(s)) { this._api.ui.toast.warning('Enter minutes and mph'); return; }
      this._radiusMiles = Math.round((m / 60) * s * 10) / 10;
      rInput.value = this._radiusMiles;
      this._api.ui.toast.info(`Radius set to ${this._radiusMiles} mi (${m} min @ ${s} mph)`);
    });
    dtRow.appendChild(minutes);
    dtRow.appendChild(Utils.createElement('span', {}, 'min @'));
    dtRow.appendChild(mph);
    dtRow.appendChild(calcBtn);
    dtGroup.appendChild(dtRow);
    body.appendChild(dtGroup);

    // Placement
    const btnRow = Utils.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } });
    const centerBtn = Utils.createElement('button', { className: 'btn btn-primary' }, 'Place at map center');
    centerBtn.addEventListener('click', () => this._place(this._api.map.getMap().getCenter()));
    const clickBtn = Utils.createElement('button', { className: 'btn btn-secondary' }, 'Click map to place');
    clickBtn.addEventListener('click', () => this._armClick());
    const clearBtn = Utils.createElement('button', { className: 'btn btn-secondary' }, 'Clear');
    clearBtn.addEventListener('click', () => { this._clear(); this._renderControls(body); });
    btnRow.appendChild(centerBtn);
    btnRow.appendChild(clickBtn);
    btnRow.appendChild(clearBtn);
    body.appendChild(btnRow);

    const results = Utils.createElement('div', { className: 'radius-results', style: { marginTop: '14px' } });
    results.id = 'radiusResults';
    body.appendChild(results);
  },

  _armClick() {
    const map = this._api.map.getMap();
    if (!map) return;
    this._api.ui.toast.info('Click the map to set the circle center');
    if (this._clickListener) google.maps.event.removeListener(this._clickListener);
    this._clickListener = google.maps.event.addListenerOnce(map, 'click', e => {
      this._clickListener = null;
      this._place(e.latLng);
    });
  },

  _place(center) {
    if (!center) return;
    const map = this._api.map.getMap();
    this._clearShapes();
    const radiusMeters = this._radiusMiles * 1609.34;

    this._circle = new google.maps.Circle({
      center, radius: radiusMeters, map,
      fillColor: '#0078d4', fillOpacity: 0.08,
      strokeColor: '#0078d4', strokeOpacity: 0.8, strokeWeight: 2
    });
    this._centerMarker = new google.maps.Marker({
      position: center, map,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: '#0078d4', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }
    });
    map.panTo(center);

    this._summarize(center);
  },

  _summarize(center) {
    const radiusKm = this._radiusMiles * 1.60934;
    const inside = [];
    this._api.layers.getAll().forEach(layer => {
      if (!layer.visible) return;
      (layer.features || []).forEach(f => {
        const lat = parseFloat(f.latitude), lng = parseFloat(f.longitude);
        if (isNaN(lat) || isNaN(lng)) return;
        const d = Utils.calculateDistance(center.lat(), center.lng(), lat, lng);
        if (d <= radiusKm) inside.push({ f, layerName: layer.name, distMi: d * 0.621371 });
      });
    });

    const results = this._drawerBody && this._drawerBody.querySelector('#radiusResults');
    if (!results) return;
    results.innerHTML = '';

    const header = Utils.createElement('div', { className: 'plugin-panel-header' },
      `${inside.length} account(s) within ${this._radiusMiles} mi`);
    results.appendChild(header);

    if (inside.length === 0) return;

    // Revenue + tier rollup
    let revenue = 0;
    const tiers = {};
    inside.forEach(({ f }) => {
      const r = Utils.parseNumber(f.revenue);
      if (!isNaN(r)) revenue += r;
      const t = String(f.tier || '—');
      tiers[t] = (tiers[t] || 0) + 1;
    });

    const stats = Utils.createElement('div', { className: 'radius-stats' });
    if (revenue > 0) stats.appendChild(Utils.createElement('div', {}, `Total revenue: ${Utils.formatCurrency(revenue)}`));
    stats.appendChild(Utils.createElement('div', {}, 'By tier: ' +
      Utils.sortBy(Object.keys(tiers), t => t).map(t => `${t}: ${tiers[t]}`).join(' · ')));
    results.appendChild(stats);

    const list = Utils.createElement('div', { className: 'radius-list' });
    Utils.sortBy(inside, x => x.distMi).slice(0, 100).forEach(({ f, distMi }) => {
      const row = Utils.createElement('div', { className: 'radius-list-row' });
      row.appendChild(Utils.createElement('span', { className: 'radius-list-name' }, f.name || 'Untitled'));
      row.appendChild(Utils.createElement('span', { className: 'radius-list-dist' }, `${distMi.toFixed(1)} mi`));
      list.appendChild(row);
    });
    results.appendChild(list);
    if (inside.length > 100) results.appendChild(Utils.createElement('div', { className: 'no-data-msg' }, `…and ${inside.length - 100} more`));
  },

  _clearShapes() {
    if (this._circle) { this._circle.setMap(null); this._circle = null; }
    if (this._centerMarker) { this._centerMarker.setMap(null); this._centerMarker = null; }
  },

  _clear() {
    this._clearShapes();
    if (this._clickListener) { google.maps.event.removeListener(this._clickListener); this._clickListener = null; }
  }
};

AppRegistry.whenReady('pluginRegistry', r => r.register(RadiusToolPlugin));
