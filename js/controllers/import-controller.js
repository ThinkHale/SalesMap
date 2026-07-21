// js/controllers/import-controller.js — ImportController

const ImportController = {
  _pendingData: null,
  _geocodingCancelled: false,

  // Step 1: File selected → parse → detect → show wizard
  async handleFileSelected(file) {
    const csvParser = AppRegistry.require('csvParser');
    loadingManager.show('Reading file...');
    try {
      this._pendingData = await csvParser.parseFile(file);
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
      const originalColumns = Object.keys(rawData[0] || {});
      const columnMap = csvParser.detectColumnMappings(originalColumns);
      const dataType = csvParser.detectDataType(columnMap);

      this._pendingData = {
        features: dataType !== 'address' ? csvParser.extractFeatures(rawData, columnMap, dataType) : [],
        type: dataType,
        columnMap,
        originalColumns,
        rowCount: rawData.length,
        rawData,
        needsGeocoding: dataType === 'address'
      };
      loadingManager.hide();
      this._showImportWizard();
    } catch (err) {
      loadingManager.hide();
      AppErrorHandler.handle(err, 'ImportController.handlePastedText');
    }
  },

  _showImportWizard() {
    const d = this._pendingData;
    drawerManager.open((body) => {
      this._renderWizardStep1(body, d);
    }, `Import Data — ${d.rowCount} rows detected`);
  },

  _renderWizardStep1(body, data) {
    const csvParser = AppRegistry.require('csvParser');

    // Check for matching template
    const templateMatch = csvParser.findMatchingTemplate(data.originalColumns);

    body.innerHTML = '';

    // Template notice
    if (templateMatch) {
      const notice = Utils.createElement('div', { className: 'import-notice' });
      notice.textContent = `Template applied: "${templateMatch.name}"`;
      body.appendChild(notice);
    }

    // Layer name input
    const nameGroup = Utils.createElement('div', { className: 'form-group' });
    const nameLabel = Utils.createElement('label', { className: 'form-label' }, 'Layer Name');
    const nameInput = Utils.createElement('input', { type: 'text', className: 'form-control', id: 'importLayerName' });
    nameInput.value = data.rawData.length > 0 && data.rawData[0].territory
      ? String(data.rawData[0].territory)
      : `Import ${new Date().toLocaleDateString()}`;
    nameGroup.appendChild(nameLabel);
    nameGroup.appendChild(nameInput);
    body.appendChild(nameGroup);

    const currentMapping = templateMatch ? { ...data.columnMap, ...templateMatch.template.mapping } : { ...data.columnMap };

    // Feature name field — prominent, since it labels every feature in the layer menu.
    const nameFieldGroup = Utils.createElement('div', { className: 'form-group' });
    nameFieldGroup.appendChild(Utils.createElement('label', { className: 'form-label' }, 'Feature name field'));
    nameFieldGroup.appendChild(Utils.createElement('div', { className: 'import-section-hint' },
      'Which column labels each feature in the layer menu and on the map.'));
    const nameFieldSel = Utils.createElement('select', { className: 'form-control', 'data-field': 'name' });
    nameFieldSel.appendChild(Utils.createElement('option', { value: '' }, '— none (features will be Untitled) —'));
    data.originalColumns.forEach(col => {
      const opt = Utils.createElement('option', { value: col });
      opt.textContent = col;
      if (currentMapping.name === col) opt.selected = true;
      nameFieldSel.appendChild(opt);
    });
    nameFieldGroup.appendChild(nameFieldSel);
    body.appendChild(nameFieldGroup);

    // Column mappings for the remaining known fields (name handled above).
    const colSection = Utils.createElement('div', { className: 'import-col-section' });
    colSection.appendChild(Utils.createElement('div', { className: 'import-section-title' }, 'Column Mapping'));

    const colGrid = Utils.createElement('div', { className: 'column-mapping-grid' });
    const supportedFields = Object.keys(AppConfig.csvParser.supportedColumns).filter(f => f !== 'name');

    supportedFields.forEach(field => {
      const row = Utils.createElement('div', { className: 'col-map-row' });
      const lbl = Utils.createElement('label', { className: 'col-map-label' });
      lbl.textContent = field;
      const sel = Utils.createElement('select', { className: 'form-control form-control-sm', 'data-field': field });
      sel.appendChild(Utils.createElement('option', { value: '' }, '— not mapped —'));
      data.originalColumns.forEach(col => {
        const opt = Utils.createElement('option', { value: col });
        opt.textContent = col;
        if (currentMapping[field] === col) opt.selected = true;
        sel.appendChild(opt);
      });
      row.appendChild(lbl);
      row.appendChild(sel);
      colGrid.appendChild(row);
    });
    colSection.appendChild(colGrid);
    body.appendChild(colSection);

    // Additional fields — any unmapped columns, kept as custom properties the user
    // can sort, filter, and style by (e.g. a "Tenure" column with no built-in field).
    const mappedCols = new Set(Object.values(currentMapping));
    const customCandidates = data.originalColumns.filter(c => !mappedCols.has(c));
    if (customCandidates.length > 0) {
      const customSection = Utils.createElement('div', { className: 'import-col-section' });
      customSection.appendChild(Utils.createElement('div', { className: 'import-section-title' }, 'Additional fields'));
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
      body.appendChild(customSection);
    }

    // Summary
    const summary = Utils.createElement('div', { className: 'import-summary' });
    summary.textContent = `${data.rowCount} rows · ${data.originalColumns.length} columns · Detected type: ${data.type}`;
    body.appendChild(summary);

    // Template save
    const templateRow = Utils.createElement('div', { className: 'template-row' });
    const saveTplBtn = Utils.createElement('button', { className: 'btn btn-secondary btn-sm' }, 'Save as Template');
    saveTplBtn.addEventListener('click', () => {
      const name = prompt('Template name:');
      if (name) {
        const mapping = this._readColumnMapping(body);
        csvParser.saveTemplate(name, mapping);
        toastManager.success(`Template "${name}" saved`);
      }
    });
    templateRow.appendChild(saveTplBtn);
    body.appendChild(templateRow);

    // Next button
    const nextBtn = Utils.createElement('button', { className: 'btn btn-primary import-next-btn' }, 'Validate & Continue →');
    nextBtn.addEventListener('click', () => {
      const layerName = nameInput.value.trim() || 'Imported Layer';
      const mapping = this._readColumnMapping(body);
      const customColumns = [...body.querySelectorAll('.import-custom-fields input[data-col]:checked')]
        .map(c => c.getAttribute('data-col'));
      const dataType = AppRegistry.require('csvParser').detectDataType(mapping);
      const validation = AppRegistry.require('csvParser').validateData(data.rawData, mapping, dataType);
      this._renderWizardStep2(body, validation, { layerName, mapping, dataType, customColumns });
    });
    body.appendChild(nextBtn);
  },

  _readColumnMapping(container) {
    const mapping = {};
    container.querySelectorAll('select[data-field]').forEach(sel => {
      if (sel.value) mapping[sel.getAttribute('data-field')] = sel.value;
    });
    return mapping;
  },

  _renderWizardStep2(body, validation, importConfig) {
    body.innerHTML = '';

    const stepTitle = Utils.createElement('div', { className: 'import-section-title' }, 'Validation Results');
    body.appendChild(stepTitle);

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

    addStat('Total Rows', validation.totalRows);
    addStat('Valid', validation.validCount, 'stat-good');
    addStat('Errors', validation.invalidCount, validation.invalidCount > 0 ? 'stat-bad' : '');
    body.appendChild(statsRow);

    if (validation.invalidCount > 0) {
      const errorSection = Utils.createElement('div', { className: 'error-list-section' });
      const errTitle = Utils.createElement('div', { className: 'error-list-title' });
      errTitle.textContent = `${validation.invalidCount} row(s) will be skipped:`;
      errorSection.appendChild(errTitle);

      const errList = Utils.createElement('div', { className: 'error-list' });
      validation.invalidRows.slice(0, 20).forEach(row => {
        const item = Utils.createElement('div', { className: 'error-item' });
        item.textContent = `Row ${row._rowIndex + 1}: ${(row._errors || []).join('; ')}`;
        errList.appendChild(item);
      });
      if (validation.invalidRows.length > 20) {
        const more = Utils.createElement('div', { className: 'error-more' });
        more.textContent = `... and ${validation.invalidRows.length - 20} more`;
        errList.appendChild(more);
      }
      errorSection.appendChild(errList);
      body.appendChild(errorSection);
    }

    const btnRow = Utils.createElement('div', { className: 'import-btn-row' });

    const backBtn = Utils.createElement('button', { className: 'btn btn-secondary' }, '← Back');
    backBtn.addEventListener('click', () => this._showImportWizard());

    const importBtn = Utils.createElement('button', {
      className: 'btn btn-primary',
      ...(validation.validCount === 0 ? { disabled: 'disabled' } : {})
    }, `Import ${validation.validCount} row(s) →`);

    importBtn.addEventListener('click', () => {
      if (importConfig.dataType === 'address') {
        this._renderWizardStep3(body, importConfig, validation);
      } else {
        const features = AppRegistry.require('csvParser').extractFeatures(
          validation.validRows,
          importConfig.mapping,
          importConfig.dataType,
          { customColumns: importConfig.customColumns }
        );
        this._finishImport(features, importConfig.layerName, importConfig.dataType);
      }
    });

    btnRow.appendChild(backBtn);
    btnRow.appendChild(importBtn);
    body.appendChild(btnRow);
  },

  _renderWizardStep3(body, importConfig, validation) {
    body.innerHTML = '';
    this._geocodingCancelled = false;

    const title = Utils.createElement('div', { className: 'import-section-title' }, 'Geocoding Addresses...');
    body.appendChild(title);

    const progressWrap = Utils.createElement('div', { className: 'geocoding-progress-wrap' });
    const progressBar = Utils.createElement('div', { className: 'geocoding-progress-bar' });
    progressBar.style.width = '0%';
    const progressText = Utils.createElement('div', { className: 'geocoding-progress-text' }, 'Starting...');
    progressWrap.appendChild(progressBar);
    progressWrap.appendChild(progressText);
    body.appendChild(progressWrap);

    const cancelBtn = Utils.createElement('button', { className: 'btn btn-secondary btn-sm' }, 'Cancel');
    cancelBtn.addEventListener('click', () => {
      this._geocodingCancelled = true;
      AppRegistry.require('geocodingService').cancelBatch();
      drawerManager.close();
    });
    body.appendChild(cancelBtn);

    // Start geocoding
    const geocodingService = AppRegistry.require('geocodingService');
    const addressCols = geocodingService.detectAddressColumns(importConfig.mapping ? Object.values(importConfig.mapping) : []);

    geocodingService.geocodeBatch(
      validation.validRows,
      importConfig.mapping || addressCols,
      ({ current, total, percent }) => {
        progressBar.style.width = percent + '%';
        progressText.textContent = `${current} / ${total} (${percent}%)`;
      }
    ).then(({ geocoded, failed }) => {
      if (this._geocodingCancelled) return;
      // Geocoding adds latitude/longitude columns to each row — map them so
      // extractFeatures treats them as the point geometry.
      const geoMapping = { ...importConfig.mapping, latitude: 'latitude', longitude: 'longitude' };
      const features = AppRegistry.require('csvParser').extractFeatures(
        geocoded, geoMapping, 'point', { customColumns: importConfig.customColumns });
      if (failed.length > 0) {
        toastManager.warning(`${failed.length} addresses could not be geocoded and were skipped`);
      }
      this._finishImport(features, importConfig.layerName, 'point');
    }).catch(err => {
      AppErrorHandler.handle(err, 'ImportController.geocodeBatch');
    });
  },

  async _finishImport(features, layerName, type) {
    if (!features || features.length === 0) {
      toastManager.warning('No valid features to import');
      return;
    }

    const syncController = AppRegistry.require('syncController');
    const layerManager = AppRegistry.require('layerManager');
    const ch = AppRegistry.require('commandHistory');

    syncController._isImporting = true;
    try {
      const cmd = new CreateLayerCommand(layerManager, layerName, features, type, {
        source: 'csv',
        importDate: Utils.formatDate()
      });
      ch.execute(cmd);

      drawerManager.close();
      toastManager.success(`Imported ${features.length} features into "${layerName}"`);
      layerManager.fitToLayer(cmd.layerId);
    } finally {
      syncController._isImporting = false;
      syncController.scheduleSave();
    }
  }
};

AppRegistry.register('importController', ImportController);
