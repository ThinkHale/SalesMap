// plugins/layer-styler.js — Visual style editor for individual layers

const LayerStylerPlugin = {
  id: 'layer-styler',
  name: 'Layer Styler',
  version: '1.0.0',
  description: 'Edit the visual style of individual layers: color, opacity, property-based coloring, and polygon stroke weight.',
  author: 'SalesMapper',
  minAppVersion: '4.0.0',

  permissions: [
    'layers.read',
    'layers.write',
    'map.read',
    'ui.slot:sidebar-panel',
    'ui.toast',
    'events.listen',
    'storage.read',
    'storage.write'
  ],

  configSchema: {},

  _api: null,
  _panelBody: null,
  _selectedLayerId: null,

  init(api) {
    this._api = api;

    api.ui.addSidebarPanel(body => {
      this._panelBody = body;
      this._render();
    }, 'Layer Styler');

    // Re-render layer list when layers change
    const relayer = () => this._render();
    api.events.on('layer.created', relayer);
    api.events.on('layer.deleted', () => {
      // If the selected layer was deleted, clear selection
      if (this._selectedLayerId) {
        const still = api.layers.get(this._selectedLayerId);
        if (!still) this._selectedLayerId = null;
      }
      this._render();
    });
    api.events.on('layer.renamed', relayer);
    api.events.on('layers.imported', relayer);
  },

  onEnable() { this._render(); },
  destroy() { this._panelBody = null; },

  // ─── Main render ───────────────────────────────────────────────────────────

  _render() {
    const body = this._panelBody;
    if (!body) return;
    body.innerHTML = '';

    const layers = this._api.layers.getAll();
    if (layers.length === 0) {
      body.appendChild(Utils.createElement('p', { className: 'no-data-msg' }, 'No layers to style.'));
      return;
    }

    // Layer selector
    const selGroup = Utils.createElement('div', { className: 'form-group' });
    const selLabel = Utils.createElement('label', { className: 'form-label' }, 'Layer');
    const sel = Utils.createElement('select', { className: 'form-control form-control-sm' });

    const blankOpt = Utils.createElement('option', { value: '' }, '— select a layer —');
    sel.appendChild(blankOpt);

    layers.forEach(layer => {
      const opt = Utils.createElement('option', { value: layer.id });
      opt.textContent = layer.name;
      if (layer.id === this._selectedLayerId) opt.selected = true;
      sel.appendChild(opt);
    });

    sel.addEventListener('change', () => {
      this._selectedLayerId = sel.value || null;
      this._renderControls(body, sel);
    });

    selGroup.appendChild(selLabel);
    selGroup.appendChild(sel);
    body.appendChild(selGroup);

    // Controls area (populated when a layer is selected)
    const controlsArea = Utils.createElement('div', { id: 'styler-controls' });
    body.appendChild(controlsArea);

    if (this._selectedLayerId) {
      sel.value = this._selectedLayerId;
      this._renderControls(body, sel);
    }
  },

  _renderControls(body, sel) {
    // Remove any existing controls
    const existing = body.querySelector('#styler-controls');
    if (existing) existing.innerHTML = '';
    const area = existing || body;

    const layerId = sel.value;
    if (!layerId) return;

    const layer = this._api.layers.get(layerId);
    if (!layer) return;

    // ── Mode toggle ───────────────────────────────────────────────────────────
    const modeGroup = Utils.createElement('div', { className: 'form-group' });
    const modeLabel = Utils.createElement('label', { className: 'form-label' }, 'Style Mode');

    const modeRow = Utils.createElement('div', { className: 'styler-mode-row' });
    const modes = [
      { value: 'solid', label: 'Solid Color' },
      { value: 'property', label: 'By Property' }
    ];
    const currentMode = layer.styleType === 'property' ? 'property' : 'solid';

    modes.forEach(({ value, label }) => {
      const btn = Utils.createElement('button', {
        className: `btn btn-sm ${currentMode === value ? 'btn-primary' : 'btn-secondary'}`
      }, label);
      btn.addEventListener('click', () => {
        this._selectedLayerId = layerId;
        // Update mode on layer
        if (value === 'solid') {
          this._api.layers.resetStyle(layerId);
        }
        this._renderControls(body, sel);
      });
      modeRow.appendChild(btn);
    });

    modeGroup.appendChild(modeLabel);
    modeGroup.appendChild(modeRow);
    area.appendChild(modeGroup);

    // ── Solid color controls ──────────────────────────────────────────────────
    if (currentMode === 'solid') {
      this._renderSolidControls(area, layer);
    } else {
      this._renderPropertyControls(area, layer);
    }

    // ── Opacity (always shown) ────────────────────────────────────────────────
    this._renderOpacityControl(area, layer);

    // ── Polygon-specific controls ─────────────────────────────────────────────
    if (layer.type === 'polygon' || layer.type === 'mixed') {
      this._renderPolygonControls(area, layer);
    }
  },

  // ─── Solid color ───────────────────────────────────────────────────────────

  _renderSolidControls(area, layer) {
    const group = Utils.createElement('div', { className: 'form-group' });
    const label = Utils.createElement('label', { className: 'form-label' }, 'Layer Color');

    const row = Utils.createElement('div', { className: 'styler-color-row' });

    // Color picker
    const colorInput = Utils.createElement('input', { type: 'color', className: 'styler-color-input' });
    colorInput.value = layer.color || '#0078d4';

    // Preset swatches
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
    this._api.storage.set(`style_${layerId}_color`, color);
  },

  // ─── Property-based coloring ──────────────────────────────────────────────

  _renderPropertyControls(area, layer) {
    const features = layer.features || [];
    if (features.length === 0) {
      area.appendChild(Utils.createElement('p', { className: 'no-data-msg' }, 'Layer has no features.'));
      return;
    }

    // Build list of categorical/numeric properties (exclude system props)
    const systemProps = new Set(AppConfig.featureInfo.systemProperties.concat(['importedAt', 'source', '_rowIndex']));
    const propCounts = {};
    features.forEach(f => {
      Object.keys(f).forEach(k => {
        if (!systemProps.has(k) && f[k] !== null && f[k] !== undefined && f[k] !== '') {
          propCounts[k] = (propCounts[k] || 0) + 1;
        }
      });
    });

    const props = Object.keys(propCounts).filter(k => propCounts[k] > 0);
    if (props.length === 0) {
      area.appendChild(Utils.createElement('p', { className: 'no-data-msg' }, 'No properties found to style by.'));
      return;
    }

    // Property selector
    const propGroup = Utils.createElement('div', { className: 'form-group' });
    const propLabel = Utils.createElement('label', { className: 'form-label' }, 'Color by Property');
    const propSel = Utils.createElement('select', { className: 'form-control form-control-sm' });
    const blankOpt = Utils.createElement('option', { value: '' }, '— select property —');
    propSel.appendChild(blankOpt);

    const priorityProps = ['tier', 'bdm', 'state', 'territory', 'region'];
    const sorted = Utils.sortBy(props, p => priorityProps.includes(p.toLowerCase()) ? 0 : 1);
    sorted.forEach(p => {
      const opt = Utils.createElement('option', { value: p }, p);
      if (layer.styleProperty === p) opt.selected = true;
      propSel.appendChild(opt);
    });

    const valueMapArea = Utils.createElement('div', { className: 'styler-value-map' });

    const renderValueMap = (property) => {
      valueMapArea.innerHTML = '';
      if (!property) return;

      // Collect unique values
      const valueSet = new Set();
      features.forEach(f => {
        const v = f[property];
        if (v !== null && v !== undefined && v !== '') valueSet.add(String(v));
      });
      const uniqueValues = Utils.sortBy([...valueSet], v => v);

      if (uniqueValues.length === 0) return;
      if (uniqueValues.length > 30) {
        valueMapArea.appendChild(Utils.createElement('p', { className: 'no-data-msg' },
          `${uniqueValues.length} unique values — too many to map individually. Using built-in tier colors.`));
        this._api.layers.applyPropertyStyle(layer.id, property);
        return;
      }

      const note = Utils.createElement('p', { className: 'styler-note' });
      note.textContent = `${uniqueValues.length} unique values:`;
      valueMapArea.appendChild(note);

      // Build color map from stored overrides + defaults
      const stored = this._api.storage.get(`style_${layer.id}_propmap_${property}`) || {};
      const colorMap = {};

      uniqueValues.forEach((val, i) => {
        const defaultColor = AppConfig.colors.tierMap[val.toLowerCase()]
          || AppConfig.colors.primary[i % AppConfig.colors.primary.length];
        colorMap[val] = stored[val] || defaultColor;

        const row = Utils.createElement('div', { className: 'styler-value-row' });
        const valLabel = Utils.createElement('span', { className: 'styler-value-label' });
        valLabel.textContent = val;

        const countSpan = Utils.createElement('span', { className: 'styler-value-count' });
        const count = features.filter(f => String(f[property]) === val).length;
        countSpan.textContent = count;

        const colorInput = Utils.createElement('input', { type: 'color' });
        colorInput.value = colorMap[val];
        colorInput.addEventListener('input', () => {
          colorMap[val] = colorInput.value;
          this._applyCustomPropertyStyle(layer, property, colorMap);
        });

        row.appendChild(valLabel);
        row.appendChild(countSpan);
        row.appendChild(colorInput);
        valueMapArea.appendChild(row);
      });

      // Apply button
      const applyBtn = Utils.createElement('button', { className: 'btn btn-primary btn-sm', style: { marginTop: '8px', width: '100%' } }, 'Apply Style');
      applyBtn.addEventListener('click', () => {
        this._api.storage.set(`style_${layer.id}_propmap_${property}`, colorMap);
        this._applyCustomPropertyStyle(layer, property, colorMap);
        this._api.ui.toast.success(`Style applied by "${property}"`);
      });
      valueMapArea.appendChild(applyBtn);
    };

    propSel.addEventListener('change', () => renderValueMap(propSel.value));
    if (layer.styleProperty) renderValueMap(layer.styleProperty);

    propGroup.appendChild(propLabel);
    propGroup.appendChild(propSel);
    area.appendChild(propGroup);
    area.appendChild(valueMapArea);
  },

  _applyCustomPropertyStyle(layer, property, colorMap) {
    const layerData = this._api.map.getLayerData(layer.id);
    if (!layerData) return;

    // Apply to markers
    layerData.markers.forEach(marker => {
      const val = String(marker._featureData[property] || '');
      const color = colorMap[val] || layer.color || AppConfig.colors.default;
      const icon = marker.getIcon();
      if (icon) marker.setIcon({ ...icon, fillColor: color });
    });

    // Apply to polygons
    layerData.polygons.forEach(polygon => {
      const val = String(polygon._featureData[property] || '');
      const color = colorMap[val] || layer.color || AppConfig.colors.default;
      polygon.setOptions({ fillColor: color, strokeColor: color });
    });

    layer.styleType = 'property';
    layer.styleProperty = property;
    eventBus.emit('layer.style.changed', { layerId: layer.id, styleType: 'property', property });
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
      this._api.storage.set(`style_${layer.id}_opacity`, val);
    });

    labelRow.appendChild(label);
    labelRow.appendChild(valueDisplay);
    group.appendChild(labelRow);
    group.appendChild(slider);
    area.appendChild(group);
  },

  // ─── Polygon stroke weight ────────────────────────────────────────────────

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

    // Fill opacity (separate from overall layer opacity)
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
  }
};

AppRegistry.whenReady('pluginRegistry', r => r.register(LayerStylerPlugin));
