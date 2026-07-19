// plugins/territory-builder.js — Territory assignment & generation
// Two modes:
//   1) Summarize: assign point accounts to existing territory polygons by
//      containment, and roll up count / revenue / tier mix per territory.
//   2) Generate: k-means cluster a point layer into N territories and emit a new
//      polygon layer of convex-hull boundaries.

const TerritoryBuilderPlugin = {
  id: 'territory-builder',
  name: 'Territory Builder',
  version: '1.0.0',
  description: 'Assign accounts to territory polygons with per-territory rollups, or auto-generate N territories from a point layer.',
  author: 'SalesMapper',
  minAppVersion: '4.0.0',

  permissions: ['layers.read', 'layers.write', 'map.read', 'map.write', 'ui.slot:toolbar', 'ui.modal', 'ui.toast'],
  configSchema: {},

  _api: null,

  init(api) {
    this._api = api;
    api.ui.addToolbarButton({
      icon: '🗂',
      tooltip: 'Territory builder',
      onClick: () => this._openPanel()
    });
  },

  _hasGeometry() {
    return typeof google !== 'undefined' && google.maps.geometry &&
      google.maps.geometry.poly && google.maps.geometry.poly.containsLocation;
  },

  _openPanel() {
    this._api.ui.modal.openDrawer(body => {
      body.innerHTML = '';

      const modeGroup = Utils.createElement('div', { className: 'form-group' });
      modeGroup.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Mode'));
      const modeSel = Utils.createElement('select', { className: 'form-control' });
      modeSel.appendChild(Utils.createElement('option', { value: 'summarize' }, 'Summarize by existing territories'));
      modeSel.appendChild(Utils.createElement('option', { value: 'generate' }, 'Auto-generate territories'));
      modeGroup.appendChild(modeSel);
      body.appendChild(modeGroup);

      const panel = Utils.createElement('div');
      body.appendChild(panel);

      const render = () => {
        if (modeSel.value === 'summarize') this._renderSummarize(panel);
        else this._renderGenerate(panel);
      };
      modeSel.addEventListener('change', render);
      render();
    }, 'Territory Builder');
  },

  // ── Mode 1: containment rollups ─────────────────────────────────────────────
  _renderSummarize(panel) {
    panel.innerHTML = '';
    if (!this._hasGeometry()) {
      panel.appendChild(Utils.createElement('p', { className: 'no-data-msg' }, 'Google Maps geometry library not available.'));
      return;
    }

    const layers = this._api.layers.getAll();
    const polyLayers = layers.filter(l => (l.features || []).some(f => f.wkt));
    const pointLayers = layers.filter(l => (l.features || []).some(f => !isNaN(parseFloat(f.latitude))));

    if (polyLayers.length === 0 || pointLayers.length === 0) {
      panel.appendChild(Utils.createElement('p', { className: 'no-data-msg' }, 'Need at least one polygon (territory) layer and one point (account) layer.'));
      return;
    }

    const territorySel = this._selectGroup(panel, 'Territory polygons', polyLayers);
    const accountSel = this._selectGroup(panel, 'Account points', pointLayers);

    const goBtn = Utils.createElement('button', { className: 'btn btn-primary', style: { marginTop: '10px' } }, 'Summarize');
    panel.appendChild(goBtn);
    const out = Utils.createElement('div', { style: { marginTop: '14px' } });
    panel.appendChild(out);

    goBtn.addEventListener('click', () => this._summarize(territorySel.value, accountSel.value, out));
  },

  _selectGroup(parent, label, layers) {
    const group = Utils.createElement('div', { className: 'form-group' });
    group.appendChild(Utils.createElement('label', { className: 'form-label' }, label));
    const sel = Utils.createElement('select', { className: 'form-control' });
    layers.forEach(l => sel.appendChild(Utils.createElement('option', { value: l.id }, l.name)));
    group.appendChild(sel);
    parent.appendChild(group);
    return sel;
  },

  _summarize(territoryLayerId, accountLayerId, out) {
    out.innerHTML = '';
    const territoryData = this._api.map.getLayerData(territoryLayerId);
    const accountLayer = this._api.layers.get(accountLayerId);
    if (!territoryData || !accountLayer) return;

    // Group territory polygons by feature (name).
    const territories = [];
    const byFeature = new Map();
    territoryData.polygons.forEach(p => {
      const name = p._featureData.name || `Territory ${p._featureId}`;
      if (!byFeature.has(p._featureId)) {
        const t = { name, polygons: [], count: 0, revenue: 0, tiers: {} };
        byFeature.set(p._featureId, t);
        territories.push(t);
      }
      byFeature.get(p._featureId).polygons.push(p);
    });

    let unassigned = 0;
    (accountLayer.features || []).forEach(f => {
      const lat = parseFloat(f.latitude), lng = parseFloat(f.longitude);
      if (isNaN(lat) || isNaN(lng)) return;
      const pt = new google.maps.LatLng(lat, lng);
      let hit = null;
      for (const t of territories) {
        if (t.polygons.some(poly => google.maps.geometry.poly.containsLocation(pt, poly))) { hit = t; break; }
      }
      if (!hit) { unassigned++; return; }
      hit.count++;
      const rev = Utils.parseNumber(f.revenue);
      if (!isNaN(rev)) hit.revenue += rev;
      const tier = String(f.tier || '—');
      hit.tiers[tier] = (hit.tiers[tier] || 0) + 1;
    });

    const table = Utils.createElement('table', { className: 'area-table' });
    const head = Utils.createElement('tr');
    ['Territory', 'Accounts', 'Revenue', 'Tier mix'].forEach(h => head.appendChild(Utils.createElement('th', {}, h)));
    table.appendChild(head);
    Utils.sortBy(territories, t => -t.count).forEach(t => {
      const tr = Utils.createElement('tr');
      tr.appendChild(Utils.createElement('td', {}, t.name));
      tr.appendChild(Utils.createElement('td', {}, Utils.formatNumber(t.count)));
      tr.appendChild(Utils.createElement('td', {}, t.revenue > 0 ? Utils.formatCurrency(t.revenue) : '–'));
      tr.appendChild(Utils.createElement('td', {},
        Utils.sortBy(Object.keys(t.tiers), x => x).map(k => `${k}:${t.tiers[k]}`).join(' ') || '–'));
      table.appendChild(tr);
    });
    out.appendChild(table);
    if (unassigned > 0) out.appendChild(Utils.createElement('div', { className: 'no-data-msg' }, `${unassigned} account(s) fell outside all territories`));
  },

  // ── Mode 2: k-means generation ──────────────────────────────────────────────
  _renderGenerate(panel) {
    panel.innerHTML = '';
    const pointLayers = this._api.layers.getAll().filter(l => (l.features || []).some(f => !isNaN(parseFloat(f.latitude))));
    if (pointLayers.length === 0) {
      panel.appendChild(Utils.createElement('p', { className: 'no-data-msg' }, 'No point layers to cluster.'));
      return;
    }

    const laySel = this._selectGroup(panel, 'Point layer', pointLayers);

    const nGroup = Utils.createElement('div', { className: 'form-group' });
    nGroup.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Number of territories'));
    const nInput = Utils.createElement('input', { type: 'number', className: 'form-control', min: '2', max: '26' });
    nInput.value = 4;
    nGroup.appendChild(nInput);
    panel.appendChild(nGroup);

    const goBtn = Utils.createElement('button', { className: 'btn btn-primary', style: { marginTop: '10px' } }, 'Generate Territories');
    panel.appendChild(goBtn);
    goBtn.addEventListener('click', () => this._generate(laySel.value, Utils.clamp(parseInt(nInput.value, 10) || 4, 2, 26)));
  },

  _generate(layerId, k) {
    const layer = this._api.layers.get(layerId);
    if (!layer) return;
    const pts = (layer.features || [])
      .map(f => ({ lat: parseFloat(f.latitude), lng: parseFloat(f.longitude) }))
      .filter(p => !isNaN(p.lat) && !isNaN(p.lng));
    if (pts.length < k) { this._api.ui.toast.warning(`Need at least ${k} pins to make ${k} territories`); return; }

    const clusters = this._kmeans(pts, k, 30);
    const features = [];
    clusters.forEach((members, i) => {
      if (members.length < 3) return; // can't hull fewer than 3 points
      const hull = this._convexHull(members);
      if (hull.length < 3) return;
      const ring = hull.map(p => `${p.lng} ${p.lat}`);
      ring.push(ring[0]); // close
      features.push({
        id: Utils.generateId('feat'),
        name: `Territory ${i + 1}`,
        wkt: `POLYGON((${ring.join(', ')}))`,
        accounts: members.length
      });
    });

    if (features.length === 0) { this._api.ui.toast.warning('Could not form territories (clusters too small)'); return; }
    this._api.layers.create(`Auto Territories (${features.length})`, features, 'polygon', { source: 'territory-builder' });
    this._api.ui.toast.success(`Generated ${features.length} territories from ${pts.length} accounts`);
  },

  _kmeans(points, k, iterations) {
    // Spread initial centroids across sorted-by-longitude points for stability.
    const sorted = Utils.sortBy(points, p => p.lng);
    const centroids = [];
    for (let i = 0; i < k; i++) centroids.push({ ...sorted[Math.floor((i + 0.5) / k * sorted.length)] });

    let assign = new Array(points.length).fill(0);
    for (let iter = 0; iter < iterations; iter++) {
      let moved = false;
      // Assign
      for (let i = 0; i < points.length; i++) {
        let best = 0, bestD = Infinity;
        for (let c = 0; c < k; c++) {
          const dlat = points[i].lat - centroids[c].lat, dlng = points[i].lng - centroids[c].lng;
          const d = dlat * dlat + dlng * dlng;
          if (d < bestD) { bestD = d; best = c; }
        }
        if (assign[i] !== best) { assign[i] = best; moved = true; }
      }
      // Recompute
      const sums = Array.from({ length: k }, () => ({ lat: 0, lng: 0, n: 0 }));
      points.forEach((p, i) => { const s = sums[assign[i]]; s.lat += p.lat; s.lng += p.lng; s.n++; });
      for (let c = 0; c < k; c++) {
        if (sums[c].n > 0) { centroids[c].lat = sums[c].lat / sums[c].n; centroids[c].lng = sums[c].lng / sums[c].n; }
      }
      if (!moved && iter > 0) break;
    }

    const clusters = Array.from({ length: k }, () => []);
    points.forEach((p, i) => clusters[assign[i]].push(p));
    return clusters;
  },

  // Andrew's monotone chain convex hull. Input/return: [{lat,lng}]; hull ordered CCW.
  _convexHull(points) {
    const pts = points.slice().sort((a, b) => a.lng - b.lng || a.lat - b.lat);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }
};

AppRegistry.whenReady('pluginRegistry', r => r.register(TerritoryBuilderPlugin));
