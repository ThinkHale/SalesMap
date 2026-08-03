// js/property-service.js — PropertyService
//
// Shared helpers for working with arbitrary feature properties (including custom
// spreadsheet columns like "tenure" or "pay rate"):
//   • discovery/classification of the properties present on a feature set
//   • "smart" grouping of numeric values into readable ranges (0–100K, 100K–250K…)
//   • style rules that turn any property value into a color
//
// Deliberately dependency-free (no Utils, no AppConfig) so the live app, the
// share page, and the inlined view-only export can all load this same file and
// color features identically.

const PropertyService = {

  // Properties that describe plumbing rather than data, and are never styled by
  // or shown to the user.
  SYSTEM_PROPERTIES: new Set([
    'id', 'layerid', 'wkt', 'latitude', 'longitude', 'importedat', 'source',
    'istextlabel', '_rowindex', '_errors', '_geocodeconfidence', '_formattedaddress'
  ]),

  // Value→color presets so the familiar tier colors survive when a user styles by
  // "tier" (mirrors AppConfig.colors.tierMap, duplicated to stay dependency-free).
  PRESET_COLORS: {
    '1': '#107c10', 'tier 1': '#107c10',
    '2': '#ffb900', 'tier 2': '#ffb900',
    '3': '#d13438', 'tier 3': '#d13438'
  },

  CATEGORICAL_PALETTE: [
    '#0078d4', '#d13438', '#107c10', '#ffb900', '#8764b8',
    '#00b7c3', '#f7630c', '#ca5010', '#038387', '#486860',
    '#e3008c', '#498205'
  ],

  // 3-stop ramps interpolated to however many groups the user asks for.
  SEQUENTIAL_PALETTES: {
    blue:    ['#deebf7', '#4292c6', '#08306b'],
    green:   ['#e5f5e0', '#41ab5d', '#00441b'],
    red:     ['#fee0d2', '#ef3b2c', '#67000d'],
    orange:  ['#fee6ce', '#f16913', '#7f2704'],
    purple:  ['#efedf5', '#807dba', '#3f007d'],
    teal:    ['#e0f3f3', '#3690a0', '#014636'],
    viridis: ['#440154', '#21908c', '#fde725'],
    warmcool: ['#2c7bb6', '#ffffbf', '#d7191c']
  },

  OTHER_COLOR: '#c8c6c4',
  NO_VALUE_COLOR: '#d6d6d6',

  // Canonical fields users most often style by, ranked ahead of everything else.
  PRIORITY_PROPERTIES: ['tier', 'revenue', 'territory', 'bdm', 'state', 'region', 'county', 'city'],

  // Free-text fields that are almost never useful to style by, ranked last.
  DEPRIORITIZED_PROPERTIES: ['name', 'description', 'street', 'address', 'zipcode', 'notes'],

  // ─── Primitives ────────────────────────────────────────────────────────────

  parseNum(val) {
    if (val === null || val === undefined || val === '') return NaN;
    if (typeof val === 'number') return isFinite(val) ? val : NaN;
    // Tolerate spreadsheet formatting: "$1,250,000", "1 200", "45%".
    const n = Number(String(val).replace(/[,$\s%]/g, ''));
    return isFinite(n) ? n : NaN;
  },

  // Make a spreadsheet column name usable as a feature property. Firebase
  // rejects keys containing ". $ # [ ] /", and features are persisted with their
  // property names as keys — so an unsanitized column like "Pay Rate ($/hr)"
  // would make the entire workspace unsavable.
  sanitizeKey(name) {
    const cleaned = String(name == null ? '' : name)
      .replace(/[.$#[\]]/g, '')
      .replace(/\//g, '-')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || 'field';
  },

  isSystemProperty(name) {
    return this.SYSTEM_PROPERTIES.has(String(name).toLowerCase()) || String(name).startsWith('_');
  },

  isBlank(val) {
    return val === null || val === undefined || val === '' ||
      (typeof val === 'number' && !isFinite(val));
  },

  // Compact, human-readable number for legends and range labels. `decimals`
  // forces a precision — used to keep neighbouring range boundaries distinct
  // (see _labelBins); omit it for the most readable default.
  formatCompact(n, decimals) {
    if (!isFinite(n)) return '–';
    const abs = Math.abs(n);

    // Under 10K, exact digits read better than a scaled "1.2K".
    if (abs < 1e4) {
      if (Number.isInteger(n)) return n.toLocaleString();
      const d = decimals !== undefined ? decimals : 2;
      return this._trimZeros(n.toFixed(d));
    }

    const units = [[1e3, 'K'], [1e6, 'M'], [1e9, 'B']];
    let i = abs >= 1e9 ? 2 : abs >= 1e6 ? 1 : 0;
    for (;;) {
      const [scale, suffix] = units[i];
      const scaled = n / scale;
      const d = decimals !== undefined ? decimals : (Math.abs(scaled) >= 100 ? 0 : 1);
      const rounded = Number(scaled.toFixed(d));
      // Rounding can reach the next unit — promote so 999,999 reads "1M", not "1000K".
      if (Math.abs(rounded) >= 1000 && i < units.length - 1) { i++; continue; }
      return this._trimZeros(rounded.toFixed(d)) + suffix;
    }
  },

  _trimZeros(str) {
    return str.indexOf('.') === -1 ? str : str.replace(/\.?0+$/, '');
  },

  // ─── Color math ────────────────────────────────────────────────────────────

  _hexToRgb(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  },

  _rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  },

  // Sample a multi-stop ramp at t ∈ [0,1].
  colorAt(t, stops) {
    const ramp = (stops && stops.length >= 2) ? stops : this.SEQUENTIAL_PALETTES.blue;
    const clamped = Math.max(0, Math.min(1, isFinite(t) ? t : 0));
    const seg = 1 / (ramp.length - 1);
    const i = Math.min(ramp.length - 2, Math.floor(clamped / seg));
    const local = seg === 0 ? 0 : (clamped - i * seg) / seg;
    const a = this._hexToRgb(ramp[i]);
    const b = this._hexToRgb(ramp[i + 1]);
    return this._rgbToHex(
      a[0] + (b[0] - a[0]) * local,
      a[1] + (b[1] - a[1]) * local,
      a[2] + (b[2] - a[2]) * local
    );
  },

  paletteStops(name) {
    return this.SEQUENTIAL_PALETTES[name] || this.SEQUENTIAL_PALETTES.blue;
  },

  // ─── Property discovery ────────────────────────────────────────────────────

  // Returns one descriptor per property found across `features`:
  //   { name, count, coverage, unique, numericRatio, type, suggestedMode,
  //     min, max, values: [[value, count], …], numbers: [..] }
  collectProperties(features, opts = {}) {
    const list = Array.isArray(features) ? features : [];
    const total = list.length;
    const includeSystem = !!opts.includeSystem;
    const acc = new Map();

    list.forEach(f => {
      if (!f) return;
      Object.keys(f).forEach(key => {
        if (!includeSystem && this.isSystemProperty(key)) return;
        const val = f[key];
        if (this.isBlank(val)) return;
        let rec = acc.get(key);
        if (!rec) {
          rec = this._newRecord(key);
          acc.set(key, rec);
        }
        this._accumulate(rec, val);
      });
    });

    const descriptors = [...acc.values()].map(rec => this._finalize(rec, total));
    return this.sortProperties(descriptors);
  },

  // Describes a single property without indexing all the others — styling calls
  // this on every change, so it stays O(features) rather than O(features × columns).
  describeProperty(features, name) {
    if (!name) return null;
    const list = Array.isArray(features) ? features : [];
    const rec = this._newRecord(name);
    list.forEach(f => {
      if (!f) return;
      const val = f[name];
      if (this.isBlank(val)) return;
      this._accumulate(rec, val);
    });
    return rec.count > 0 ? this._finalize(rec, list.length) : null;
  },

  _newRecord(name) {
    return { name, count: 0, numeric: 0, values: new Map(), numbers: [], min: Infinity, max: -Infinity, allInts: true };
  },

  _accumulate(rec, val) {
    rec.count++;
    const n = this.parseNum(val);
    if (!isNaN(n)) {
      rec.numeric++;
      rec.numbers.push(n);
      if (n < rec.min) rec.min = n;
      if (n > rec.max) rec.max = n;
      if (!Number.isInteger(n)) rec.allInts = false;
    }
    const key = String(val);
    rec.values.set(key, (rec.values.get(key) || 0) + 1);
  },

  _finalize(rec, total) {
    const numericRatio = rec.count > 0 ? rec.numeric / rec.count : 0;
    const unique = rec.values.size;
    // Mostly-numeric with real spread reads as a measure; anything else reads as
    // a category. Few distinct numbers (e.g. tier 1/2/3) stay categorical.
    const type = (numericRatio >= 0.8 && unique > 6) ? 'numeric' : 'categorical';
    return {
      name: rec.name,
      count: rec.count,
      coverage: total > 0 ? rec.count / total : 0,
      unique,
      numericRatio,
      type,
      suggestedMode: type === 'numeric' ? 'range' : 'categorical',
      isInteger: rec.allInts,
      min: rec.numeric > 0 ? rec.min : null,
      max: rec.numeric > 0 ? rec.max : null,
      numbers: rec.numbers,
      // Most common first — the order categorical legends use.
      values: [...rec.values.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    };
  },

  sortProperties(descriptors) {
    const rank = d => {
      const lower = d.name.toLowerCase();
      const pri = this.PRIORITY_PROPERTIES.indexOf(lower);
      if (pri !== -1) return pri;
      if (this.DEPRIORITIZED_PROPERTIES.includes(lower)) return 900;
      // Fields with only one distinct value can't differentiate anything.
      if (d.unique < 2) return 800;
      return 100;
    };
    return [...descriptors].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  },

  // ─── Smart grouping ────────────────────────────────────────────────────────

  // Round a raw interval up to a human-friendly step: 1, 2, 2.5, 5, 10 × 10ⁿ.
  niceStep(raw) {
    if (!isFinite(raw) || raw <= 0) return 1;
    const exp = Math.floor(Math.log10(raw));
    const magnitude = Math.pow(10, exp);
    const frac = raw / magnitude;
    const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
    return nice * magnitude;
  },

  // Next step down the 1 / 2 / 2.5 / 5 / 10 ladder (100K → 50K → 25K → 20K …).
  _prevNiceStep(step) {
    if (!isFinite(step) || step <= 0) return 0;
    const magnitude = Math.pow(10, Math.floor(Math.log10(step)));
    const frac = step / magnitude;
    const ladder = [1, 2, 2.5, 5, 10];
    for (let i = ladder.length - 1; i >= 0; i--) {
      if (ladder[i] < frac - 1e-9) return ladder[i] * magnitude;
    }
    return 0.5 * magnitude;
  },

  _nextNiceStep(step) {
    const exp = Math.floor(Math.log10(step));
    const magnitude = Math.pow(10, exp);
    const frac = Math.round((step / magnitude) * 10) / 10;
    const ladder = [1, 2, 2.5, 5, 10];
    const next = ladder.find(v => v > frac + 1e-9);
    return next ? next * magnitude : step * 2;
  },

  // Group numeric values into ranges. Methods:
  //   'smart'    — round steps (0–100K, 100K–250K…), falling back to quantiles
  //                when round steps would leave most groups empty or lumped
  //   'equal'    — equal-width groups across the exact min/max
  //   'quantile' — equal-count groups (good for skewed data)
  // Returns [{ min, max, label }] with half-open ranges except the last, which
  // includes its max.
  suggestBins(values, opts = {}) {
    const count = Math.max(2, Math.min(parseInt(opts.count, 10) || 5, 12));
    const method = opts.method || 'smart';
    const nums = (values || []).map(v => this.parseNum(v)).filter(n => !isNaN(n)).sort((a, b) => a - b);
    if (nums.length === 0) return [];

    const min = nums[0], max = nums[nums.length - 1];
    if (min === max) {
      return [{ min, max, label: this.formatCompact(min) }];
    }

    if (method === 'equal') return this._labelBins(this._equalBins(min, max, count), nums);
    if (method === 'quantile') return this._labelBins(this._quantileBins(nums, count, false), nums);

    const nice = this._niceBins(nums, count);
    const stats = this._binStats(nice, nums);
    // Round steps look great on evenly spread data but collapse on skewed data
    // (e.g. one huge account swamping the range). Detect that and switch to
    // equal-count groups, preferring snapped boundaries but accepting exact ones
    // when snapping would merge the groups back together.
    if (stats.emptyRatio > 0.34 || stats.maxShare > 0.7) {
      const snapped = this._quantileBins(nums, count, true);
      if (snapped.length >= 3) return this._labelBins(snapped, nums);
      const exact = this._quantileBins(nums, count, false);
      if (exact.length >= 3) return this._labelBins(exact, nums);
    }
    return this._labelBins(nice, nums);
  },

  _equalBins(min, max, count) {
    const width = (max - min) / count;
    const bins = [];
    for (let i = 0; i < count; i++) {
      bins.push({ min: min + i * width, max: i === count - 1 ? max : min + (i + 1) * width });
    }
    return bins;
  },

  _niceBins(nums, count) {
    const min = nums[0], max = nums[nums.length - 1];
    const base = this.niceStep((max - min) / count);

    // Snapping the raw interval to the 1 / 2 / 2.5 / 5 / 10 ladder can land well
    // off the requested group count in either direction — rounding 54K up to 100K
    // would turn a request for 9 groups into 5. Try the neighbouring steps too and
    // keep whichever comes closest to what was asked for, preferring the rounder
    // (larger) step on a tie.
    const down1 = this._prevNiceStep(base);
    const candidates = [this._prevNiceStep(down1), down1, base, this._nextNiceStep(base)]
      .filter(step => step > 0)
      .map(step => ({ step, bins: this._binsForStep(min, max, step) }))
      .filter(c => c.bins.length >= 2 && c.bins.length <= 24);

    if (candidates.length === 0) return this._binsForStep(min, max, base);

    let best = candidates[0];
    candidates.forEach(c => {
      const d = Math.abs(c.bins.length - count);
      const bestD = Math.abs(best.bins.length - count);
      if (d < bestD || (d === bestD && c.step > best.step)) best = c;
    });
    return best.bins;
  },

  _binsForStep(min, max, step) {
    const start = Math.floor(min / step) * step;
    const n = Math.max(1, Math.ceil((max - start) / step));
    const bins = [];
    for (let i = 0; i < n; i++) {
      bins.push({ min: start + i * step, max: start + (i + 1) * step });
    }
    // The last group must include the maximum value.
    bins[bins.length - 1].max = Math.max(bins[bins.length - 1].max, max);
    return bins;
  },

  // Round to `sig` significant figures: 2,837 → 2,800; 41,912 → 42,000.
  _roundToSignificant(value, sig) {
    if (!isFinite(value) || value === 0) return 0;
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(value))) - (sig - 1));
    return Math.round(value / magnitude) * magnitude;
  },

  _quantile(sorted, p) {
    if (sorted.length === 1) return sorted[0];
    const pos = (sorted.length - 1) * p;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  },

  _quantileBins(nums, count, roundEdges) {
    const min = nums[0], max = nums[nums.length - 1];
    const edges = [min];
    for (let i = 1; i < count; i++) edges.push(this._quantile(nums, i / count));
    edges.push(max);

    if (roundEdges) {
      // Snap interior boundaries to readable values so the legend reads
      // "12.5K – 40K" rather than "12,437 – 39,912". Rounding to significant
      // figures rather than a shared step keeps boundaries distinct even when one
      // outlier stretches the range across several orders of magnitude.
      for (let i = 1; i < edges.length - 1; i++) {
        const snapped = this._roundToSignificant(edges[i], 2);
        edges[i] = Math.min(max, Math.max(min, snapped));
      }
    }

    const bins = [];
    for (let i = 0; i < edges.length - 1; i++) {
      // Snapping/ties can collapse boundaries — skip zero-width groups.
      if (edges[i + 1] - edges[i] <= 0) continue;
      bins.push({ min: edges[i], max: edges[i + 1] });
    }
    if (bins.length === 0) return [{ min, max }];
    bins[bins.length - 1].max = max;
    return bins;
  },

  _binStats(bins, nums) {
    const counts = new Array(bins.length).fill(0);
    nums.forEach(n => { counts[this.binIndex(bins, n)]++; });
    const empty = counts.filter(c => c === 0).length;
    const maxCount = counts.reduce((m, c) => Math.max(m, c), 0);
    return {
      counts,
      emptyRatio: bins.length ? empty / bins.length : 0,
      maxShare: nums.length ? maxCount / nums.length : 0
    };
  },

  _labelBins(bins, nums) {
    const allInts = nums.every(n => Number.isInteger(n));
    const label = (decimals) => bins.map((bin, i) => ({
      min: bin.min,
      max: bin.max,
      label: this.rangeLabel(bin.min, bin.max, {
        isInteger: allInts, isLast: i === bins.length - 1, decimals
      })
    }));

    // Compact labels lose precision, which can make neighbouring groups read
    // identically ("1.2M – 1.2M" twice). Add digits until the groups are
    // distinguishable, then fall back to exact numbers.
    for (const decimals of [undefined, 1, 2, 3]) {
      const labeled = label(decimals);
      if (new Set(labeled.map(b => b.label)).size === labeled.length) return labeled;
    }
    return bins.map(bin => ({
      min: bin.min,
      max: bin.max,
      label: `${Math.round(bin.min).toLocaleString()} – ${Math.round(bin.max).toLocaleString()}`
    }));
  },

  rangeLabel(min, max, opts = {}) {
    const fmt = v => this.formatCompact(opts.isInteger ? Math.round(v) : v, opts.decimals);
    // Small integer data reads better as "0 – 2 / 3 – 5" than "0 – 3 / 3 – 6".
    // Only applied where values print exactly — above that, rounding erases the
    // difference anyway and subtracting 1 would misreport the boundary.
    const exact = opts.isInteger && Math.abs(max) < 1e4;
    const hi = (exact && !opts.isLast && max - min > 1) ? max - 1 : max;
    return `${fmt(min)} – ${fmt(hi)}`;
  },

  // Which group a value falls into. Values outside the groups clamp to the
  // nearest end so nothing silently loses its color.
  binIndex(bins, n) {
    if (!bins || bins.length === 0) return -1;
    if (n < bins[0].min) return 0;
    for (let i = 0; i < bins.length; i++) {
      const isLast = i === bins.length - 1;
      if (n >= bins[i].min && (isLast ? n <= bins[i].max : n < bins[i].max)) return i;
    }
    return bins.length - 1;
  },

  paintBins(bins, palette) {
    const stops = this.paletteStops(palette);
    const n = bins.length;
    return bins.map((bin, i) => ({
      ...bin,
      color: bin.color || this.colorAt(n === 1 ? 0.5 : i / (n - 1), stops)
    }));
  },

  // Recolor every group from a palette, discarding manual overrides.
  repaintBins(bins, palette) {
    const stops = this.paletteStops(palette);
    const n = bins.length;
    return bins.map((bin, i) => ({
      ...bin,
      color: this.colorAt(n === 1 ? 0.5 : i / (n - 1), stops)
    }));
  },

  // ─── Style rules ───────────────────────────────────────────────────────────

  // Build a ready-to-apply rule for `property`, choosing categories vs ranges
  // from the data unless a mode is forced.
  autoRule(features, property, opts = {}) {
    const desc = this.describeProperty(features, property);
    if (!desc) return null;
    const mode = opts.mode || desc.suggestedMode;
    return mode === 'range'
      ? this.buildRangeRule(desc, opts)
      : this.buildCategoricalRule(desc, opts);
  },

  buildRangeRule(desc, opts = {}) {
    if (!desc || !desc.numbers || desc.numbers.length === 0) return null;
    const method = opts.method || 'smart';
    const palette = opts.palette || 'blue';
    let bins;
    if (Array.isArray(opts.breaks) && opts.breaks.length >= 2) {
      bins = this.binsFromBreaks(opts.breaks, desc);
    } else {
      bins = this.suggestBins(desc.numbers, { count: opts.count, method });
    }
    if (!bins || bins.length === 0) return null;
    return {
      mode: 'range',
      property: desc.name,
      method: Array.isArray(opts.breaks) ? 'manual' : method,
      palette,
      bins: this.paintBins(bins, palette),
      noValueColor: opts.noValueColor || this.NO_VALUE_COLOR,
      applyToClusters: opts.applyToClusters !== false,
      clusterStat: opts.clusterStat === 'max' || opts.clusterStat === 'sum' ? opts.clusterStat : 'avg'
    };
  },

  // Turn explicit boundary values ([0, 100000, 250000, 500000]) into groups.
  binsFromBreaks(breaks, desc) {
    const edges = [...new Set(breaks.map(b => this.parseNum(b)).filter(n => !isNaN(n)))].sort((a, b) => a - b);
    if (edges.length < 2) return [];
    const bins = [];
    for (let i = 0; i < edges.length - 1; i++) bins.push({ min: edges[i], max: edges[i + 1] });
    const nums = (desc && desc.numbers) || [];
    // Stretch the outer edges so no value falls outside the declared groups.
    if (nums.length) {
      const min = Math.min(...nums), max = Math.max(...nums);
      bins[0].min = Math.min(bins[0].min, min);
      bins[bins.length - 1].max = Math.max(bins[bins.length - 1].max, max);
    }
    return this._labelBins(bins, nums.length ? nums : edges);
  },

  buildCategoricalRule(desc, opts = {}) {
    if (!desc) return null;
    const maxValues = Math.max(2, Math.min(parseInt(opts.maxValues, 10) || 12, 40));
    const all = desc.values || [];
    const kept = all.slice(0, maxValues);
    const overrides = opts.colors || {};
    return {
      mode: 'categorical',
      property: desc.name,
      // A list of { value, color } pairs rather than a value-keyed object: data
      // values can contain characters Firebase forbids in keys (". $ # [ ] /"),
      // which would make the whole workspace unsavable.
      entries: kept.map(([value], i) => ({
        value: String(value),
        color: overrides[value] ||
          this.PRESET_COLORS[String(value).toLowerCase()] ||
          this.CATEGORICAL_PALETTE[i % this.CATEGORICAL_PALETTE.length]
      })),
      // Values beyond the kept set collapse into one "Other" bucket so even a
      // high-cardinality column produces a usable map and legend.
      groupedCount: Math.max(0, all.length - kept.length),
      otherColor: opts.otherColor || this.OTHER_COLOR,
      noValueColor: opts.noValueColor || this.NO_VALUE_COLOR,
      applyToClusters: opts.applyToClusters !== false
    };
  },

  // Value→color lookup for categorical rules, memoized per rule object. Every
  // edit produces a new rule object, so a stale cache entry is unreachable.
  _lookupCache: new WeakMap(),

  _colorLookup(rule) {
    let map = this._lookupCache.get(rule);
    if (!map) {
      map = new Map((rule.entries || []).map(e => [String(e.value), e.color]));
      this._lookupCache.set(rule, map);
    }
    return map;
  },

  isRule(rule) {
    return !!(rule && rule.property && (rule.mode === 'range' || rule.mode === 'categorical'));
  },

  // An explicit "just use the layer color" rule. A stored object rather than null
  // because Firebase drops null values, which would make a deliberate choice of
  // solid indistinguishable from "never styled" after a reload.
  solidRule() {
    return { mode: 'solid' };
  },

  // The color a single feature should paint, or `fallback` when the rule doesn't
  // apply to it.
  resolveColor(rule, feature, fallback) {
    if (!this.isRule(rule) || !feature) return fallback;
    const raw = feature[rule.property];
    if (this.isBlank(raw)) return rule.noValueColor || this.NO_VALUE_COLOR;

    if (rule.mode === 'range') {
      const n = this.parseNum(raw);
      if (isNaN(n)) return rule.noValueColor || this.NO_VALUE_COLOR;
      const bins = rule.bins || [];
      const idx = this.binIndex(bins, n);
      return (idx >= 0 && bins[idx] && bins[idx].color) || fallback;
    }

    return this._colorLookup(rule).get(String(raw)) || rule.otherColor || this.OTHER_COLOR;
  },

  // The color that represents a group of features — used for cluster pins.
  // Ranges average (or sum/max) the measure; categories take the majority value.
  aggregate(rule, features, fallback) {
    if (!this.isRule(rule) || !features || features.length === 0) {
      return { color: fallback, label: null };
    }

    if (rule.mode === 'range') {
      const nums = features.map(f => this.parseNum(f && f[rule.property])).filter(n => !isNaN(n));
      if (nums.length === 0) return { color: rule.noValueColor || this.NO_VALUE_COLOR, label: null };
      const stat = rule.clusterStat || 'avg';
      let value;
      if (stat === 'sum') value = nums.reduce((a, b) => a + b, 0);
      else if (stat === 'max') value = nums.reduce((a, b) => Math.max(a, b), -Infinity);
      else value = nums.reduce((a, b) => a + b, 0) / nums.length;
      const bins = rule.bins || [];
      const idx = this.binIndex(bins, value);
      return {
        color: (idx >= 0 && bins[idx] && bins[idx].color) || fallback,
        label: idx >= 0 && bins[idx] ? bins[idx].label : null,
        value
      };
    }

    const counts = new Map();
    features.forEach(f => {
      const raw = f && f[rule.property];
      if (this.isBlank(raw)) return;
      const key = String(raw);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    if (counts.size === 0) return { color: rule.noValueColor || this.NO_VALUE_COLOR, label: null };
    let best = null, bestCount = -1;
    counts.forEach((count, key) => {
      if (count > bestCount) { bestCount = count; best = key; }
    });
    return {
      color: this._colorLookup(rule).get(best) || rule.otherColor || this.OTHER_COLOR,
      label: best,
      value: best
    };
  },

  // Legend rows for a rule, with live counts when features are supplied.
  legendItems(rule, features) {
    if (!this.isRule(rule)) return [];
    const list = Array.isArray(features) ? features : [];
    const items = [];
    let blanks = 0;
    let others = 0;

    if (rule.mode === 'range') {
      const bins = rule.bins || [];
      const counts = new Array(bins.length).fill(0);
      list.forEach(f => {
        const raw = f && f[rule.property];
        if (this.isBlank(raw)) { blanks++; return; }
        const n = this.parseNum(raw);
        if (isNaN(n)) { blanks++; return; }
        counts[this.binIndex(bins, n)]++;
      });
      bins.forEach((bin, i) => items.push({
        kind: 'bin', index: i, label: bin.label, color: bin.color,
        count: list.length ? counts[i] : null
      }));
    } else {
      const lookup = this._colorLookup(rule);
      const counts = new Map();
      list.forEach(f => {
        const raw = f && f[rule.property];
        if (this.isBlank(raw)) { blanks++; return; }
        const key = String(raw);
        if (lookup.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
        else others++;
      });
      (rule.entries || []).forEach(({ value, color }) => {
        items.push({
          kind: 'value', value, label: value, color,
          count: list.length ? (counts.get(value) || 0) : null
        });
      });
      if (others > 0 || rule.groupedCount > 0) {
        items.push({
          kind: 'other',
          label: rule.groupedCount > 0 ? `Other (${rule.groupedCount} values)` : 'Other',
          color: rule.otherColor || this.OTHER_COLOR,
          count: list.length ? others : null
        });
      }
    }

    if (blanks > 0) {
      items.push({ kind: 'blank', label: 'No value', color: rule.noValueColor || this.NO_VALUE_COLOR, count: blanks });
    }
    return items;
  },

  ruleSummary(rule) {
    if (!this.isRule(rule)) return 'Solid color';
    if (rule.mode === 'range') return `${rule.property} · ${(rule.bins || []).length} ranges`;
    return `${rule.property} · ${(rule.entries || []).length} categories`;
  }
};

if (typeof AppRegistry !== 'undefined' && AppRegistry && typeof AppRegistry.register === 'function') {
  AppRegistry.register('propertyService', PropertyService);
}
