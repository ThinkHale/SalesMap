// js/utils.js — Utils namespace (pure functions, no side effects)

const Utils = {
  generateId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  },

  generateSaveId() {
    return Utils.generateId('save');
  },

  toCamelCase(str) {
    if (!str) return '';
    return str
      .replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase())
      .replace(/^(.)/, c => c.toLowerCase());
  },

  toSafeId(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  },

  deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Map) {
      const clone = new Map();
      obj.forEach((v, k) => clone.set(k, Utils.deepClone(v)));
      return clone;
    }
    if (obj instanceof Set) {
      const clone = new Set();
      obj.forEach(v => clone.add(Utils.deepClone(v)));
      return clone;
    }
    if (Array.isArray(obj)) return obj.map(item => Utils.deepClone(item));
    const clone = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        clone[key] = Utils.deepClone(obj[key]);
      }
    }
    return clone;
  },

  debounce(fn, wait) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  },

  throttle(fn, limit) {
    let lastCall = 0;
    return function (...args) {
      const now = Date.now();
      if (now - lastCall >= limit) {
        lastCall = now;
        return fn.apply(this, args);
      }
    };
  },

  formatDate(date = new Date()) {
    return (date instanceof Date ? date : new Date(date)).toISOString();
  },

  parseNumber(val) {
    if (val === null || val === undefined || val === '') return NaN;
    const n = Number(String(val).replace(/[,$\s]/g, ''));
    return isNaN(n) ? NaN : n;
  },

  isEmpty(val) {
    if (val === null || val === undefined) return true;
    if (typeof val === 'string') return val.trim() === '';
    if (Array.isArray(val)) return val.length === 0;
    if (val instanceof Map || val instanceof Set) return val.size === 0;
    if (typeof val === 'object') return Object.keys(val).length === 0;
    return false;
  },

  getNestedProperty(obj, dotPath) {
    if (!dotPath) return obj;
    return dotPath.split('.').reduce((acc, key) => {
      return acc !== null && acc !== undefined ? acc[key] : undefined;
    }, obj);
  },

  setNestedProperty(obj, dotPath, value) {
    const keys = dotPath.split('.');
    const last = keys.pop();
    const target = keys.reduce((acc, key) => {
      if (acc[key] === undefined || acc[key] === null || typeof acc[key] !== 'object') {
        acc[key] = {};
      }
      return acc[key];
    }, obj);
    target[last] = value;
  },

  groupBy(arr, key) {
    const map = new Map();
    for (const item of arr) {
      const k = typeof key === 'function' ? key(item) : item[key];
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    }
    return map;
  },

  unique(arr, key) {
    if (!key) return [...new Set(arr)];
    const seen = new Set();
    return arr.filter(item => {
      const k = typeof key === 'function' ? key(item) : item[key];
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  },

  sortBy(arr, key, dir = 'asc') {
    const copy = [...arr];
    copy.sort((a, b) => {
      const av = typeof key === 'function' ? key(a) : a[key];
      const bv = typeof key === 'function' ? key(b) : b[key];
      if (av === bv) return 0;
      const cmp = av < bv ? -1 : 1;
      return dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  },

  filterBySearch(arr, term, keys) {
    if (!term || !term.trim()) return arr;
    const lower = term.toLowerCase().trim();
    return arr.filter(item =>
      keys.some(key => {
        const val = Utils.getNestedProperty(item, key);
        return val !== null && val !== undefined && String(val).toLowerCase().includes(lower);
      })
    );
  },

  percentage(value, total) {
    if (!total || isNaN(total) || total === 0) return 0;
    return Math.round((value / total) * 100 * 10) / 10;
  },

  clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  },

  wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  },

  async retryWithBackoff(fn, maxRetries = 4, baseDelay = 2000) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          await Utils.wait(baseDelay * Math.pow(2, attempt));
        }
      }
    }
    throw lastError;
  },

  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  },

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  createElement(tag, attrs = {}, textContent = '') {
    const el = document.createElement(tag);
    for (const [key, val] of Object.entries(attrs)) {
      if (key === 'className') {
        el.className = val;
      } else if (key === 'style' && typeof val === 'object') {
        Object.assign(el.style, val);
      } else if (key.startsWith('data-')) {
        el.setAttribute(key, val);
      } else if (key === 'disabled' && val) {
        el.disabled = true;
      } else if (key === 'checked' && val) {
        el.checked = true;
      } else if (key === 'selected' && val) {
        el.selected = true;
      } else {
        el.setAttribute(key, val);
      }
    }
    if (textContent) el.textContent = textContent;
    return el;
  },

  formatNumber(num) {
    if (isNaN(num) || num === null || num === undefined) return '–';
    return new Intl.NumberFormat().format(num);
  },

  formatCurrency(num) {
    if (isNaN(num) || num === null || num === undefined) return '–';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
  },

  formatRelativeTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    const diff = Date.now() - d.getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  }
};
