// js/csv-parser.js — CSVParser

class CSVParser {
  constructor() {
    this._templates = this._loadTemplates();
  }

  async parseFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    let rawData;

    if (ext === 'csv' || ext === 'txt') {
      rawData = await this._parseCSVFile(file);
    } else if (ext === 'xlsx' || ext === 'xls') {
      rawData = await this._parseExcelFile(file);
    } else {
      throw AppErrorHandler.create(`Unsupported file type: .${ext}`, `Unsupported file type: .${ext}. Please upload a CSV or Excel file.`);
    }

    if (!rawData || rawData.length === 0) {
      throw AppErrorHandler.create('File is empty', 'The file appears to be empty or contains no data rows.');
    }

    const originalColumns = Object.keys(rawData[0] || {});
    const columnMap = this.detectColumnMappings(originalColumns);
    const dataType = this.detectDataType(columnMap);
    const needsGeocoding = dataType === 'address';

    let features = [];
    if (dataType !== 'address') {
      features = this.extractFeatures(rawData, columnMap, dataType);
    }

    return {
      features,
      type: dataType,
      columnMap,
      originalColumns,
      rowCount: rawData.length,
      rawData,
      needsGeocoding
    };
  }

  _parseCSVFile(file) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        complete: results => {
          if (results.errors && results.errors.length > 0) {
            const fatal = results.errors.filter(e => e.type === 'Delimiter');
            if (fatal.length > 0) {
              reject(new Error(`CSV parse error: ${fatal[0].message}`));
              return;
            }
          }
          resolve(results.data);
        },
        error: err => reject(new Error(`CSV parse error: ${err.message}`))
      });
    });
  }

  _parseExcelFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
          resolve(rows);
        } catch (err) {
          reject(new Error(`Excel parse error: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  detectColumnMappings(columns) {
    const supported = AppConfig.csvParser.supportedColumns;
    const colsLower = columns.map(c => ({ original: c, lower: c.toLowerCase().trim() }));
    const result = {};

    for (const [field, aliases] of Object.entries(supported)) {
      const match = colsLower.find(c => aliases.includes(c.lower));
      if (match) result[field] = match.original;
    }

    return result;
  }

  detectDataType(columnMap) {
    if (columnMap.wkt) return 'polygon';
    if (columnMap.latitude && columnMap.longitude) return 'point';
    return 'address';
  }

  // options.customColumns — when provided, only these unmapped columns are kept as
  // custom properties (the import wizard's "Additional fields" allowlist). When
  // omitted, every unmapped column is preserved (backward-compatible default).
  extractFeatures(rows, columnMap, dataType, options = {}) {
    const allow = Array.isArray(options.customColumns) ? new Set(options.customColumns) : null;
    // Geometry fields are handled explicitly below, not as generic string props.
    const geomFields = new Set(['latitude', 'longitude', 'wkt']);

    return rows.map(row => {
      const feature = {
        id: Utils.generateId('feature'),
        importedAt: Utils.formatDate(),
        source: 'csv'
      };

      // Name (always present, even if blank, so the layer menu has something to show).
      feature.name = (columnMap.name && row[columnMap.name] != null) ? String(row[columnMap.name]) : '';

      // Every other mapped known field → its canonical property name (tier, bdm,
      // revenue, territory, state, city, county, zipCode, street, description…).
      for (const [field, col] of Object.entries(columnMap)) {
        if (field === 'name' || geomFields.has(field)) continue;
        if (col == null || row[col] === undefined) continue;
        if (field === 'revenue') {
          const rev = Utils.parseNumber(row[col]);
          feature.revenue = isNaN(rev) ? null : rev;
        } else {
          feature[field] = String(row[col] ?? '');
        }
      }

      if (dataType === 'point' || dataType === 'mixed') {
        if (columnMap.latitude) feature.latitude = parseFloat(row[columnMap.latitude]);
        if (columnMap.longitude) feature.longitude = parseFloat(row[columnMap.longitude]);
      }
      if (dataType === 'polygon') {
        if (columnMap.wkt) feature.wkt = String(row[columnMap.wkt] || '');
      }

      // Preserve unmapped columns as custom properties (subject to the allowlist).
      const systemCols = new Set(Object.values(columnMap));
      for (const [col, val] of Object.entries(row)) {
        if (systemCols.has(col)) continue;
        if (allow && !allow.has(col)) continue;
        feature[col] = val;
      }

      return feature;
    });
  }

  validateData(rows, columnMap, dataType) {
    return validationService.validateCSVData(rows, columnMap, dataType);
  }

  // ─── Column Mapping Templates ──────────────────────────────────────────────

  _loadTemplates() {
    return storageService.get(AppConfig.storage.templateStorageKey) || {};
  }

  loadTemplates() {
    this._templates = this._loadTemplates();
    return this._templates;
  }

  saveTemplate(name, mapping) {
    if (!name || !mapping) return;
    this._templates[name] = {
      name,
      mapping,
      sourceColumns: Object.values(mapping).filter(Boolean),
      savedAt: Utils.formatDate()
    };
    storageService.set(AppConfig.storage.templateStorageKey, this._templates);
  }

  deleteTemplate(name) {
    delete this._templates[name];
    storageService.set(AppConfig.storage.templateStorageKey, this._templates);
  }

  // Returns the first template whose sourceColumns match the given column list
  findMatchingTemplate(columns) {
    const colSet = new Set(columns.map(c => c.toLowerCase().trim()));
    for (const [name, template] of Object.entries(this._templates)) {
      if (!template.sourceColumns || template.sourceColumns.length === 0) continue;
      const templateCols = new Set(template.sourceColumns.map(c => c.toLowerCase().trim()));
      const matches = [...templateCols].filter(c => colSet.has(c)).length;
      if (matches >= Math.min(3, templateCols.size)) {
        return { name, template };
      }
    }
    return null;
  }

  getTemplateNames() {
    return Object.keys(this._templates);
  }
}

const csvParser = new CSVParser();
AppRegistry.register('csvParser', csvParser);
