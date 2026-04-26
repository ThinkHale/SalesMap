// js/validation-service.js — ValidationService

class ValidationService {
  constructor() {
    this._rules = new Map();
    this._registerBuiltins();
  }

  _registerBuiltins() {
    this.addRule('coordinates', (data) => {
      const errors = [];
      const lat = parseFloat(data.latitude || data.lat);
      const lng = parseFloat(data.longitude || data.lng || data.lon);
      if (isNaN(lat) || lat < -90 || lat > 90) errors.push('Latitude must be between -90 and 90');
      if (isNaN(lng) || lng < -180 || lng > 180) errors.push('Longitude must be between -180 and 180');
      return { valid: errors.length === 0, errors };
    });

    this.addRule('wkt', (data) => {
      const errors = [];
      const wktStr = data.wkt || data.geometry || data;
      if (typeof wktStr !== 'string' || !wktStr.trim()) {
        errors.push('WKT string is empty');
      } else {
        try {
          const parsed = typeof wellknown !== 'undefined' ? wellknown.parse(wktStr) : null;
          if (!parsed) errors.push('Invalid WKT geometry');
        } catch (e) {
          errors.push(`WKT parse error: ${e.message}`);
        }
      }
      return { valid: errors.length === 0, errors };
    });

    this.addRule('feature', (data) => {
      const errors = [];
      if (!data.id) errors.push('Feature missing id');
      const hasPoint = !isNaN(parseFloat(data.latitude)) && !isNaN(parseFloat(data.longitude));
      const hasWkt = data.wkt && typeof data.wkt === 'string' && data.wkt.trim().length > 0;
      if (!hasPoint && !hasWkt) {
        errors.push('Feature must have either lat/lng coordinates or a WKT geometry');
      }
      return { valid: errors.length === 0, errors };
    });

    this.addRule('layer', (data) => {
      const errors = [];
      if (!data.name || String(data.name).trim() === '') errors.push('Layer must have a name');
      if (!['point','polygon','mixed'].includes(data.type)) errors.push(`Invalid layer type: ${data.type}`);
      if (!Array.isArray(data.features)) errors.push('Layer features must be an array');
      return { valid: errors.length === 0, errors };
    });

    this.addRule('email', (data) => {
      const errors = [];
      const email = typeof data === 'string' ? data : data.email;
      const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !re.test(email)) errors.push('Invalid email address');
      return { valid: errors.length === 0, errors };
    });
  }

  addRule(name, fn) {
    this._rules.set(name, fn);
  }

  validate(ruleName, data) {
    const rule = this._rules.get(ruleName);
    if (!rule) return { valid: false, errors: [`Unknown validation rule: ${ruleName}`] };
    try {
      return rule(data);
    } catch (e) {
      return { valid: false, errors: [`Validation error: ${e.message}`] };
    }
  }

  validateBatch(ruleName, items) {
    return items.map((item, index) => {
      const result = this.validate(ruleName, item);
      return { index, item, ...result };
    });
  }

  validateCSVData(rows, columnMap, dataType) {
    const validRows = [];
    const invalidRows = [];

    rows.forEach((row, index) => {
      const errors = [];

      if (dataType === 'point') {
        const latCol = columnMap.latitude;
        const lngCol = columnMap.longitude;
        if (!latCol || !lngCol) {
          errors.push('Missing latitude/longitude column mapping');
        } else {
          const lat = parseFloat(row[latCol]);
          const lng = parseFloat(row[lngCol]);
          if (isNaN(lat) || lat < -90 || lat > 90) errors.push(`Row ${index + 1}: Invalid latitude: ${row[latCol]}`);
          if (isNaN(lng) || lng < -180 || lng > 180) errors.push(`Row ${index + 1}: Invalid longitude: ${row[lngCol]}`);
        }
      } else if (dataType === 'polygon') {
        const wktCol = columnMap.wkt;
        if (!wktCol) {
          errors.push('Missing WKT/geometry column mapping');
        } else if (!row[wktCol] || String(row[wktCol]).trim() === '') {
          errors.push(`Row ${index + 1}: Empty WKT geometry`);
        } else {
          try {
            if (typeof wellknown !== 'undefined') {
              const parsed = wellknown.parse(String(row[wktCol]));
              if (!parsed) errors.push(`Row ${index + 1}: Invalid WKT geometry`);
            }
          } catch (e) {
            errors.push(`Row ${index + 1}: WKT parse error`);
          }
        }
      } else if (dataType === 'address') {
        // Basic check: at least one address field present
        const hasAddress = Object.values(columnMap).some(col =>
          col && row[col] && String(row[col]).trim() !== ''
        );
        if (!hasAddress) errors.push(`Row ${index + 1}: No address data found`);
      }

      if (errors.length === 0) {
        validRows.push({ ...row, _rowIndex: index });
      } else {
        invalidRows.push({ ...row, _rowIndex: index, _errors: errors });
      }
    });

    const errorSummary = invalidRows.length > 0
      ? `${invalidRows.length} of ${rows.length} rows have errors`
      : 'All rows valid';

    return {
      valid: invalidRows.length === 0,
      errors: invalidRows.flatMap(r => r._errors),
      errorSummary,
      validRows,
      invalidRows,
      totalRows: rows.length,
      validCount: validRows.length,
      invalidCount: invalidRows.length
    };
  }
}

const validationService = new ValidationService();
AppRegistry.register('validationService', validationService);
