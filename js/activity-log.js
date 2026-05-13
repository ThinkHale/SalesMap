// js/activity-log.js — ActivityLog

class ActivityLog {
  constructor(stateManager) {
    this._sm = stateManager;
    this._entries = [];
    this._maxEntries = 500;
    this._container = null;
  }

  initialize() {
    this._container = document.getElementById('activityList');

    const eventMap = {
      'layer.created': (d) => ({ type: 'layer', icon: '➕', msg: `Layer created: "${d.layer?.name || ''}"` }),
      'layer.deleted': (d) => ({ type: 'layer', icon: '🗑', msg: `Layer deleted: "${d.layer?.name || d.layerId}"` }),
      'layer.renamed': (d) => ({ type: 'layer', icon: '✏️', msg: `Layer renamed to "${d.newName}"` }),
      'layer.visibility.changed': (d) => ({ type: 'layer', icon: d.visible ? '👁' : '🚫', msg: `Layer ${d.visible ? 'shown' : 'hidden'}` }),
      'features.added': (d) => ({ type: 'data', icon: '📍', msg: `${d.addedCount || 0} feature(s) added to layer` }),
      'feature.updated': (d) => ({ type: 'data', icon: '✏️', msg: `Feature updated` }),
      'feature.deleted': (d) => ({ type: 'data', icon: '🗑', msg: `Feature deleted: "${d.feature?.name || d.featureId}"` }),
      'feature.moved': (d) => ({ type: 'data', icon: '↕️', msg: `Feature moved between layers` }),
      'group.created': (d) => ({ type: 'group', icon: '📁', msg: `Group created: "${d.group?.name || ''}"` }),
      'group.deleted': (d) => ({ type: 'group', icon: '🗑', msg: `Group deleted` }),
      'layers.imported': (d) => ({ type: 'import', icon: '📥', msg: `${d.layerCount || 0} layer(s) imported from Firebase` }),
      'layers.updated': (d) => ({ type: 'sync', icon: '🔄', msg: `Map updated from remote` }),
      'firebase.saved': () => ({ type: 'sync', icon: '💾', msg: 'Data saved to cloud' }),
      'firebase.error': (d) => ({ type: 'error', icon: '⚠️', msg: `Firebase error: ${d?.message || ''}` }),
      'plugin.initialized': (d) => ({ type: 'plugin', icon: '🔌', msg: `Plugin initialized: ${d.pluginId}` }),
      'distance.tool.activated': () => ({ type: 'tool', icon: '📏', msg: 'Distance tool activated' })
    };

    Object.entries(eventMap).forEach(([event, builder]) => {
      eventBus.on(event, (data) => {
        const entry = builder(data);
        this.logActivity(entry.type, entry.msg, { icon: entry.icon });
      });
    });
  }

  logActivity(type, description, metadata = {}) {
    const entry = {
      id: Utils.generateId('log'),
      type,
      description,
      icon: metadata.icon || this._iconForType(type),
      timestamp: new Date(),
      metadata
    };

    this._entries.unshift(entry);
    if (this._entries.length > this._maxEntries) {
      this._entries = this._entries.slice(0, this._maxEntries);
    }

    this._prependEntry(entry);
  }

  _iconForType(type) {
    const icons = { layer: '📄', data: '📍', group: '📁', import: '📥', sync: '🔄', error: '⚠️', plugin: '🔌', tool: '🛠️' };
    return icons[type] || 'ℹ️';
  }

  _prependEntry(entry) {
    if (!this._container) this._container = document.getElementById('activityList');
    if (!this._container) return;

    const item = Utils.createElement('div', { className: `activity-item activity-${entry.type}` });
    const iconEl = Utils.createElement('span', { className: 'activity-icon' });
    iconEl.textContent = entry.icon;
    const content = Utils.createElement('div', { className: 'activity-content' });
    const desc = Utils.createElement('div', { className: 'activity-desc' });
    desc.textContent = entry.description;
    const time = Utils.createElement('div', { className: 'activity-time' });
    time.textContent = Utils.formatRelativeTime(entry.timestamp);

    content.appendChild(desc);
    content.appendChild(time);
    item.appendChild(iconEl);
    item.appendChild(content);

    this._container.insertBefore(item, this._container.firstChild);

    // Keep DOM list manageable
    const items = this._container.querySelectorAll('.activity-item');
    if (items.length > 100) items[items.length - 1].remove();
  }

  renderActivityList() {
    if (!this._container) this._container = document.getElementById('activityList');
    if (!this._container) return;
    this._container.innerHTML = '';
    // _entries is newest-first; prepending in that order produces oldest-at-top.
    // Reverse so we prepend oldest first → newest ends up at top of the list.
    this._entries.slice(0, 100).reverse().forEach(entry => this._prependEntry(entry));
  }

  exportJSON() {
    const blob = new Blob([JSON.stringify(this._entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity_log_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  exportCSV() {
    const rows = [['Timestamp', 'Type', 'Description'].join(',')];
    this._entries.forEach(e => {
      rows.push([
        `"${e.timestamp.toISOString()}"`,
        `"${e.type}"`,
        `"${String(e.description).replace(/"/g, '""')}"`
      ].join(','));
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity_log_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  clear() {
    this._entries = [];
    if (this._container) this._container.innerHTML = '';
  }

  getEntries() { return [...this._entries]; }
}
