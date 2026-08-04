// js/controllers/import-controller.js — ImportController
//
// Drives the import wizard: pick which workbook tabs to bring in, map each
// distinct set of columns once, validate, then create one layer per tab.

const ImportController = {
  _pendingData: null,
  _selectedSheets: null,   // Set of sheet names chosen in the tab picker
  _geocodingCancelled: false,

  // Step 1: File selected → parse → detect → show wizard
  async handleFileSelected(file) {
    const csvParser = AppRegistry.require('csvParser');
    loadingManager.show('Reading file...');
    try {
      this._pendingData = await csvParser.parseFile(file);
      this._initSelection();
      loadingManager.hide();
      this._showImportWizard();
    } catch (err) {
      loadingManager.hide();
      AppErrorHandler.handle(err, 'ImportController.handleFileSelected');
    }
  },

  // Accept pasted CSV text
  async handlePastedText(text) {
    if (!text || !text.trim()) return;
    loadingManager.show('Parsing data...');
    try {
      const results = Papa.parse(text.trim(), {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true
      });
      const rawData = results.data;
      if (!rawData || rawData.length === 0) throw new Error('No data rows found in pasted text');

      const csvParser = AppRegistry.require('csvParser');
      const analysis = csvParser.analyzeSheet({ name: 'Pasted data', rows: rawData });
      this._pendingData = {
        ...csvParser._pendingShapeFor(analysis),
        sheets: [analysis],
        sheetName: analysis.name
      };
      this._initSelection();
      loadingManager.hide();
      this._showImportWizard();
    } catch (err) {
      loadingManager.hide();
      AppErrorHandler.handle(err, 'ImportController.handlePastedText');
    }
  },

  // ─── Tab selection ─────────────────────────────────────────────────────────

  // Start with the tab that looks most like data, plus any other tab sharing its
  // columns — the common "one tab per region/year" workbook imports in one pass.
  _initSelection() {
    const d = this._pendingData;
    const primary = d.sheets.find(s => s.name === d.sheetName) || d.sheets[0];
    const siblings = d.sheets
      .filter(s => s.rowCount > 0 && s.signature === primary.signature)
      .map(s => s.name);
    this._selectedSheets = new Set(siblings.length > 0 ? siblings : [primary.name]);
  },

  _selectedSheetList() {
    const d = this._pendingData;
    return d.sheets.filter(s => this._selectedSheets.has(s.name) && s.rowCount > 0);
  },

  // Selected tabs bucketed by column signature: one mapping per bucket.
  _selectedGroups() {
    const groups = new Map();
    this._selectedSheetList().forEach(sheet => {
      let group = groups.get(sheet.signature);
      if (!group) {
        group = { signature: sheet.signature, columns: sheet.columns, columnMap: sheet.columnMap, sheets: [] };
        groups.set(sheet.signature, group);
      }
      group.sheets.push(sheet);
    });
    return [...groups.values()];
  },

  _showImportWizard() {
    const d = this._pendingData;
    const dataTabs = d.sheets.filter(s => s.rowCount > 0).length;
    const title = d.sheets.length > 1
      ? `Import Data — ${d.sheets.length} tabs (${dataTabs} with data)`
      : `Import Data — ${d.rowCount} rows detected`;
    drawerManager.open((body) => this._renderWizardStep1(body), title);
  },

  _renderWizardStep1(body) {
    const d = this._pendingData;
    body.innerHTML = '';

    if (d.sheets.length > 1) this._renderTabPicker(body);

    const groups = this._selectedGroups();
    if (groups.length === 0) {
      body.appendChild(Utils.createElement('div', { className: 'no-data-msg' },
        'Select at least one tab to import.'));
      return;
    }

    const multiLayer = this._selectedSheetList().length > 1;

    // Layer name — only meaningful for a single tab; multiple tabs are named
    // after the tab they came from.
    if (!multiLayer) {
      const sheet = this._selectedSheetList()[0];
      const nameGroup = Utils.createElement('div', { className: 'form-group' });
      nameGroup.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Layer Name'));
      const nameInput = Utils.createElement('input', { type: 'text', className: 'form-control', id: 'importLayerName' });
      nameInput.value = this._defaultLayerName(sheet, d.sheets.length > 1);
      nameGroup.appendChild(nameInput);
      body.appendChild(nameGroup);
    }

    groups.forEach((group, i) => this._renderGroupSection(body, group, i, groups.length));

    // Summary
    const totalRows = this._selectedSheetList().reduce((n, s) => n + s.rowCount, 0);
    const summary = Utils.createElement('div', { className: 'import-summary' });
    summary.textContent = multiLayer
      ? `${totalRows} rows across ${this._selectedSheetList().length} tabs · ${groups.length} column layout${groups.length === 1 ? '' : 's'}`
      : `${totalRows} rows · ${groups[0].columns.length} columns · Detected type: ${this._groupType(groups[0])}`;
    body.appendChild(summary);

    const nextBtn = Utils.createElement('button', { className: 'btn btn-primary import-next-btn' }, 'Validate & Continue →');
    nextBtn.addEventListener('click', () => this._buildPlanAndValidate(body));
    body.appendChild(nextBtn);
  },

  _defaultLayerName(sheet, isWorkbook) {
    if (isWorkbook) return sheet.name;
    const first = sheet.rows[0];
    const territoryCol = sheet.columnMap.territory;
    if (territoryCol && first && first[territoryCol]) return String(first[territoryCol]);
    return `Import ${new Date().toLocaleDateString()}`;
  },

  // ── Tab picker ────────────────────────────────────────────────────────────

  _renderTabPicker(body) {
    const d = this._pendingData;
    const section = Utils.createElement('div', { className: 'import-col-section' });
    section.appendChild(Utils.createElement('div', { className: 'import-section-title' }, 'Tabs to import'));
    section.appendChild(Utils.createElement('div', { className: 'import-section-hint' },
      'Each selected tab becomes its own layer. Tabs with matching columns are mapped together.'));

    const list = Utils.createElement('div', { className: 'import-tab-list' });
    d.sheets.forEach(sheet => {
      const empty = sheet.rowCount === 0;
      const row = Utils.createElement('label', {
        className: `import-tab-row${empty ? ' import-tab-empty' : ''}`,
        title: empty ? 'This tab has no data rows' : `${sheet.columns.length} columns`
      });
      const cb = Utils.createElement('input', { type: 'checkbox', 'data-sheet': sheet.name });
      cb.checked = this._selectedSheets.has(sheet.name) && !empty;
      cb.disabled = empty;
      cb.addEventListener('change', () => {
        if (cb.checked) this._selectedSheets.add(sheet.name);
        else this._selectedSheets.delete(sheet.name);
        this._renderWizardStep1(body);
      });
      row.appendChild(cb);

      const label = Utils.createElement('span', { className: 'import-tab-name' });
      label.textContent = sheet.name;
      row.appendChild(label);

      const meta = Utils.createElement('span', { className: 'import-tab-meta' });
      meta.textContent = empty
        ? 'no data'
        : `${Utils.formatNumber(sheet.rowCount)} rows, ${sheet.columns.length} cols`;
      row.appendChild(meta);

      // Flag the tabs that don't look like a dataset, so a summary or cover page
      // isn't imported by mistake.
      if (!empty && Object.keys(sheet.columnMap).length === 0) {
        const warn = Utils.createElement('span', { className: 'import-tab-warn', title: 'No recognizable location columns found on this tab' }, '⚠');
        row.appendChild(warn);
      }
      list.appendChild(row);
    });
    section.appendChild(list);

    // What the current selection will produce.
    const selected = this._selectedSheetList();
    const groups = this._selectedGroups();
    const status = Utils.createElement('div', { className: 'import-tab-status' });
    if (selected.length === 0) {
      status.textContent = 'No tabs selected.';
    } else if (groups.length === 1 && selected.length > 1) {
      status.textContent = `✓ All ${selected.length} selected tabs share the same columns — one mapping will be used. Creates ${selected.length} layers.`;
    } else if (groups.length > 1) {
      status.textContent = `Selected tabs use ${groups.length} different column layouts — map each below. Creates ${selected.length} layers.`;
      status.classList.add('import-tab-status-warn');
    } else {
      status.textContent = `Creates 1 layer from “${selected[0].name}”.`;
    }
    section.appendChild(status);

    body.appendChild(section);
  },

  // ── Column mapping (one section per distinct column layout) ───────────────

  _groupType(group, mapping) {
    return AppRegistry.require('csvParser').detectDataType(mapping || group.columnMap);
  },

  _renderGroupSection(body, group, index, groupCount) {
    const csvParser = AppRegistry.require('csvParser');
    const templateMatch = csvParser.findMatchingTemplate(group.columns);
    const currentMapping = templateMatch
      ? { ...group.columnMap, ...templateMatch.template.mapping }
      : { ...group.columnMap };

    const section = Utils.createElement('div', { className: 'import-col-section import-group-section', 'data-group': String(index) });

    // Only name the section when there's more than one layout to distinguish.
    if (groupCount > 1) {
      const heading = Utils.createElement('div', { className: 'import-section-title' },
        `Columns for: ${group.sheets.map(s => s.name).join(', ')}`);
      section.appendChild(heading);
    } else {
      section.appendChild(Utils.createElement('div', { className: 'import-section-title' }, 'Column Mapping'));
    }

    if (templateMatch) {
      const notice = Utils.createElement('div', { className: 'import-notice' });
      notice.textContent = `Template applied: "${templateMatch.name}"`;
      section.appendChild(notice);
    }

    // Feature name field — prominent, since it labels every feature in the layer menu.
    const nameFieldGroup = Utils.createElement('div', { className: 'form-group' });
    nameFieldGroup.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Feature name field'));
    nameFieldGroup.appendChild(Utils.createElement('div', { className: 'import-section-hint' },
      'Which column labels each feature in the layer menu and on the map.'));
    const nameFieldSel = Utils.createElement('select', { className: 'form-control', 'data-field': 'name' });
    nameFieldSel.appendChild(Utils.createElement('option', { value: '' }, '— none (features will be Untitled) —'));
    group.columns.forEach(col => {
      const opt = Utils.createElement('option', { value: col });
      opt.textContent = col;
      if (currentMapping.name === col) opt.selected = true;
      nameFieldSel.appendChild(opt);
    });
    nameFieldGroup.appendChild(nameFieldSel);
    section.appendChild(nameFieldGroup);

    const colGrid = Utils.createElement('div', { className: 'column-mapping-grid' });
    const supportedFields = Object.keys(AppConfig.csvParser.supportedColumns).filter(f => f !== 'name');

    supportedFields.forEach(field => {
      const row = Utils.createElement('div', { className: 'col-map-row' });
      const lbl = Utils.createElement('label', { className: 'col-map-label' });
      lbl.textContent = field;
      const sel = Utils.createElement('select', { className: 'form-control form-control-sm', 'data-field': field });
      sel.appendChild(Utils.createElement('option', { value: '' }, '— not mapped —'));
      group.columns.forEach(col => {
        const opt = Utils.createElement('option', { value: col });
        opt.textContent = col;
        if (currentMapping[field] === col) opt.selected = true;
        sel.appendChild(opt);
      });
      row.appendChild(lbl);
      row.appendChild(sel);
      colGrid.appendChild(row);
    });
    section.appendChild(colGrid);

    // Additional fields — any unmapped columns, kept as custom properties the user
    // can sort, filter, and style by (e.g. a "Tenure" column with no built-in field).
    const mappedCols = new Set(Object.values(currentMapping));
    const customCandidates = group.columns.filter(c => !mappedCols.has(c));
    if (customCandidates.length > 0) {
      const customSection = Utils.createElement('div', { className: 'import-custom-section' });
      customSection.appendChild(Utils.createElement('div', { className: 'import-section-subtitle' }, 'Additional fields'));
      customSection.appendChild(Utils.createElement('div', { className: 'import-section-hint' },
        'Imported as custom properties you can sort, filter, and style by. Uncheck any you don\'t need.'));
      const customList = Utils.createElement('div', { className: 'import-custom-fields' });
      customCandidates.forEach(col => {
        const row = Utils.createElement('label', { className: 'import-custom-field' });
        const cb = Utils.createElement('input', { type: 'checkbox', 'data-col': col });
        cb.checked = true;
        row.appendChild(cb);
        row.appendChild(document.createTextNode(' ' + col));
        customList.appendChild(row);
      });
      customSection.appendChild(customList);
      section.appendChild(customSection);
    }

    const templateRow = Utils.createElement('div', { className: 'template-row' });
    const saveTplBtn = Utils.createElement('button', { className: 'btn btn-secondary btn-sm' }, 'Save as Template');
    saveTplBtn.addEventListener('click', () => {
      const name = prompt('Template name:');
      if (name) {
        csvParser.saveTemplate(name, this._readColumnMapping(section));
        toastManager.success(`Template "${name}" saved`);
      }
    });
    templateRow.appendChild(saveTplBtn);
    section.appendChild(templateRow);

    body.appendChild(section);
  },

  _readColumnMapping(container) {
    const mapping = {};
    container.querySelectorAll('select[data-field]').forEach(sel => {
      if (sel.value) mapping[sel.getAttribute('data-field')] = sel.value;
    });
    return mapping;
  },

  _readCustomColumns(container) {
    return [...container.querySelectorAll('.import-custom-fields input[data-col]:checked')]
      .map(c => c.getAttribute('data-col'));
  },

  // ─── Validation step ───────────────────────────────────────────────────────

  // Read the mapping out of each group's section, then validate every selected
  // tab against the mapping for its own column layout.
  _buildPlanAndValidate(body) {
    const csvParser = AppRegistry.require('csvParser');
    const groups = this._selectedGroups();
    const sections = [...body.querySelectorAll('.import-group-section')];
    const nameInput = body.querySelector('#importLayerName');
    const multiLayer = this._selectedSheetList().length > 1;

    const entries = [];
    groups.forEach((group, i) => {
      const section = sections[i];
      if (!section) return;
      const mapping = this._readColumnMapping(section);
      const customColumns = this._readCustomColumns(section);
      const dataType = csvParser.detectDataType(mapping);

      group.sheets.forEach(sheet => {
        entries.push({
          sheetName: sheet.name,
          rows: sheet.rows,
          mapping,
          customColumns,
          dataType,
          layerName: multiLayer
            ? sheet.name
            : ((nameInput && nameInput.value.trim()) || sheet.name || 'Imported Layer'),
          validation: csvParser.validateData(sheet.rows, mapping, dataType)
        });
      });
    });

    this._renderWizardStep2(body, entries);
  },

  _renderWizardStep2(body, entries) {
    body.innerHTML = '';

    body.appendChild(Utils.createElement('div', { className: 'import-section-title' }, 'Validation Results'));

    const totalRows = entries.reduce((n, e) => n + e.validation.totalRows, 0);
    const totalValid = entries.reduce((n, e) => n + e.validation.validCount, 0);
    const totalInvalid = entries.reduce((n, e) => n + e.validation.invalidCount, 0);

    const statsRow = Utils.createElement('div', { className: 'validation-stats' });
    const addStat = (label, value, cls = '') => {
      const stat = Utils.createElement('div', { className: `val-stat ${cls}` });
      const v = Utils.createElement('span', { className: 'val-stat-value' });
      v.textContent = String(value);
      const l = Utils.createElement('span', { className: 'val-stat-label' });
      l.textContent = label;
      stat.appendChild(v);
      stat.appendChild(l);
      statsRow.appendChild(stat);
    };
    addStat('Total Rows', totalRows);
    addStat('Valid', totalValid, 'stat-good');
    addStat('Errors', totalInvalid, totalInvalid > 0 ? 'stat-bad' : '');
    body.appendChild(statsRow);

    // Per-tab breakdown, so one bad tab is obvious in a multi-tab import.
    if (entries.length > 1) {
      const perTab = Utils.createElement('div', { className: 'import-tab-results' });
      entries.forEach(e => {
        const row = Utils.createElement('div', {
          className: `import-tab-result${e.validation.validCount === 0 ? ' import-tab-result-bad' : ''}`
        });
        const name = Utils.createElement('span', { className: 'import-tab-name' });
        name.textContent = e.sheetName;
        const detail = Utils.createElement('span', { className: 'import-tab-meta' });
        detail.textContent = e.validation.invalidCount > 0
          ? `${e.validation.validCount} valid, ${e.validation.invalidCount} skipped · ${e.dataType}`
          : `${e.validation.validCount} valid · ${e.dataType}`;
        row.appendChild(name);
        row.appendChild(detail);
        perTab.appendChild(row);
      });
      body.appendChild(perTab);
    }

    if (totalInvalid > 0) {
      const errorSection = Utils.createElement('div', { className: 'error-list-section' });
      const errTitle = Utils.createElement('div', { className: 'error-list-title' });
      errTitle.textContent = `${totalInvalid} row(s) will be skipped:`;
      errorSection.appendChild(errTitle);

      const errList = Utils.createElement('div', { className: 'error-list' });
      let shown = 0;
      entries.forEach(e => {
        e.validation.invalidRows.forEach(row => {
          if (shown >= 20) return;
          const item = Utils.createElement('div', { className: 'error-item' });
          const prefix = entries.length > 1 ? `${e.sheetName} — ` : '';
          item.textContent = `${prefix}Row ${row._rowIndex + 1}: ${(row._errors || []).join('; ')}`;
          errList.appendChild(item);
          shown++;
        });
      });
      if (totalInvalid > shown) {
        const more = Utils.createElement('div', { className: 'error-more' });
        more.textContent = `... and ${totalInvalid - shown} more`;
        errList.appendChild(more);
      }
      errorSection.appendChild(errList);
      body.appendChild(errorSection);
    }

    const btnRow = Utils.createElement('div', { className: 'import-btn-row' });

    const backBtn = Utils.createElement('button', { className: 'btn btn-secondary' }, '← Back');
    backBtn.addEventListener('click', () => this._showImportWizard());

    const importable = entries.filter(e => e.validation.validCount > 0);
    const layerWord = importable.length === 1 ? 'layer' : 'layers';
    const importBtn = Utils.createElement('button', {
      className: 'btn btn-primary',
      ...(totalValid === 0 ? { disabled: 'disabled' } : {})
    }, `Import ${totalValid} row(s) → ${importable.length} ${layerWord}`);

    importBtn.addEventListener('click', () => {
      const needsGeocoding = importable.filter(e => e.dataType === 'address');
      if (needsGeocoding.length > 0) this._renderWizardStep3(body, importable);
      else this._finishImport(importable.map(e => this._buildLayerSpec(e)));
    });

    btnRow.appendChild(backBtn);
    btnRow.appendChild(importBtn);
    body.appendChild(btnRow);
  },

  _buildLayerSpec(entry, rowsOverride, mappingOverride) {
    const csvParser = AppRegistry.require('csvParser');
    const rows = rowsOverride || entry.validation.validRows;
    const mapping = mappingOverride || entry.mapping;
    const dataType = mappingOverride ? 'point' : entry.dataType;
    return {
      layerName: entry.layerName,
      type: dataType,
      features: csvParser.extractFeatures(rows, mapping, dataType, { customColumns: entry.customColumns })
    };
  },

  // ─── Geocoding step ────────────────────────────────────────────────────────

  // Address tabs are geocoded one after another; coordinate tabs pass straight through.
  async _renderWizardStep3(body, entries) {
    body.innerHTML = '';
    this._geocodingCancelled = false;

    const title = Utils.createElement('div', { className: 'import-section-title' }, 'Geocoding Addresses...');
    body.appendChild(title);

    const tabLabel = Utils.createElement('div', { className: 'import-section-hint' });
    body.appendChild(tabLabel);

    const progressWrap = Utils.createElement('div', { className: 'geocoding-progress-wrap' });
    const progressBar = Utils.createElement('div', { className: 'geocoding-progress-bar' });
    progressBar.style.width = '0%';
    const progressText = Utils.createElement('div', { className: 'geocoding-progress-text' }, 'Starting...');
    progressWrap.appendChild(progressBar);
    progressWrap.appendChild(progressText);
    body.appendChild(progressWrap);

    const geocodingService = AppRegistry.require('geocodingService');

    const cancelBtn = Utils.createElement('button', { className: 'btn btn-secondary btn-sm' }, 'Cancel');
    cancelBtn.addEventListener('click', () => {
      this._geocodingCancelled = true;
      geocodingService.cancelBatch();
      drawerManager.close();
    });
    body.appendChild(cancelBtn);

    const specs = [];
    const skipped = [];
    const addressEntries = entries.filter(e => e.dataType === 'address');

    try {
      for (const entry of entries) {
        if (this._geocodingCancelled) return;

        if (entry.dataType !== 'address') {
          specs.push(this._buildLayerSpec(entry));
          continue;
        }

        const position = addressEntries.indexOf(entry) + 1;
        tabLabel.textContent = addressEntries.length > 1
          ? `Tab ${position} of ${addressEntries.length}: “${entry.sheetName}”`
          : `“${entry.sheetName}”`;

        const { geocoded, failed } = await geocodingService.geocodeBatch(
          entry.validation.validRows,
          entry.mapping,
          ({ current, total, percent }) => {
            progressBar.style.width = percent + '%';
            progressText.textContent = `${current} / ${total} (${percent}%)`;
          }
        );
        if (this._geocodingCancelled) return;

        if (failed.length > 0) skipped.push(`${entry.sheetName}: ${failed.length}`);
        if (geocoded.length === 0) continue;

        // Geocoding adds latitude/longitude columns to each row — map them so
        // extractFeatures treats them as the point geometry.
        specs.push(this._buildLayerSpec(
          entry, geocoded, { ...entry.mapping, latitude: 'latitude', longitude: 'longitude' }));
      }

      if (skipped.length > 0) {
        toastManager.warning(`Addresses that could not be geocoded were skipped — ${skipped.join(', ')}`);
      }
      await this._finishImport(specs);
    } catch (err) {
      AppErrorHandler.handle(err, 'ImportController.geocodeBatch');
    }
  },

  // ─── Commit ────────────────────────────────────────────────────────────────

  // One layer per tab, committed as a single history entry so an accidental
  // multi-tab import is one undo away.
  async _finishImport(specs) {
    const usable = (specs || []).filter(s => s.features && s.features.length > 0);
    if (usable.length === 0) {
      toastManager.warning('No valid features to import');
      return;
    }

    const syncController = AppRegistry.require('syncController');
    const layerManager = AppRegistry.require('layerManager');
    const ch = AppRegistry.require('commandHistory');

    syncController._isImporting = true;
    try {
      const commands = usable.map(spec => new CreateLayerCommand(
        layerManager, spec.layerName, spec.features, spec.type,
        { source: 'csv', importDate: Utils.formatDate(), sheet: spec.layerName }
      ));

      const featureCount = usable.reduce((n, s) => n + s.features.length, 0);
      const description = commands.length === 1
        ? `Create layer "${usable[0].layerName}"`
        : `Import ${commands.length} layers`;

      ch.execute(commands.length === 1 ? commands[0] : new CompositeCommand(commands, description));

      drawerManager.close();
      toastManager.success(commands.length === 1
        ? `Imported ${featureCount} features into "${usable[0].layerName}"`
        : `Imported ${featureCount} features into ${commands.length} layers`);

      const firstId = commands[0].layerId;
      if (commands.length === 1 && firstId) layerManager.fitToLayer(firstId);
      else layerManager.fitToAll();
    } finally {
      syncController._isImporting = false;
      syncController.scheduleSave();
    }
  }
};

AppRegistry.register('importController', ImportController);
