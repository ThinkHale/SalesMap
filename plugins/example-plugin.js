// plugins/example-plugin.js — Demonstrates the plugin API

const ExamplePlugin = {
  id: 'example-plugin',
  name: 'Example Plugin',
  version: '1.0.0',
  description: 'Demonstrates the SalesMapper plugin API. Shows how to read layers, listen to events, and add UI elements.',
  author: 'SalesMapper',
  minAppVersion: '4.0.0',

  permissions: [
    'layers.read',
    'ui.toast',
    'ui.slot:sidebar-panel',
    'events.listen',
    'events.emit',
    'storage.read',
    'storage.write'
  ],

  configSchema: {
    enabled: { type: 'boolean', default: true, label: 'Enable statistics panel' },
    refreshInterval: { type: 'number', default: 0, min: 0, max: 60, label: 'Auto-refresh (seconds, 0=off)' }
  },

  _api: null,
  _panelBody: null,
  _refreshTimer: null,

  init(api) {
    this._api = api;

    if (api.config.get('enabled')) {
      const { body } = api.ui.addSidebarPanel(panelBody => {
        this._panelBody = panelBody;
        this._renderStats();
      }, 'Layer Statistics');

      api.events.on('layer.created', () => this._renderStats());
      api.events.on('layer.deleted', () => this._renderStats());
      api.events.on('features.added', () => this._renderStats());
      api.events.on('feature.deleted', () => this._renderStats());
    }
  },

  onEnable() {
    this._renderStats();
  },

  onDisable() {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
  },

  destroy() {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
  },

  _renderStats() {
    if (!this._panelBody) return;
    const layers = this._api.layers.getAll();

    this._panelBody.innerHTML = '';

    if (layers.length === 0) {
      this._panelBody.appendChild(
        Utils.createElement('p', { className: 'no-data-msg' }, 'No layers loaded.')
      );
      return;
    }

    const totalFeatures = layers.reduce((acc, l) => acc + (l.features || []).length, 0);
    const visibleLayers = layers.filter(l => l.visible).length;

    // Summary row
    const summary = Utils.createElement('div', { className: 'stats-summary' });
    const addStat = (label, value) => {
      const item = Utils.createElement('div', { className: 'stat-item' });
      const lbl = Utils.createElement('span', { className: 'stat-label' }, label);
      const val = Utils.createElement('span', { className: 'stat-value' }, String(value));
      item.appendChild(lbl);
      item.appendChild(val);
      summary.appendChild(item);
    };
    addStat('Total layers', layers.length);
    addStat('Visible', visibleLayers);
    addStat('Total features', Utils.formatNumber(totalFeatures));
    this._panelBody.appendChild(summary);

    // Per-layer table
    const table = Utils.createElement('table', { className: 'stats-table' });
    const thead = Utils.createElement('thead');
    const headerRow = Utils.createElement('tr');
    ['Layer', 'Type', 'Features'].forEach(h => {
      headerRow.appendChild(Utils.createElement('th', {}, h));
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = Utils.createElement('tbody');
    layers.forEach(layer => {
      const tr = Utils.createElement('tr');
      tr.appendChild(Utils.createElement('td', {}, layer.name));
      tr.appendChild(Utils.createElement('td', {}, layer.type));
      tr.appendChild(Utils.createElement('td', {}, Utils.formatNumber((layer.features || []).length)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    this._panelBody.appendChild(table);
  },

  // Expose as inter-plugin endpoint
  endpoints: {
    'getStats': async (params, api) => {
      const layers = api.layers.getAll();
      return {
        layerCount: layers.length,
        totalFeatures: layers.reduce((acc, l) => acc + (l.features || []).length, 0),
        layers: layers.map(l => ({ id: l.id, name: l.name, featureCount: (l.features || []).length }))
      };
    }
  }
};

AppRegistry.whenReady('pluginRegistry', r => r.register(ExamplePlugin));
