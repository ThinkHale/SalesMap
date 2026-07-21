// js/plugin-api.js — PluginRegistry + PluginManager

const VALID_PERMISSIONS = new Set([
  'layers.read', 'layers.write',
  'map.read', 'map.write',
  'ui.toast', 'ui.modal',
  'ui.slot:toolbar', 'ui.slot:sidebar-panel', 'ui.slot:context-menu',
  'storage.read', 'storage.write',
  'events.listen', 'events.emit',
  'hooks.register'
]);

// ─── PluginRegistry ────────────────────────────────────────────────────────
class PluginRegistry {
  constructor() {
    this.registry = new Map();
  }

  register(def) {
    this._validateManifest(def);
    this.registry.set(def.id, def);
  }

  async loadFromURL(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load plugin from ${url}`));
      document.head.appendChild(s);
    });
  }

  _validateManifest(def) {
    if (!def.id || !def.name || !def.version) {
      throw AppErrorHandler.create(
        'Plugin missing id, name, or version',
        'Invalid plugin manifest: must have id, name, and version'
      );
    }
    if (!/^[a-z0-9-]+$/.test(def.id)) {
      throw AppErrorHandler.create(
        `Plugin id must be kebab-case: ${def.id}`,
        `Plugin id "${def.id}" must use only lowercase letters, numbers, and hyphens`
      );
    }
    (def.permissions || []).forEach(p => {
      if (!VALID_PERMISSIONS.has(p)) {
        throw AppErrorHandler.create(
          `Unknown permission: ${p}`,
          `Plugin "${def.id}" declared unknown permission: ${p}`
        );
      }
    });
  }

  getDefinition(id) { return this.registry.get(id) || null; }
  getAllDefinitions() { return Array.from(this.registry.values()); }
  has(id) { return this.registry.has(id); }
  unregister(id) { this.registry.delete(id); }
}

// ─── PluginManager ─────────────────────────────────────────────────────────
class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.hooks = new Map();
    this.endpoints = new Map();
    this._uiSlots = { toolbar: [], 'sidebar-panel': [], 'context-menu': [] };
  }

  initialize(pluginId) {
    const registry = AppRegistry.require('pluginRegistry');
    const def = registry.getDefinition(pluginId);
    if (!def) throw new Error(`Plugin definition not found: ${pluginId}`);
    if (this.plugins.has(pluginId)) {
      console.warn(`[PluginManager] Plugin already initialized: ${pluginId}`);
      return;
    }

    const config = this._loadConfig(pluginId, def.configSchema || {});
    const api = this._buildScopedAPI(def, config);

    try {
      if (typeof def.init === 'function') def.init(api);
    } catch (e) {
      AppErrorHandler.handle(e, `PluginManager.init:${pluginId}`);
      return;
    }

    // Register hooks
    if (def.hooks) {
      Object.entries(def.hooks).forEach(([hookName, { handler, priority = 10 }]) => {
        if (!this.hooks.has(hookName)) this.hooks.set(hookName, []);
        this.hooks.get(hookName).push({ pluginId, handler, priority });
        this.hooks.get(hookName).sort((a, b) => a.priority - b.priority);
      });
    }

    // Register endpoints
    if (def.endpoints) {
      Object.entries(def.endpoints).forEach(([name, handler]) => {
        this.endpoints.set(`${pluginId}:${name}`, params => handler(params, api));
      });
    }

    this.plugins.set(pluginId, {
      def, enabled: true, config, api,
      registeredAt: Utils.formatDate()
    });

    eventBus.emit('plugin.initialized', { pluginId });
  }

  enable(pluginId) {
    const p = this.plugins.get(pluginId);
    if (!p) return;
    p.enabled = true;
    this._setPluginUIVisible(pluginId, true);
    try { if (typeof p.def.onEnable === 'function') p.def.onEnable(); } catch (e) { AppErrorHandler.handle(e, `plugin.onEnable:${pluginId}`); }
    eventBus.emit('plugin.enabled', { pluginId });
  }

  disable(pluginId) {
    const p = this.plugins.get(pluginId);
    if (!p) return;
    p.enabled = false;
    try { if (typeof p.def.onDisable === 'function') p.def.onDisable(); } catch (e) { AppErrorHandler.handle(e, `plugin.onDisable:${pluginId}`); }
    this._setPluginUIVisible(pluginId, false);
    eventBus.emit('plugin.disabled', { pluginId });
  }

  // Show/hide every UI-slot element (toolbar button, sidebar panel, menu item)
  // a plugin contributed, so a disabled plugin leaves no orphaned controls.
  _setPluginUIVisible(pluginId, visible) {
    Object.keys(this._uiSlots).forEach(slot => {
      this._uiSlots[slot].forEach(item => {
        if (item.pluginId === pluginId && item.element) {
          item.element.style.display = visible ? '' : 'none';
        }
      });
    });
  }

  destroy(pluginId) {
    const p = this.plugins.get(pluginId);
    if (!p) return;
    try { if (typeof p.def.destroy === 'function') p.def.destroy(); } catch (e) { console.error(`[PluginManager] destroy error:`, e); }

    this.hooks.forEach((handlers, hookName) => {
      this.hooks.set(hookName, handlers.filter(h => h.pluginId !== pluginId));
    });
    [...this.endpoints.keys()].filter(k => k.startsWith(`${pluginId}:`)).forEach(k => this.endpoints.delete(k));
    Object.keys(this._uiSlots).forEach(slot => {
      this._uiSlots[slot] = this._uiSlots[slot].filter(item => item.pluginId !== pluginId);
    });
    this.plugins.delete(pluginId);
    eventBus.emit('plugin.destroyed', { pluginId });
  }

  async executeHook(hookName, data) {
    if (!this.hooks.has(hookName)) return data;
    let result = data;
    for (const { pluginId, handler } of this.hooks.get(hookName)) {
      const p = this.plugins.get(pluginId);
      if (!p || !p.enabled) continue;
      try {
        const ret = await handler(result, { pluginId, hookName });
        if (ret !== undefined) result = ret;
      } catch (e) {
        console.error(`[Plugin hook error] ${hookName} in ${pluginId}:`, e);
        // Error isolation: hook failure never stops the pipeline
      }
    }
    return result;
  }

  async callEndpoint(namespacedEndpoint, params = {}) {
    const handler = this.endpoints.get(namespacedEndpoint);
    if (!handler) throw new Error(`Endpoint not found: ${namespacedEndpoint}`);
    const [pluginId] = namespacedEndpoint.split(':');
    const p = this.plugins.get(pluginId);
    if (!p || !p.enabled) throw new Error(`Plugin ${pluginId} is not enabled`);
    return await handler(params);
  }

  getStatus(pluginId) {
    return this.plugins.get(pluginId) || null;
  }

  getAllStatus() {
    return Array.from(this.plugins.entries()).map(([id, p]) => ({
      id,
      name: p.def.name,
      version: p.def.version,
      enabled: p.enabled,
      registeredAt: p.registeredAt
    }));
  }

  _loadConfig(pluginId, schema) {
    const defaults = {};
    Object.entries(schema).forEach(([k, v]) => { defaults[k] = v.default !== undefined ? v.default : null; });
    const stored = storageService.get(`${AppConfig.storage.pluginConfigPrefix}${pluginId}`);
    return Object.assign({}, defaults, stored || {});
  }

  _saveConfig(pluginId, config) {
    storageService.set(`${AppConfig.storage.pluginConfigPrefix}${pluginId}`, config);
  }

  _buildScopedAPI(def, config) {
    const perms = new Set(def.permissions || []);
    const id = def.id;
    const self = this;

    const api = {
      pluginId: id,
      config: {
        get: key => key ? config[key] : { ...config },
        set: (key, val) => {
          config[key] = val;
          self._saveConfig(id, config);
        },
        reset: () => {
          const defaults = {};
          Object.entries(def.configSchema || {}).forEach(([k, v]) => { defaults[k] = v.default; });
          Object.assign(config, defaults);
          self._saveConfig(id, config);
        }
      },
      utils: Utils,
      ipc: {
        call: (ep, params) => self.callEndpoint(ep, params)
      }
    };

    // layers
    if (perms.has('layers.read') || perms.has('layers.write')) {
      api.layers = {};
      const lm = () => AppRegistry.require('layerManager');
      if (perms.has('layers.read')) {
        api.layers.getAll = () => lm().getAllLayers();
        api.layers.get = layerId => lm().getLayer(layerId);
      }
      if (perms.has('layers.write')) {
        api.layers.create = (name, features, type, meta) => lm().createLayer(name, features, type, meta);
        api.layers.delete = layerId => lm().deleteLayer(layerId);
        api.layers.addFeatures = (layerId, features) => lm().addFeaturesToLayer(layerId, features);
        api.layers.updateFeature = (layerId, fId, props) => lm().updateFeature(layerId, fId, props);
        api.layers.deleteFeature = (layerId, fId) => lm().deleteFeature(layerId, fId);
        api.layers.setColor = (layerId, color) => lm().setLayerColor(layerId, color);
        api.layers.setOpacity = (layerId, opacity) => lm().setLayerOpacity(layerId, opacity);
        api.layers.applyPropertyStyle = (layerId, property) => {
          const mm = AppRegistry.require('mapManager');
          mm.applyPropertyBasedStyle(layerId, property);
          const layer = lm().getLayer(layerId);
          if (layer) { layer.styleType = 'property'; layer.styleProperty = property; }
          eventBus.emit('layer.style.changed', { layerId, styleType: 'property', property });
        };
        api.layers.resetStyle = (layerId) => {
          const layer = lm().getLayer(layerId);
          if (!layer) return;
          layer.styleType = null;
          layer.styleProperty = null;
          lm().setLayerColor(layerId, layer.color);
          eventBus.emit('layer.style.changed', { layerId, styleType: 'solid' });
        };
      }
    }

    // map
    if (perms.has('map.read') || perms.has('map.write')) {
      api.map = {};
      const mm = () => AppRegistry.require('mapManager');
      if (perms.has('map.read')) {
        api.map.getMap = () => mm().map;
        api.map.getCenter = () => mm().map.getCenter();
        api.map.getZoom = () => mm().map.getZoom();
        api.map.getBounds = () => mm().map.getBounds();
        api.map.getLayerData = layerId => mm().getLayerData(layerId);
      }
      if (perms.has('map.write')) {
        api.map.setCenter = (lat, lng, zoom) => mm().setCenter(lat, lng, zoom);
        api.map.fitBounds = bounds => mm().map.fitBounds(bounds);
        api.map.addOverlay = overlay => overlay.setMap(mm().map);
        api.map.removeOverlay = overlay => overlay.setMap(null);
        api.map.hideLayerMarkers = layerId => {
          const cm = AppRegistry.get('clusterManager');
          if (cm) cm.hideLayerForHeatmap(layerId);
        };
        api.map.showLayerMarkers = layerId => {
          const cm = AppRegistry.get('clusterManager');
          if (cm) cm.showLayerForHeatmap(layerId);
        };
        // Feature-level visibility filter: predicate is (featureData) => boolean,
        // or null to clear. Composes correctly with clustering & viewport culling.
        api.map.setFeatureFilter = predicate => {
          const cm = AppRegistry.get('clusterManager');
          if (cm) cm.setFeatureFilter(predicate);
        };
        api.map.clearFeatureFilter = () => {
          const cm = AppRegistry.get('clusterManager');
          if (cm) cm.setFeatureFilter(null);
        };
      }
    }

    // ui.toast
    if (perms.has('ui.toast')) {
      api.ui = api.ui || {};
      api.ui.toast = {
        success: msg => toastManager.success(`[${def.name}] ${msg}`),
        error: msg => toastManager.error(`[${def.name}] ${msg}`),
        info: msg => toastManager.info(`[${def.name}] ${msg}`),
        warning: msg => toastManager.warning(`[${def.name}] ${msg}`)
      };
    }

    // ui.modal
    if (perms.has('ui.modal')) {
      api.ui = api.ui || {};
      api.ui.modal = {
        show: modalId => modalManager.show(modalId),
        close: modalId => modalManager.close(modalId),
        showLoading: msg => loadingManager.show(msg),
        hideLoading: () => loadingManager.hide(),
        openDrawer: (contentFn, title, options) => drawerManager.open(contentFn, title, options)
      };
    }

    // ui slots
    if (perms.has('ui.slot:toolbar')) {
      api.ui = api.ui || {};
      api.ui.addToolbarButton = (opts) => {
        const btn = Utils.createElement('button', {
          className: `plugin-toolbar-btn${def.headerToggle ? ' plugin-header-toggle' : ' plugin-menu-only'}`,
          title: Utils.escapeHtml(opts.tooltip || opts.label)
        });
        btn.dataset.pluginId = id;
        const pluginLabels = {
          'heatmap-overlay': ['ph-fire', 'Heatmap'],
          'route-optimizer': ['ph-path', 'Route planner'],
          'territory-builder': ['ph-polygon', 'Territories'],
          'data-filter': ['ph-funnel', 'Filter'],
          'choropleth': ['ph-palette', 'Shading'],
          'area-measure': ['ph-ruler', 'Area'],
          'radius-tool': ['ph-circle', 'Radius'],
          'geo-export': ['ph-export', 'Geo export']
        };
        const [iconClass, label] = pluginLabels[id] || ['ph-puzzle-piece', def.name];
        const icon = Utils.createElement('i', { className: `ph ${iconClass}` });
        const labelEl = Utils.createElement('span', {}, label);
        const menuIcon = Utils.createElement('i', { className: 'ph ph-caret-down plugin-caret' });
        btn.appendChild(icon);
        btn.appendChild(labelEl);
        btn.appendChild(menuIcon);
        if (opts.onClick) btn.addEventListener('click', opts.onClick);
        const toolbar = document.getElementById('pluginToolbarSlot');
        if (toolbar) toolbar.appendChild(btn);
        self._uiSlots.toolbar.push({ pluginId: id, element: btn });
        return btn;
      };
    }

    if (perms.has('ui.slot:sidebar-panel')) {
      api.ui = api.ui || {};
      api.ui.addSidebarPanel = (contentFn, title) => {
        const panel = Utils.createElement('div', { className: 'plugin-sidebar-panel' });
        const header = Utils.createElement('div', { className: 'plugin-panel-header' }, title);
        const body = Utils.createElement('div', { className: 'plugin-panel-body' });
        panel.appendChild(header);
        panel.appendChild(body);
        if (typeof contentFn === 'function') contentFn(body);
        const container = document.getElementById('pluginSidebarSlot');
        if (container) container.appendChild(panel);
        self._uiSlots['sidebar-panel'].push({ pluginId: id, element: panel });
        return { panel, body };
      };
    }

    if (perms.has('ui.slot:context-menu')) {
      api.ui = api.ui || {};
      api.ui.addContextMenuItem = (menuId, opts) => {
        const menu = document.getElementById(menuId);
        if (menu) {
          const item = Utils.createElement('div', { className: 'context-menu-item plugin-menu-item' }, opts.label);
          if (opts.onClick) item.addEventListener('click', opts.onClick);
          menu.appendChild(item);
          self._uiSlots['context-menu'].push({ pluginId: id, element: item });
          return item;
        }
        return null;
      };
    }

    // storage
    if (perms.has('storage.read') || perms.has('storage.write')) {
      api.storage = {};
      const storageKey = k => `${AppConfig.storage.pluginConfigPrefix}${id}_data_${k}`;
      if (perms.has('storage.read')) {
        api.storage.get = k => storageService.get(storageKey(k));
      }
      if (perms.has('storage.write')) {
        api.storage.set = (k, v) => storageService.set(storageKey(k), v);
        api.storage.remove = k => storageService.remove(storageKey(k));
      }
    }

    // events
    if (perms.has('events.listen')) {
      api.events = api.events || {};
      api.events.on = (event, cb) => eventBus.on(event, cb);
      api.events.once = (event, cb) => eventBus.once(event, cb);
    }

    if (perms.has('events.emit')) {
      api.events = api.events || {};
      api.events.emit = (event, data) => eventBus.emit(`${id}:${event}`, data);
    }

    // hooks
    if (perms.has('hooks.register')) {
      api.hooks = {
        register: (hookName, handler, priority = 10) => {
          if (!self.hooks.has(hookName)) self.hooks.set(hookName, []);
          self.hooks.get(hookName).push({ pluginId: id, handler, priority });
          self.hooks.get(hookName).sort((a, b) => a.priority - b.priority);
        }
      };
    }

    return api;
  }

  // Build auto-generated settings UI from configSchema
  buildSettingsUI(pluginId) {
    const p = this.plugins.get(pluginId);
    if (!p || !p.def.configSchema) return null;

    const form = Utils.createElement('div', { className: 'plugin-settings-form' });

    const liveApply = (key, schema, getValue) => {
      const val = getValue();
      if (schema.type === 'boolean') p.api.config.set(key, val);
      else if (schema.type === 'number' || schema.type === 'range') p.api.config.set(key, parseFloat(val));
      else p.api.config.set(key, val);
      if (p.def._isActive && typeof p.def._refresh === 'function') p.def._refresh.call(p.def);
    };

    Object.entries(p.def.configSchema).forEach(([key, schema]) => {
      const group = Utils.createElement('div', { className: 'settings-field' });
      const label = Utils.createElement('label');
      label.textContent = schema.label || key;

      let input;
      if (schema.type === 'boolean') {
        input = Utils.createElement('input', { type: 'checkbox', name: key });
        if (p.config[key]) input.checked = true;
        input.addEventListener('change', () => liveApply(key, schema, () => input.checked));
      } else if (schema.type === 'select') {
        input = Utils.createElement('select', { name: key });
        (schema.options || []).forEach(opt => {
          const option = Utils.createElement('option', { value: opt }, opt);
          if (p.config[key] === opt) option.selected = true;
          input.appendChild(option);
        });
        input.addEventListener('change', () => liveApply(key, schema, () => input.value));
      } else if (schema.type === 'range') {
        const val = p.config[key] !== undefined ? p.config[key] : schema.default;
        const decimals = schema.decimals !== undefined ? schema.decimals : 0;
        const labelRow = Utils.createElement('div', { className: 'styler-slider-label-row' });
        const labelText = Utils.createElement('span');
        labelText.textContent = schema.label || key;
        const valueDisplay = Utils.createElement('span', { className: 'styler-slider-value' });
        valueDisplay.textContent = parseFloat(val).toFixed(decimals);
        labelRow.appendChild(labelText);
        labelRow.appendChild(valueDisplay);
        label.replaceWith(labelRow);
        input = Utils.createElement('input', {
          type: 'range', name: key, className: 'styler-slider',
          min: schema.min !== undefined ? schema.min : 0,
          max: schema.max !== undefined ? schema.max : 1,
          step: schema.step !== undefined ? schema.step : 'any'
        });
        input.value = val;
        input.addEventListener('input', () => {
          valueDisplay.textContent = parseFloat(input.value).toFixed(decimals);
          liveApply(key, schema, () => input.value);
        });
      } else if (schema.type === 'number') {
        input = Utils.createElement('input', {
          type: 'number', name: key,
          ...(schema.min !== undefined ? { min: schema.min } : {}),
          ...(schema.max !== undefined ? { max: schema.max } : {})
        });
        input.value = p.config[key] !== undefined ? p.config[key] : (schema.default || '');
      } else {
        input = Utils.createElement('input', { type: 'text', name: key });
        input.value = p.config[key] !== undefined ? p.config[key] : (schema.default || '');
      }

      group.appendChild(label);
      group.appendChild(input);
      form.appendChild(group);
    });

    const saveBtn = Utils.createElement('button', { className: 'btn btn-primary btn-sm' }, 'Save Settings');
    saveBtn.addEventListener('click', () => {
      // Flush any non-live fields (number, text) and confirm
      form.querySelectorAll('input, select').forEach(inp => {
        if (!inp.name || inp.type === 'range' || inp.type === 'checkbox') return;
        const schema = p.def.configSchema[inp.name];
        if (!schema) return;
        liveApply(inp.name, schema, () => inp.value);
      });
      toastManager.success('Plugin settings saved');
    });

    const resetBtn = Utils.createElement('button', { className: 'btn btn-sm', style: 'margin-left:6px' }, 'Reset to Defaults');
    resetBtn.addEventListener('click', () => {
      Object.entries(p.def.configSchema).forEach(([key, schema]) => {
        if (schema.default === undefined) return;
        p.api.config.set(key, schema.default);
        // Update the matching form control so the UI reflects the reset value
        const inp = form.querySelector(`[name="${key}"]`);
        if (!inp) return;
        if (inp.type === 'checkbox') {
          inp.checked = !!schema.default;
        } else {
          inp.value = schema.default;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      if (p.def._isActive && typeof p.def._refresh === 'function') p.def._refresh.call(p.def);
      toastManager.info('Settings reset to defaults');
    });

    const btnRow = Utils.createElement('div', { style: 'display:flex;align-items:center;margin-top:4px' });
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(resetBtn);
    form.appendChild(btnRow);
    return form;
  }
}

// ─── Globals ────────────────────────────────────────────────────────────────
const pluginRegistry = new PluginRegistry();
const pluginManager = new PluginManager();

AppRegistry.register('pluginRegistry', pluginRegistry);
AppRegistry.register('pluginManager', pluginManager);

// Restore plugin enable/disable states. A stored user choice always wins;
// otherwise a plugin starts disabled when its manifest sets defaultEnabled: false.
function restorePluginStates() {
  const states = storageService.get('pluginStates') || {};
  pluginManager.getAllStatus().forEach(({ id }) => {
    const def = pluginRegistry.getDefinition(id);
    const enabled = (id in states)
      ? states[id] !== false
      : !(def && def.defaultEnabled === false);
    if (!enabled) pluginManager.disable(id);
  });
}
