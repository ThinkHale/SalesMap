// plugins/layer-styler.js — Visual style editor opened from a layer's context menu
//
// Styles pins, polygons, and cluster pins by any property on the features —
// including custom columns from the imported spreadsheet. Numeric properties can
// be grouped automatically into readable ranges ("smart groups"); categorical
// properties get one color per value with a grouped "Other" bucket.

const LayerStylerPlugin = {
  id: 'layer-styler',
  name: 'Layer Styler',
  version: '2.0.0',
  description: 'Color pins, clusters, and polygons by any property — with automatic range grouping for numbers — plus opacity and polygon stroke controls. Open from the layer\'s ⋯ menu.',
  author: 'SalesMapper',
  minAppVersion: '4.0.0',

  permissions: [
    'layers.read',
    'layers.write',
    'map.read',
    'ui.modal',
    'ui.toast',
    'events.listen',
    'storage.read',
    'storage.write'
  ],

  configSchema: {},

  _api: null,
  _selectedLayerId: null,
  _drawerBody: null,
  _legendEl: null,

  init(api) {
    this._api = api;

    // The UI Renderer emits this event from the layer ⋯ menu.
    api.events.on('layer.styler.open', ({ layerId }) => {
      this._openStyler(layerId);
    });

    // Re-render the drawer if the active layer changes underneath us.
    const refresh = () => {
      if (this._drawerBody && this._selectedLayerId) {
        const layer = api.layers.get(this._selectedLayerId);
        if (!layer) {
          this._drawerBody = null;
          this._selectedLayerId = null;
          return;
        }
        this._renderControls(this._drawerBody, layer);
      }
    };
    api.events.on('layer.deleted', refresh);
    api.events.on('layer.renamed', refresh);
    api.events.on('features.added', refresh);
    api.events.on('feature.deleted', refresh);

    // Keep the map legend in step with the styles actually on screen.
    const relegend = () => this._renderLegend();
    ['layer.style.changed', 'layer.visibility.changed', 'layer.deleted', 'layer.renamed',
     'layers.imported', 'features.added', 'feature.updated', 'feature.deleted']
      .forEach(evt => api.events.on(evt, relegend));
  },

  onDisable() { this._removeLegend(); },
  onEnable() { this._renderLegend(); },
  destroy() {
    this._removeLegend();
    this._drawerBody = null;
    this._selectedLayerId = null;
  },

  // ─── Drawer entry point ────────────────────────────────────────────────────

  _openStyler(layerId) {
    const layer = this._api.layers.get(layerId);
    if (!layer) {
      this._api.ui.toast.error('Layer not found');
      return;
    }
    this._selectedLayerId = layerId;

    this._api.ui.modal.openDrawer(body => {
      this._drawerBody = body;
      this._renderControls(body, layer);
    }, `Style: ${layer.name}`);
  },

  // ─── Main render ───────────────────────────────────────────────────────────

  _renderControls(body, layer) {
    body.innerHTML = '';

    const rule = layer.styleRule;
    const currentMode = PropertyService.isRule(rule) ? rule.mode : 'solid';

    // Mode toggle
    const modeGroup = Utils.createElement('div', { className: 'form-group' });
    const modeLabel = Utils.createElement('label', { className: 'form-label' }, 'Style Mode');
    const modeRow = Utils.createElement('div', { className: 'styler-mode-row' });
    const modes = [
      { value: 'solid', label: 'Solid' },
      { value: 'categorical', label: 'By Category' },
      { value: 'range', label: 'By Range' }
    ];

    modes.forEach(({ value, label }) => {
      const btn = Utils.createElement('button', {
        className: `btn btn-sm ${currentMode === value ? 'btn-primary' : 'btn-secondary'}`
      }, label);
      btn.addEventListener('click', () => this._switchMode(body, layer, value));
      modeRow.appendChild(btn);
    });

    modeGroup.appendChild(modeLabel);
    modeGroup.appendChild(modeRow);
    body.appendChild(modeGroup);

    if (currentMode === 'solid') {
      this._renderSolidControls(body, layer);
    } else {
      this._renderPropertyControls(body, layer, currentMode);
    }

    this._renderOpacityControl(body, layer);

    if (layer.type === 'polygon' || layer.type === 'mixed') {
      this._renderPolygonControls(body, layer);
    }
  },

  // Properties worth offering for a mode. Range grouping needs a property that is
  // mostly numeric — one stray number in a text column is not a measure.
  _usableProps(props, mode) {
    return mode === 'range'
      ? props.filter(p => p.min !== null && p.numericRatio >= 0.5)
      : props;
  },

  // Switching modes builds a sensible starting rule so the map responds
  // immediately instead of waiting for a property to be picked.
  _switchMode(body, layer, mode) {
    if (mode === 'solid') {
      this._api.layers.resetStyle(layer.id);
      this._renderControls(body, this._api.layers.get(layer.id));
      return;
    }

    const props = this._api.layers.getProperties(layer.id);
    if (props.length === 0) {
      this._api.ui.toast.warning('This layer has no properties to style by');
      return;
    }

    const current = layer.styleRule?.property;
    const usable = this._usableProps(props, mode);
    if (usable.length === 0) {
      this._api.ui.toast.warning('No numeric properties on this layer to group into ranges');
      return;
    }
    const property = usable.some(p => p.name === current) ? current : usable[0].name;

    this._api.layers.applyPropertyStyle(layer.id, property, { mode });
    this._renderControls(body, this._api.layers.get(layer.id));
  },

  // ─── Property-based styling ────────────────────────────────────────────────

  _renderPropertyControls(body, layer, mode) {
    const features = layer.features || [];
    if (features.length === 0) {
      body.appendChild(Utils.createElement('p', { className: 'no-data-msg' }, 'Layer has no features.'));
      return;
    }

    const props = this._api.layers.getProperties(layer.id);
    const usable = this._usableProps(props, mode);
    if (usable.length === 0) {
      body.appendChild(Utils.createElement('p', { className: 'no-data-msg' },
        mode === 'range' ? 'No numeric properties found to group.' : 'No properties found to style by.'));
      return;
    }

    const rule = layer.styleRule || {};

    // Property picker — every property on the features, custom columns included.
    const propGroup = Utils.createElement('div', { className: 'form-group' });
    propGroup.appendChild(Utils.createElement('label', { className: 'form-label' },
      mode === 'range' ? 'Group by property' : 'Color by property'));
    const propSel = Utils.createElement('select', { className: 'form-control form-control-sm' });
    usable.forEach(p => {
      const hint = p.type === 'numeric'
        ? `${PropertyService.formatCompact(p.min)}–${PropertyService.formatCompact(p.max)}`
        : `${p.unique} value${p.unique === 1 ? '' : 's'}`;
      const opt = Utils.createElement('option', { value: p.name }, `${p.name}  (${hint})`);
      if (rule.property === p.name) opt.selected = true;
      propSel.appendChild(opt);
    });
    propSel.addEventListener('change', () => {
      this._api.layers.applyPropertyStyle(layer.id, propSel.value, { mode });
      this._renderControls(this._drawerBody, this._api.layers.get(layer.id));
    });
    propGroup.appendChild(propSel);
    body.appendChild(propGroup);

    if (mode === 'range') this._renderRangeControls(body, layer);
    else this._renderCategoryControls(body, layer);

    this._renderClusterToggle(body, layer);
  },

  // ── Range mode: smart grouping ───────────────────────────────────────────

  _renderRangeControls(body, layer) {
    const rule = layer.styleRule;
    if (!rule || rule.mode !== 'range') return;

    const optionsRow = Utils.createElement('div', { className: 'styler-options-row' });

    // Group count
    const countWrap = Utils.createElement('div', { className: 'styler-option' });
    countWrap.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Groups'));
    const countSel = Utils.createElement('select', { className: 'form-control form-control-sm' });
    for (let i = 2; i <= 9; i++) {
      const opt = Utils.createElement('option', { value: String(i) }, String(i));
      if ((rule.bins || []).length === i) opt.selected = true;
      countSel.appendChild(opt);
    }
    countWrap.appendChild(countSel);
    optionsRow.appendChild(countWrap);

    // Grouping method
    const methodWrap = Utils.createElement('div', { className: 'styler-option' });
    methodWrap.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Grouping'));
    const methodSel = Utils.createElement('select', { className: 'form-control form-control-sm' });
    [
      ['smart', 'Smart (auto)'],
      ['equal', 'Equal width'],
      ['quantile', 'Equal count']
    ].forEach(([value, label]) => {
      const opt = Utils.createElement('option', { value }, label);
      if ((rule.method || 'smart') === value) opt.selected = true;
      methodSel.appendChild(opt);
    });
    methodWrap.appendChild(methodSel);
    optionsRow.appendChild(methodWrap);

    // Palette
    const palWrap = Utils.createElement('div', { className: 'styler-option' });
    palWrap.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Palette'));
    const palSel = Utils.createElement('select', { className: 'form-control form-control-sm' });
    Object.keys(PropertyService.SEQUENTIAL_PALETTES).forEach(name => {
      const opt = Utils.createElement('option', { value: name }, name);
      if ((rule.palette || 'blue') === name) opt.selected = true;
      palSel.appendChild(opt);
    });
    palWrap.appendChild(palSel);
    optionsRow.appendChild(palWrap);

    body.appendChild(optionsRow);

    const regroup = () => {
      this._api.layers.applyPropertyStyle(layer.id, rule.property, {
        mode: 'range',
        count: parseInt(countSel.value, 10),
        method: methodSel.value,
        palette: palSel.value,
        applyToClusters: rule.applyToClusters !== false,
        clusterStat: rule.clusterStat
      });
      this._renderControls(this._drawerBody, this._api.layers.get(layer.id));
    };
    countSel.addEventListener('change', regroup);
    methodSel.addEventListener('change', regroup);
    palSel.addEventListener('change', regroup);

    const note = Utils.createElement('p', { className: 'styler-note' },
      'Smart grouping rounds boundaries to readable values and falls back to equal-count groups when the data is heavily skewed.');
    body.appendChild(note);

    this._renderBinRows(body, layer);
  },

  // Editable group rows: boundary + color + how many features land in it.
  _renderBinRows(body, layer) {
    const rule = layer.styleRule;
    const features = layer.features || [];
    const items = PropertyService.legendItems(rule, features);
    const area = Utils.createElement('div', { className: 'styler-value-map' });

    (rule.bins || []).forEach((bin, i) => {
      const row = Utils.createElement('div', { className: 'styler-bin-row' });

      const colorInput = Utils.createElement('input', { type: 'color' });
      colorInput.value = bin.color;
      colorInput.addEventListener('input', () => {
        bin.color = colorInput.value;
        this._commit(layer, { ...rule, method: 'manual' });
      });

      const from = Utils.createElement('input', { type: 'number', className: 'form-control form-control-sm styler-bin-input' });
      from.value = bin.min;
      from.disabled = i === 0;
      const to = Utils.createElement('input', { type: 'number', className: 'form-control form-control-sm styler-bin-input' });
      to.value = bin.max;
      to.disabled = i === (rule.bins.length - 1);

      // Editing a boundary moves the shared edge between two adjacent groups.
      from.addEventListener('change', () => this._moveEdge(layer, i, parseFloat(from.value)));
      to.addEventListener('change', () => this._moveEdge(layer, i + 1, parseFloat(to.value)));

      const count = Utils.createElement('span', { className: 'styler-value-count' });
      count.textContent = items[i] && items[i].count != null ? items[i].count : '';
      count.title = 'Features in this group';

      row.appendChild(colorInput);
      row.appendChild(from);
      row.appendChild(Utils.createElement('span', { className: 'styler-bin-dash' }, '–'));
      row.appendChild(to);
      row.appendChild(count);
      area.appendChild(row);
    });

    const blanks = items.find(it => it.kind === 'blank');
    if (blanks) {
      const row = Utils.createElement('div', { className: 'styler-value-row' });
      const swatch = Utils.createElement('input', { type: 'color' });
      swatch.value = rule.noValueColor || PropertyService.NO_VALUE_COLOR;
      swatch.addEventListener('input', () => this._commit(layer, { ...rule, noValueColor: swatch.value }));
      const lbl = Utils.createElement('span', { className: 'styler-value-label' }, 'No value / not a number');
      const cnt = Utils.createElement('span', { className: 'styler-value-count' });
      cnt.textContent = blanks.count;
      row.appendChild(swatch);
      row.appendChild(lbl);
      row.appendChild(cnt);
      area.appendChild(row);
    }

    body.appendChild(area);
  },

  // Shift boundary `edgeIndex` (0 = bottom of the first group) to `value`,
  // keeping the groups contiguous and ordered.
  _moveEdge(layer, edgeIndex, value) {
    const rule = layer.styleRule;
    if (!rule || !Array.isArray(rule.bins) || isNaN(value)) return;
    const bins = rule.bins.map(b => ({ ...b }));

    if (edgeIndex <= 0) {
      bins[0].min = Math.min(value, bins[0].max);
    } else if (edgeIndex >= bins.length) {
      bins[bins.length - 1].max = Math.max(value, bins[bins.length - 1].min);
    } else {
      const lower = bins[edgeIndex - 1].min;
      const upper = bins[edgeIndex].max;
      const clamped = Math.min(Math.max(value, lower), upper);
      bins[edgeIndex - 1].max = clamped;
      bins[edgeIndex].min = clamped;
    }

    const desc = PropertyService.describeProperty(layer.features || [], rule.property);
    const isInteger = !!desc?.isInteger;
    const relabeled = bins.map((bin, i) => ({
      ...bin,
      label: PropertyService.rangeLabel(bin.min, bin.max, { isInteger, isLast: i === bins.length - 1 })
    }));

    this._commit(layer, { ...rule, bins: relabeled, method: 'manual' });
    this._renderControls(this._drawerBody, this._api.layers.get(layer.id));
  },

  // ── Categorical mode ─────────────────────────────────────────────────────

  _renderCategoryControls(body, layer) {
    const rule = layer.styleRule;
    if (!rule || rule.mode !== 'categorical') return;

    const features = layer.features || [];
    const desc = PropertyService.describeProperty(features, rule.property);
    const total = desc ? desc.unique : (rule.entries || []).length;

    const optionsRow = Utils.createElement('div', { className: 'styler-options-row' });

    // How many distinct values get their own color before the rest are grouped.
    const shownWrap = Utils.createElement('div', { className: 'styler-option' });
    shownWrap.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Colored values'));
    const shownSel = Utils.createElement('select', { className: 'form-control form-control-sm' });
    [3, 5, 8, 12, 20, 40].filter(n => n <= Math.max(3, total)).forEach(n => {
      const opt = Utils.createElement('option', { value: String(n) }, String(n));
      if ((rule.entries || []).length === n) opt.selected = true;
      shownSel.appendChild(opt);
    });
    shownWrap.appendChild(shownSel);
    optionsRow.appendChild(shownWrap);

    const shuffleWrap = Utils.createElement('div', { className: 'styler-option' });
    shuffleWrap.appendChild(Utils.createElement('label', { className: 'form-label' }, ' '));
    const resetColors = Utils.createElement('button', { className: 'btn btn-secondary btn-sm' }, 'Reset colors');
    resetColors.addEventListener('click', () => {
      this._api.layers.applyPropertyStyle(layer.id, rule.property, {
        mode: 'categorical',
        maxValues: (rule.entries || []).length,
        applyToClusters: rule.applyToClusters !== false
      });
      this._renderControls(this._drawerBody, this._api.layers.get(layer.id));
    });
    shuffleWrap.appendChild(resetColors);
    optionsRow.appendChild(shuffleWrap);

    body.appendChild(optionsRow);

    shownSel.addEventListener('change', () => {
      this._api.layers.applyPropertyStyle(layer.id, rule.property, {
        mode: 'categorical',
        maxValues: parseInt(shownSel.value, 10),
        // Keep any hand-picked colors when the value count changes.
        colors: Object.fromEntries((rule.entries || []).map(e => [e.value, e.color])),
        applyToClusters: rule.applyToClusters !== false
      });
      this._renderControls(this._drawerBody, this._api.layers.get(layer.id));
    });

    if (rule.groupedCount > 0) {
      body.appendChild(Utils.createElement('p', { className: 'styler-note' },
        `${total} distinct values — the ${rule.groupedCount} least common are grouped as "Other".`));
    }

    const items = PropertyService.legendItems(rule, features);
    const area = Utils.createElement('div', { className: 'styler-value-map' });

    items.forEach(item => {
      const row = Utils.createElement('div', { className: 'styler-value-row' });
      const colorInput = Utils.createElement('input', { type: 'color' });
      colorInput.value = item.color;
      colorInput.addEventListener('input', () => {
        const next = { ...rule, entries: (rule.entries || []).map(e => ({ ...e })) };
        if (item.kind === 'blank') next.noValueColor = colorInput.value;
        else if (item.kind === 'other') next.otherColor = colorInput.value;
        else {
          const entry = next.entries.find(e => e.value === item.value);
          if (entry) entry.color = colorInput.value;
        }
        this._commit(layer, next);
      });

      const label = Utils.createElement('span', { className: 'styler-value-label' });
      label.textContent = item.label;
      label.title = item.label;

      const count = Utils.createElement('span', { className: 'styler-value-count' });
      count.textContent = item.count != null ? item.count : '';

      row.appendChild(colorInput);
      row.appendChild(label);
      row.appendChild(count);
      area.appendChild(row);
    });

    body.appendChild(area);
  },

  // ── Cluster handling ─────────────────────────────────────────────────────

  _renderClusterToggle(body, layer) {
    const rule = layer.styleRule;
    if (!rule) return;
    if (layer.type === 'polygon') return; // no cluster pins to color

    const group = Utils.createElement('div', { className: 'form-group' });
    const toggle = Utils.createElement('label', { className: 'settings-toggle' });
    const cb = Utils.createElement('input', { type: 'checkbox' });
    cb.checked = rule.applyToClusters !== false;
    cb.addEventListener('change', () => {
      this._commit(layer, { ...rule, applyToClusters: cb.checked });
      this._renderControls(this._drawerBody, this._api.layers.get(layer.id));
    });
    toggle.appendChild(cb);
    toggle.appendChild(document.createTextNode(' Color cluster pins by this property'));
    group.appendChild(toggle);

    // How a cluster reduces its markers to one value for coloring.
    if (rule.mode === 'range' && cb.checked) {
      const statRow = Utils.createElement('div', { className: 'styler-option' });
      statRow.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Cluster value'));
      const statSel = Utils.createElement('select', { className: 'form-control form-control-sm' });
      [['avg', 'Average of pins'], ['max', 'Highest pin'], ['sum', 'Total of pins']].forEach(([value, label]) => {
        const opt = Utils.createElement('option', { value }, label);
        if ((rule.clusterStat || 'avg') === value) opt.selected = true;
        statSel.appendChild(opt);
      });
      statSel.addEventListener('change', () => this._commit(layer, { ...rule, clusterStat: statSel.value }));
      statRow.appendChild(statSel);
      group.appendChild(statRow);
    }

    body.appendChild(group);
  },

  _commit(layer, rule) {
    this._api.layers.setStyleRule(layer.id, rule);
  },

  // ─── Solid color ───────────────────────────────────────────────────────────

  _renderSolidControls(area, layer) {
    const group = Utils.createElement('div', { className: 'form-group' });
    const label = Utils.createElement('label', { className: 'form-label' }, 'Layer Color');

    const row = Utils.createElement('div', { className: 'styler-color-row' });

    const colorInput = Utils.createElement('input', { type: 'color', className: 'styler-color-input' });
    colorInput.value = layer.color || '#0078d4';

    const swatchRow = Utils.createElement('div', { className: 'styler-swatches' });
    AppConfig.colors.primary.forEach(hex => {
      const swatch = Utils.createElement('div', { className: 'styler-swatch', title: hex });
      swatch.style.background = hex;
      if (hex === layer.color) swatch.classList.add('active');
      swatch.addEventListener('click', () => {
        colorInput.value = hex;
        this._applyColor(layer.id, hex);
        swatchRow.querySelectorAll('.styler-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
      });
      swatchRow.appendChild(swatch);
    });

    colorInput.addEventListener('input', () => {
      this._applyColor(layer.id, colorInput.value);
      swatchRow.querySelectorAll('.styler-swatch').forEach(s => s.classList.remove('active'));
    });

    row.appendChild(colorInput);
    group.appendChild(label);
    group.appendChild(row);
    group.appendChild(swatchRow);
    area.appendChild(group);
  },

  _applyColor(layerId, color) {
    this._api.layers.setColor(layerId, color);
  },

  // ─── Opacity ───────────────────────────────────────────────────────────────

  _renderOpacityControl(area, layer) {
    const group = Utils.createElement('div', { className: 'form-group' });
    const labelRow = Utils.createElement('div', { className: 'styler-slider-label-row' });
    const label = Utils.createElement('label', { className: 'form-label' }, 'Opacity');
    const valueDisplay = Utils.createElement('span', { className: 'styler-slider-value' });
    const currentOpacity = layer.opacity !== undefined ? layer.opacity : 1.0;
    valueDisplay.textContent = Math.round(currentOpacity * 100) + '%';

    const slider = Utils.createElement('input', {
      type: 'range', className: 'styler-slider',
      min: '0', max: '1', step: '0.05'
    });
    slider.value = currentOpacity;

    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      valueDisplay.textContent = Math.round(val * 100) + '%';
      this._api.layers.setOpacity(layer.id, val);
    });

    labelRow.appendChild(label);
    labelRow.appendChild(valueDisplay);
    group.appendChild(labelRow);
    group.appendChild(slider);
    area.appendChild(group);
  },

  // ─── Polygon stroke / fill ────────────────────────────────────────────────

  _renderPolygonControls(area, layer) {
    const layerData = this._api.map.getLayerData(layer.id);
    if (!layerData || layerData.polygons.length === 0) return;

    const storedWeight = this._api.storage.get(`style_${layer.id}_strokeWeight`) || AppConfig.polygon.strokeWeight;

    const group = Utils.createElement('div', { className: 'form-group' });
    const labelRow = Utils.createElement('div', { className: 'styler-slider-label-row' });
    const label = Utils.createElement('label', { className: 'form-label' }, 'Border Weight');
    const valueDisplay = Utils.createElement('span', { className: 'styler-slider-value' }, storedWeight + 'px');

    const slider = Utils.createElement('input', {
      type: 'range', className: 'styler-slider',
      min: '0', max: '8', step: '0.5'
    });
    slider.value = storedWeight;

    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      valueDisplay.textContent = val + 'px';
      layerData.polygons.forEach(p => p.setOptions({ strokeWeight: val }));
      this._api.storage.set(`style_${layer.id}_strokeWeight`, val);
    });

    labelRow.appendChild(label);
    labelRow.appendChild(valueDisplay);
    group.appendChild(labelRow);
    group.appendChild(slider);
    area.appendChild(group);

    const storedFill = this._api.storage.get(`style_${layer.id}_fillOpacity`) || AppConfig.polygon.fillOpacity;

    const fillGroup = Utils.createElement('div', { className: 'form-group' });
    const fillLabelRow = Utils.createElement('div', { className: 'styler-slider-label-row' });
    const fillLabel = Utils.createElement('label', { className: 'form-label' }, 'Fill Opacity');
    const fillDisplay = Utils.createElement('span', { className: 'styler-slider-value' }, Math.round(storedFill * 100) + '%');

    const fillSlider = Utils.createElement('input', {
      type: 'range', className: 'styler-slider',
      min: '0', max: '1', step: '0.05'
    });
    fillSlider.value = storedFill;

    fillSlider.addEventListener('input', () => {
      const val = parseFloat(fillSlider.value);
      fillDisplay.textContent = Math.round(val * 100) + '%';
      layerData.polygons.forEach(p => p.setOptions({ fillOpacity: val }));
      this._api.storage.set(`style_${layer.id}_fillOpacity`, val);
    });

    fillLabelRow.appendChild(fillLabel);
    fillLabelRow.appendChild(fillDisplay);
    fillGroup.appendChild(fillLabelRow);
    fillGroup.appendChild(fillSlider);
    area.appendChild(fillGroup);
  },

  // ─── Map legend ────────────────────────────────────────────────────────────

  // One panel listing every visible layer that is styled by a property, so the
  // colors on the map are always decodable.
  _renderLegend() {
    const styled = this._api.layers.getAll()
      .filter(l => l.visible && PropertyService.isRule(l.styleRule));

    if (styled.length === 0) {
      this._removeLegend();
      return;
    }

    const el = Utils.createElement('div', { className: 'style-legend' });
    styled.forEach(layer => {
      const section = Utils.createElement('div', { className: 'style-legend-section' });
      const title = Utils.createElement('div', { className: 'style-legend-title' });
      title.textContent = layer.name;
      const sub = Utils.createElement('div', { className: 'style-legend-sub' });
      sub.textContent = layer.styleRule.property;
      section.appendChild(title);
      section.appendChild(sub);

      PropertyService.legendItems(layer.styleRule, layer.features || []).forEach(item => {
        if (item.count === 0) return; // don't advertise empty groups
        const row = Utils.createElement('div', { className: 'style-legend-item' });
        const dot = Utils.createElement('span', { className: 'style-legend-dot' });
        dot.style.background = item.color;
        const label = Utils.createElement('span', { className: 'style-legend-label' });
        label.textContent = item.label;
        const count = Utils.createElement('span', { className: 'style-legend-count' });
        count.textContent = item.count != null ? Utils.formatNumber(item.count) : '';
        row.appendChild(dot);
        row.appendChild(label);
        row.appendChild(count);
        section.appendChild(row);
      });
      el.appendChild(section);
    });

    this._removeLegend();
    const map = this._api.map.getMap();
    if (!map) return;
    map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(el);
    this._legendEl = el;
  },

  _removeLegend() {
    if (!this._legendEl) return;
    const map = this._api.map.getMap && this._api.map.getMap();
    if (map) {
      const arr = map.controls[google.maps.ControlPosition.RIGHT_BOTTOM];
      for (let i = 0; i < arr.getLength(); i++) {
        if (arr.getAt(i) === this._legendEl) { arr.removeAt(i); break; }
      }
    }
    this._legendEl = null;
  }
};

AppRegistry.whenReady('pluginRegistry', r => r.register(LayerStylerPlugin));
