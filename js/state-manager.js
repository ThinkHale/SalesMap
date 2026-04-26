// js/state-manager.js — StateManager (single source of truth)

class StateManager {
  constructor() {
    this.state = {
      currentProfile: null,
      profiles: [],
      layers: new Map(),
      layerGroups: new Map(),
      layerOrder: [],
      allLayersGroupId: null,
      activeGroupFilter: null,
      expandedGroups: new Set(),
      currentEditingFeature: null,
      drawingMode: null,
      targetLayerForNewFeature: null,
      realtimeEnabled: false,
      lastSaveId: null,
      isDirty: false
    };
    this._subscribers = new Map();
    this._wildcardSubscribers = new Set();
  }

  get(key) {
    if (!key) return this.state;
    return Utils.getNestedProperty(this.state, key);
  }

  set(key, value, silent = false) {
    const oldValue = Utils.getNestedProperty(this.state, key);
    Utils.setNestedProperty(this.state, key, value);
    if (!silent) {
      this.state.isDirty = true;
      this.notify(key, value, oldValue);
    }
  }

  update(updates, silent = false) {
    for (const [key, value] of Object.entries(updates)) {
      this.set(key, value, silent);
    }
  }

  subscribe(key, callback) {
    if (key === '*') {
      this._wildcardSubscribers.add(callback);
      return () => this._wildcardSubscribers.delete(callback);
    }
    if (!this._subscribers.has(key)) this._subscribers.set(key, new Set());
    this._subscribers.get(key).add(callback);
    return () => {
      const subs = this._subscribers.get(key);
      if (subs) subs.delete(callback);
    };
  }

  notify(key, newValue, oldValue) {
    if (this._subscribers.has(key)) {
      this._subscribers.get(key).forEach(cb => {
        try { cb(newValue, oldValue, key); } catch (e) { console.error('[StateManager] Subscriber error:', e); }
      });
    }
    this._wildcardSubscribers.forEach(cb => {
      try { cb(key, newValue, oldValue); } catch (e) { console.error('[StateManager] Wildcard subscriber error:', e); }
    });
  }

  getLayer(id) {
    return this.state.layers.get(id) || null;
  }

  getAllLayers() {
    return this.state.layerOrder
      .map(id => this.state.layers.get(id))
      .filter(Boolean);
  }

  getCurrentProfile() {
    return this.state.currentProfile;
  }

  // Serialize state to plain object (for persistence)
  serialize() {
    const s = this.state;
    return {
      currentProfile: s.currentProfile,
      profiles: s.profiles,
      layers: Object.fromEntries(s.layers),
      layerGroups: Object.fromEntries(s.layerGroups),
      layerOrder: [...s.layerOrder],
      allLayersGroupId: s.allLayersGroupId,
      activeGroupFilter: s.activeGroupFilter,
      expandedGroups: [...s.expandedGroups]
    };
  }

  // Restore from serialized object
  restore(data) {
    if (!data) return;
    if (data.currentProfile !== undefined) this.state.currentProfile = data.currentProfile;
    if (data.profiles !== undefined) this.state.profiles = data.profiles;
    if (data.layers) this.state.layers = new Map(Object.entries(data.layers));
    if (data.layerGroups) this.state.layerGroups = new Map(Object.entries(data.layerGroups));
    if (data.layerOrder) this.state.layerOrder = data.layerOrder;
    if (data.allLayersGroupId !== undefined) this.state.allLayersGroupId = data.allLayersGroupId;
    if (data.activeGroupFilter !== undefined) this.state.activeGroupFilter = data.activeGroupFilter;
    if (data.expandedGroups) this.state.expandedGroups = new Set(data.expandedGroups);
  }
}

const stateManager = new StateManager();
AppRegistry.register('stateManager', stateManager);
