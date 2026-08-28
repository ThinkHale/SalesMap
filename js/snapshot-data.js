// js/snapshot-data.js — SnapshotData
//
// Turns a shared-map snapshot (the object MapShare.createShareLink builds and
// share.html renders) into formats something other than a browser can read:
//
//   • toSummary()     — compact Markdown to paste into an AI assistant
//   • toGeoJSONText() — an RFC 7946 FeatureCollection for QGIS, ArcGIS, Felt…
//
// The share page is a Google Maps canvas fed from Firebase at runtime, so
// anything that can't execute JavaScript — an LLM handed the link, a Slack
// unfurler, a crawler — receives an empty shell. These give the user something
// to paste instead of a link that reads as blank.
//
// Dependency-free apart from two globals the live app and the share page both
// already load: `wellknown` (WKT parsing) and PropertyService.

const SnapshotData = {

  EARTH_RADIUS_M: 6378137,
  SQ_METERS_PER_SQ_MILE: 2589988.110336,

  // Beyond this many rows a layer reports distributions instead of every row —
  // a 5,000-feature paste helps nobody. The GeoJSON always carries everything.
  MAX_ROWS_PER_LAYER: 100,

  // ─── Geometry ──────────────────────────────────────────────────────────────

  _parseWkt(wkt) {
    if (typeof wellknown === 'undefined') return null;
    try { return wellknown.parse(wkt); } catch (e) { return null; }
  },

  // What a feature contributes as GeoJSON: its WKT when it has one, otherwise a
  // Point from its latitude/longitude columns. Mirrors how the map renders it.
  geometryFor(feature) {
    if (!feature) return null;
    if (feature.wkt && String(feature.wkt).trim()) return this._parseWkt(feature.wkt);
    const lat = parseFloat(feature.latitude);
    const lng = parseFloat(feature.longitude);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { type: 'Point', coordinates: [lng, lat] };
  },

  // Every [lng, lat] pair in a geometry, whatever its nesting depth.
  coordinatesOf(geometry) {
    const out = [];
    const walk = node => {
      if (!Array.isArray(node)) return;
      if (typeof node[0] === 'number' && typeof node[1] === 'number') { out.push(node); return; }
      node.forEach(walk);
    };
    if (geometry) walk(geometry.coordinates);
    return out;
  },

  bounds(coords) {
    if (!coords || !coords.length) return null;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    coords.forEach(c => {
      if (c[1] < minLat) minLat = c[1];
      if (c[1] > maxLat) maxLat = c[1];
      if (c[0] < minLng) minLng = c[0];
      if (c[0] > maxLng) maxLng = c[0];
    });
    return {
      minLat, maxLat, minLng, maxLng,
      centerLat: (minLat + maxLat) / 2,
      centerLng: (minLng + maxLng) / 2
    };
  },

  _toRad(deg) { return deg * Math.PI / 180; },

  // Spherical ring area (the standard GeoJSON area algorithm). The sign is
  // discarded, so ring winding order doesn't matter.
  _ringAreaSqM(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return 0;
    let total = 0;
    for (let i = 0; i < ring.length; i++) {
      const p1 = ring[i];
      const p2 = ring[(i + 1) % ring.length];
      if (!Array.isArray(p1) || !Array.isArray(p2)) continue;
      total += this._toRad(p2[0] - p1[0]) *
        (2 + Math.sin(this._toRad(p1[1])) + Math.sin(this._toRad(p2[1])));
    }
    return Math.abs(total * this.EARTH_RADIUS_M * this.EARTH_RADIUS_M / 2);
  },

  // Square miles, with holes subtracted. Points and lines enclose nothing.
  areaSqMiles(geometry) {
    if (!geometry) return 0;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon' ? geometry.coordinates
      : [];
    let sqm = 0;
    polygons.forEach(rings => {
      (rings || []).forEach((ring, i) => {
        const ringArea = this._ringAreaSqM(ring);
        sqm += i === 0 ? ringArea : -ringArea;
      });
    });
    return Math.max(0, sqm) / this.SQ_METERS_PER_SQ_MILE;
  },

  // ─── Properties ────────────────────────────────────────────────────────────

  _isSystem(key) {
    if (typeof PropertyService !== 'undefined' && PropertyService.isSystemProperty) {
      return PropertyService.isSystemProperty(key);
    }
    return /^(id|layerid|wkt|latitude|longitude|importedat|source)$/i.test(key) ||
      String(key).charAt(0) === '_';
  },

  _isBlank(v) {
    return v === null || v === undefined || v === '';
  },

  // A property with more than this many distinct values stops reading as a
  // grouping and starts reading as a list, so its distribution is left out.
  MAX_BREAKDOWN_VALUES: 20,

  // { name, count, unique } for every reportable property. `name` is excluded
  // because it always leads the table on its own.
  describeProperties(features) {
    const seen = new Map();
    (features || []).forEach(f => {
      if (!f) return;
      Object.keys(f).forEach(key => {
        if (key === 'name' || this._isSystem(key)) return;
        if (this._isBlank(f[key])) return;
        let rec = seen.get(key);
        if (!rec) { rec = { name: key, count: 0, values: new Set() }; seen.set(key, rec); }
        rec.count++;
        rec.values.add(String(f[key]));
      });
    });
    const descriptors = [...seen.values()].map(r => ({ name: r.name, count: r.count, unique: r.values.size }));

    // PropertyService already encodes which fields a user cares about (tier and
    // bdm ahead of description, single-valued fields last); reuse it so the
    // table's leading columns are the ones worth reading.
    if (typeof PropertyService !== 'undefined' && PropertyService.sortProperties) {
      return PropertyService.sortProperties(descriptors);
    }
    return descriptors.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  },

  propertyNames(features, limit) {
    return this.describeProperties(features).slice(0, limit || 8).map(d => d.name);
  },

  // "2 (5), 1 (1), 3 (1)" — how a property's values are distributed. Returns ''
  // when the values don't actually group (one distinct value per feature, as with
  // an ID column), where a breakdown would just restate the table.
  valueBreakdown(features, property, limit) {
    const counts = new Map();
    (features || []).forEach(f => {
      const raw = f && f[property];
      if (this._isBlank(raw)) return;
      const key = String(raw);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    if (!counts.size) return '';
    const populated = [...counts.values()].reduce((a, b) => a + b, 0);
    if (counts.size === populated || counts.size > this.MAX_BREAKDOWN_VALUES) return '';

    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const shown = sorted.slice(0, limit || 12);
    const rest = sorted.length - shown.length;
    const text = shown.map(e => `${e[0]} (${e[1]})`).join(', ');
    return rest > 0 ? `${text}, +${rest} more` : text;
  },

  // ─── GeoJSON ───────────────────────────────────────────────────────────────

  toGeoJSON(snapshot) {
    const layers = (snapshot && snapshot.layers) || [];
    const features = [];

    layers.forEach(layer => {
      (layer.features || []).forEach(f => {
        // A null geometry is valid GeoJSON (RFC 7946 §3.2) and every GIS tool
        // reads it, so a feature that can't be mapped still keeps its data
        // instead of vanishing from the export.
        const geometry = this.geometryFor(f);
        // Layer identity first so a reader can group by territory set.
        const properties = { layer: layer.name || '' };
        Object.keys(f).forEach(key => {
          if (key === 'wkt' || this._isSystem(key)) return;
          if (this._isBlank(f[key])) return;
          properties[key] = f[key];
        });
        features.push({ type: 'Feature', geometry: geometry || null, properties });
      });
    });

    return {
      type: 'FeatureCollection',
      // Foreign members are permitted (RFC 7946 §6.1) and save a reader from
      // guessing where the file came from.
      source: 'SalesMap',
      sharedAt: (snapshot && snapshot.createdAt) || null,
      features
    };
  },

  toGeoJSONText(snapshot) {
    // Indented for a human skimming it, but with each [lng, lat] pair collapsed
    // onto one line — fully indenting coordinates triples the size of exactly
    // the part nobody reads, and that size is paste budget.
    return JSON.stringify(this.toGeoJSON(snapshot), null, 2)
      .replace(/\[\s*\n\s*(-?[\d.eE+]+),\s*\n\s*(-?[\d.eE+]+)\s*\n\s*\]/g, '[$1, $2]');
  },

  // ─── Markdown summary ──────────────────────────────────────────────────────

  _round(n, decimals) {
    if (!isFinite(n)) return '–';
    return n.toLocaleString(undefined, { maximumFractionDigits: decimals == null ? 0 : decimals });
  },

  _latLng(lat, lng) {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  },

  _extent(b) {
    return `${b.minLat.toFixed(3)}–${b.maxLat.toFixed(3)} lat, ` +
           `${b.minLng.toFixed(3)}–${b.maxLng.toFixed(3)} lng`;
  },

  // Table cells must not carry pipes or newlines through into the Markdown.
  _cell(value) {
    return String(value == null ? '' : value)
      .replace(/\|/g, '\\|')
      .replace(/\s*[\r\n]+\s*/g, ' ')
      .trim();
  },

  _describeFeature(feature) {
    const geometry = this.geometryFor(feature);
    const coords = this.coordinatesOf(geometry);
    return {
      feature,
      geometry,
      bounds: this.bounds(coords),
      areaSqMi: this.areaSqMiles(geometry),
      kind: !geometry ? 'no geometry'
        : /Polygon$/.test(geometry.type) ? 'polygon'
        : /Point$/.test(geometry.type) ? 'point'
        : 'line'
    };
  },

  toSummary(snapshot) {
    const snap = snapshot || {};
    const layers = snap.layers || [];
    const out = [];

    const described = layers.map(layer => ({
      layer,
      rows: (layer.features || []).map(f => this._describeFeature(f))
    }));

    const all = described.reduce((acc, d) => acc.concat(d.rows), []);
    const allCoords = all.reduce((acc, r) => acc.concat(this.coordinatesOf(r.geometry)), []);
    const overall = this.bounds(allCoords);
    const tally = kind => all.filter(r => r.kind === kind).length;
    const counts = {
      polygon: tally('polygon'),
      point: tally('point'),
      line: tally('line'),
      none: tally('no geometry')
    };

    out.push('# SalesMap — shared territory snapshot');
    if (snap.createdAt) {
      const d = new Date(snap.createdAt);
      out.push(`Shared: ${isNaN(d.getTime()) ? snap.createdAt : d.toLocaleString()}`);
    }
    const mix = [
      counts.polygon ? `${counts.polygon} polygon` : null,
      counts.point ? `${counts.point} point` : null,
      counts.line ? `${counts.line} line` : null,
      counts.none ? `${counts.none} without geometry` : null
    ].filter(Boolean).join(', ');
    out.push(`${layers.length} layer${layers.length === 1 ? '' : 's'} · ` +
             `${all.length} feature${all.length === 1 ? '' : 's'}${mix ? ` (${mix})` : ''}`);
    if (overall) {
      out.push(`Extent: ${this._extent(overall)}`);
      out.push(`Center: ${this._latLng(overall.centerLat, overall.centerLng)}`);
    }
    const totalArea = all.reduce((sum, r) => sum + r.areaSqMi, 0);
    if (totalArea > 0) out.push(`Total area: ~${this._round(totalArea)} sq mi`);

    described.forEach(({ layer, rows }, index) => {
      const features = layer.features || [];
      out.push('');
      out.push(`## ${index + 1}. ${layer.name || 'Untitled layer'}`);

      const meta = [`${rows.length} feature${rows.length === 1 ? '' : 's'}`];
      if (layer.visible === false) meta.push('hidden by default');
      if (typeof PropertyService !== 'undefined' &&
          PropertyService.isRule && PropertyService.isRule(layer.styleRule)) {
        meta.push(`colored by ${layer.styleRule.property} (${layer.styleRule.mode})`);
      }
      out.push(meta.join(' · '));

      const layerCoords = rows.reduce((acc, r) => acc.concat(this.coordinatesOf(r.geometry)), []);
      const layerBounds = this.bounds(layerCoords);
      if (layerBounds) {
        out.push(`Extent: ${this._extent(layerBounds)} · ` +
                 `center ${this._latLng(layerBounds.centerLat, layerBounds.centerLng)}`);
      }
      const layerArea = rows.reduce((sum, r) => sum + r.areaSqMi, 0);
      if (layerArea > 0) out.push(`Area: ~${this._round(layerArea)} sq mi`);

      const props = this.propertyNames(features, 8);
      props.forEach(prop => {
        const breakdown = this.valueBreakdown(features, prop);
        if (breakdown) out.push(`${prop}: ${breakdown}`);
      });

      if (!rows.length) return;

      const hasArea = layerArea > 0;
      const header = ['Name'].concat(props);
      if (hasArea) header.push('sq mi');
      header.push('center');

      out.push('');
      out.push(`| ${header.join(' | ')} |`);
      out.push(`|${header.map(() => '---').join('|')}|`);

      rows.slice(0, this.MAX_ROWS_PER_LAYER).forEach(r => {
        const cells = [this._cell(r.feature.name || '(unnamed)')];
        props.forEach(prop => cells.push(this._cell(r.feature[prop])));
        if (hasArea) cells.push(r.areaSqMi > 0 ? this._round(r.areaSqMi) : '');
        cells.push(r.bounds ? this._latLng(r.bounds.centerLat, r.bounds.centerLng) : '');
        out.push(`| ${cells.join(' | ')} |`);
      });

      const hidden = rows.length - this.MAX_ROWS_PER_LAYER;
      if (hidden > 0) {
        out.push('');
        out.push(`…and ${hidden} more feature${hidden === 1 ? '' : 's'} — ` +
                 'copy the GeoJSON instead for the complete set.');
      }
    });

    out.push('');
    out.push('Areas are approximate (spherical, from the mapped boundaries). ' +
             'Coordinates are WGS84 decimal degrees.');
    return out.join('\n');
  }
};

if (typeof AppRegistry !== 'undefined' && AppRegistry && typeof AppRegistry.register === 'function') {
  AppRegistry.register('snapshotData', SnapshotData);
}
