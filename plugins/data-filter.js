// plugins/data-filter.js — Filter / Query panel
// Show/hide features across all layers by property: categorical multi-select
// (tier, BDM, state, …) and numeric ranges (revenue). Point features are filtered
// through the ClusterManager (so clusters recount); polygons are toggled directly.

const DataFilterPlugin = {
  id: 'data-filter',
  name: 'Filter / Query',
  version: '1.0.0',
  description: 'Show or hide features across all layers by tier, BDM, state, revenue range, and other fields.',
  author: 'SalesMapper',
  minAppVersion: '4.0.0',
  defaultEnabled: false,

  permissions: ['layers.read', 'map.read', 'map.write', 'ui.slot:toolbar', 'ui.modal', 'ui.toast', 'events.listen'],
  configSchema: {},

  _api: null,
  _active: false,
  _constraints: {},   // field -> { type, checked:Set } | { type, min, max }
  _countEl: null,

  _SKIP: new Set(['latitude', 'longitude', 'lat', 'lng', 'id', 'wkt', 'layerid', 'layerId',
    'name', 'description', 'street', 'address', '_rowIndex', '_errors', 'createdat', 'createdAt',
    'importedat', 'source', '_geocodeConfidence', '_formattedAddress']),
  _PRIORITY: ['tier', 'bdm', 'state', 'territory', 'county', 'city', 'revenue'],

  init(api) {
    this._api = api;
    api.ui.addToolbarButton({
      icon: '🔍',
      tooltip: 'Filter / Query features',
      onClick: () => this._openPanel()
    });
    // Re-apply the active filter after data changes so new features obey it.
    const reapply = () => { if (this._active) this._apply(false); };
    api.events.on('features.added', reapply);
    api.events.on('layer.visibility.changed', reapply);
  },

  destroy() { this._clear(); },

  // ── Field discovery ─────────────────────────────────────────────────────────
  _collectFields() {
    const fields = {};
    this._api.layers.getAll().forEach(layer => {
      if (!layer.visible) return;
      (layer.features || []).forEach(f => {
        Object.entries(f).forEach(([k, v]) => {
          if (this._SKIP.has(k) || this._SKIP.has(k.toLowerCase())) return;
          if (v === null || v === undefined || v === '') return;
          const rec = fields[k] || (fields[k] = { values: new Map(), numeric: 0, count: 0 });
          rec.count++;
          if (!isNaN(Utils.parseNumber(v))) rec.numeric++;
          const key = String(v);
          rec.values.set(key, (rec.values.get(key) || 0) + 1);
        });
      });
    });

    const classified = [];
    Object.entries(fields).forEach(([name, rec]) => {
      const numericRatio = rec.numeric / rec.count;
      const unique = rec.values.size;
      // Numeric field: mostly parseable AND enough spread to be a range.
      if (numericRatio >= 0.8 && unique > 8) {
        classified.push({ name, type: 'numeric', rec });
      } else if (unique >= 2 && unique <= 40) {
        classified.push({ name, type: 'categorical', rec });
      }
    });

    return Utils.sortBy(classified, f => {
      const idx = this._PRIORITY.indexOf(f.name.toLowerCase());
      return idx === -1 ? 99 : idx;
    });
  },

  _openPanel() {
    const fields = this._collectFields();
    this._api.ui.modal.openDrawer(body => {
      body.innerHTML = '';
      if (fields.length === 0) {
        body.appendChild(Utils.createElement('p', { className: 'no-data-msg' }, 'No filterable fields found in visible layers.'));
        return;
      }

      const countEl = Utils.createElement('div', { className: 'filter-count' });
      this._countEl = countEl;
      body.appendChild(countEl);

      const controls = Utils.createElement('div', { className: 'filter-controls' });
      body.appendChild(controls);

      fields.forEach(field => {
        if (field.type === 'categorical') this._renderCategorical(controls, field);
        else this._renderNumeric(controls, field);
      });

      const btnRow = Utils.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '14px' } });
      const applyBtn = Utils.createElement('button', { className: 'btn btn-primary' }, 'Apply Filter');
      applyBtn.addEventListener('click', () => this._apply(true));
      const clearBtn = Utils.createElement('button', { className: 'btn btn-secondary' }, 'Clear');
      clearBtn.addEventListener('click', () => { this._clear(); this._openPanel(); });
      btnRow.appendChild(applyBtn);
      btnRow.appendChild(clearBtn);
      body.appendChild(btnRow);

      this._updateCount();
    }, 'Filter / Query');
  },

  _renderCategorical(parent, field) {
    const group = Utils.createElement('div', { className: 'filter-field-group' });
    const header = Utils.createElement('div', { className: 'filter-field-header' }, field.name);
    group.appendChild(header);

    const existing = this._constraints[field.name];
    const values = Utils.sortBy([...field.rec.values.keys()], v => v);
    const box = Utils.createElement('div', { className: 'filter-checkbox-list' });

    values.forEach(val => {
      const row = Utils.createElement('label', { className: 'filter-checkbox-row' });
      const cb = Utils.createElement('input', { type: 'checkbox' });
      cb.checked = !existing || existing.checked.has(val);
      cb._value = val;
      cb.addEventListener('change', () => this._apply(true));
      row.appendChild(cb);
      row.appendChild(document.createTextNode(` ${val} (${field.rec.values.get(val)})`));
      box.appendChild(row);
    });
    group.appendChild(box);
    group._field = field;
    group._readConstraint = () => {
      const checked = new Set([...box.querySelectorAll('input')].filter(c => c.checked).map(c => c._value));
      // Active only when the user has excluded at least one value.
      return checked.size < values.length ? { type: 'categorical', checked } : null;
    };
    parent.appendChild(group);
  },

  _renderNumeric(parent, field) {
    const nums = [...field.rec.values.keys()].map(v => Utils.parseNumber(v)).filter(v => !isNaN(v));
    let dataMin = Infinity, dataMax = -Infinity;
    for (const v of nums) { if (v < dataMin) dataMin = v; if (v > dataMax) dataMax = v; }
    const existing = this._constraints[field.name];

    const group = Utils.createElement('div', { className: 'filter-field-group' });
    group.appendChild(Utils.createElement('div', { className: 'filter-field-header' },
      `${field.name} (${Utils.formatNumber(Math.round(dataMin))}–${Utils.formatNumber(Math.round(dataMax))})`));

    const row = Utils.createElement('div', { className: 'filter-range-row' });
    const minInput = Utils.createElement('input', { type: 'number', className: 'form-control form-control-sm', placeholder: 'min' });
    const maxInput = Utils.createElement('input', { type: 'number', className: 'form-control form-control-sm', placeholder: 'max' });
    if (existing) { if (existing.min != null) minInput.value = existing.min; if (existing.max != null) maxInput.value = existing.max; }
    minInput.addEventListener('change', () => this._apply(true));
    maxInput.addEventListener('change', () => this._apply(true));
    row.appendChild(minInput);
    row.appendChild(Utils.createElement('span', {}, '–'));
    row.appendChild(maxInput);
    group.appendChild(row);

    group._field = field;
    group._readConstraint = () => {
      const min = minInput.value === '' ? null : parseFloat(minInput.value);
      const max = maxInput.value === '' ? null : parseFloat(maxInput.value);
      return (min != null || max != null) ? { type: 'numeric', min, max } : null;
    };
    parent.appendChild(group);
  },

  // ── Apply ────────────────────────────────────────────────────────────────
  _apply(readFromUI) {
    if (readFromUI && this._countEl) {
      // Rebuild constraints from the live controls.
      const groups = this._countEl.parentNode.querySelectorAll('.filter-field-group');
      this._constraints = {};
      groups.forEach(g => {
        if (!g._field || !g._readConstraint) return;
        const c = g._readConstraint();
        if (c) this._constraints[g._field.name] = c;
      });
    }

    const predicate = this._buildPredicate();
    this._active = Object.keys(this._constraints).length > 0;
    this._api.map.setFeatureFilter(this._active ? predicate : null);
    this._applyToPolygons(this._active ? predicate : null);
    this._updateCount();
  },

  _buildPredicate() {
    const constraints = this._constraints;
    return (f) => {
      if (!f) return true;
      for (const field in constraints) {
        const c = constraints[field];
        if (c.type === 'categorical') {
          if (!c.checked.has(String(f[field]))) return false;
        } else {
          const v = Utils.parseNumber(f[field]);
          if (c.min != null && (isNaN(v) || v < c.min)) return false;
          if (c.max != null && (isNaN(v) || v > c.max)) return false;
        }
      }
      return true;
    };
  },

  _applyToPolygons(predicate) {
    const map = this._api.map.getMap();
    this._api.layers.getAll().forEach(layer => {
      const layerData = this._api.map.getLayerData(layer.id);
      if (!layerData) return;
      layerData.polygons.forEach(p => {
        const show = layer.visible && (!predicate || predicate(p._featureData));
        p.setMap(show ? map : null);
      });
    });
  },

  _updateCount() {
    if (!this._countEl) return;
    const predicate = this._buildPredicate();
    let shown = 0, total = 0;
    this._api.layers.getAll().forEach(layer => {
      if (!layer.visible) return;
      (layer.features || []).forEach(f => {
        total++;
        if (!this._active || predicate(f)) shown++;
      });
    });
    this._countEl.textContent = this._active
      ? `Showing ${Utils.formatNumber(shown)} of ${Utils.formatNumber(total)} features`
      : `${Utils.formatNumber(total)} features (no filter)`;
  },

  _clear() {
    this._constraints = {};
    this._active = false;
    this._api.map.clearFeatureFilter();
    this._applyToPolygons(null);
    if (this._countEl) this._updateCount();
  }
};

AppRegistry.whenReady('pluginRegistry', r => r.register(DataFilterPlugin));
