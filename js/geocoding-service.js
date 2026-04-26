// js/geocoding-service.js — GeocodingService

class GeocodingService {
  constructor() {
    this._geocoder = null;
    this._cancelRequested = false;
  }

  _getGeocoder() {
    if (!this._geocoder) {
      this._geocoder = new google.maps.Geocoder();
    }
    return this._geocoder;
  }

  geocodeAddress(addressString) {
    return new Promise((resolve, reject) => {
      this._getGeocoder().geocode({ address: addressString }, (results, status) => {
        if (status === 'OK' && results && results.length > 0) {
          const result = results[0];
          const location = result.geometry.location;
          const locationType = result.geometry.location_type;
          const confidence = AppConfig.geocoding.confidenceScores[locationType] || 0.3;
          resolve({
            lat: location.lat(),
            lng: location.lng(),
            confidence,
            formattedAddress: result.formatted_address,
            locationType
          });
        } else {
          reject(new Error(`Geocoding failed: ${status} for address "${addressString}"`));
        }
      });
    });
  }

  buildAddress(components) {
    const parts = [
      components.street,
      components.city,
      components.state,
      components.zip
    ].filter(p => p && String(p).trim() !== '');
    return parts.join(', ');
  }

  async geocodeBatch(rows, columnMapping, progressCallback) {
    const geocoded = [];
    const failed = [];
    this._cancelRequested = false;

    for (let i = 0; i < rows.length; i++) {
      if (this._cancelRequested) break;

      const row = rows[i];
      const addressParts = {};

      if (columnMapping.street) addressParts.street = row[columnMapping.street];
      if (columnMapping.city) addressParts.city = row[columnMapping.city];
      if (columnMapping.state) addressParts.state = row[columnMapping.state];
      if (columnMapping.zip || columnMapping.zipCode) {
        addressParts.zip = row[columnMapping.zip || columnMapping.zipCode];
      }

      const addressString = this.buildAddress(addressParts);

      if (!addressString) {
        failed.push({ row, error: 'No address data found in row' });
        if (progressCallback) {
          progressCallback({
            current: i + 1,
            total: rows.length,
            percent: Math.round(((i + 1) / rows.length) * 100)
          });
        }
        continue;
      }

      try {
        const result = await this.geocodeAddress(addressString);
        geocoded.push({ ...row, latitude: result.lat, longitude: result.lng, _geocodeConfidence: result.confidence, _formattedAddress: result.formattedAddress });
      } catch (e) {
        failed.push({ row, error: e.message });
      }

      if (progressCallback) {
        progressCallback({
          current: i + 1,
          total: rows.length,
          percent: Math.round(((i + 1) / rows.length) * 100)
        });
      }

      await Utils.wait(AppConfig.geocoding.delayMs);
    }

    return { geocoded, failed };
  }

  cancelBatch() {
    this._cancelRequested = true;
  }

  searchAddress(query) {
    return new Promise((resolve, reject) => {
      this._getGeocoder().geocode({ address: query }, (results, status) => {
        if (status === 'OK' && results && results.length > 0) {
          const r = results[0];
          resolve({
            lat: r.geometry.location.lat(),
            lng: r.geometry.location.lng(),
            formattedAddress: r.formatted_address,
            bounds: r.geometry.viewport
          });
        } else {
          reject(new Error(`Address not found: ${status}`));
        }
      });
    });
  }

  detectAddressColumns(columns) {
    const lower = columns.map(c => ({ original: c, lower: c.toLowerCase() }));
    const find = (...keywords) => lower.find(c => keywords.some(k => c.lower.includes(k)))?.original;

    return {
      street: find('street', 'address', 'addr'),
      city: find('city'),
      state: find('state', 'province'),
      zip: find('zip', 'postal')
    };
  }
}

const geocodingService = new GeocodingService();
AppRegistry.register('geocodingService', geocodingService);
