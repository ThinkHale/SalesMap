// js/app-registry.js — AppRegistry (explicit dependency container)

const AppRegistry = {
  _services: new Map(),
  _pending: new Map(),

  register(name, instance) {
    this._services.set(name, instance);
    if (this._pending.has(name)) {
      this._pending.get(name).forEach(cb => {
        try { cb(instance); } catch (e) { console.error(`[AppRegistry] Callback error for '${name}':`, e); }
      });
      this._pending.delete(name);
    }
  },

  get(name) {
    return this._services.get(name) || null;
  },

  require(name) {
    const s = this._services.get(name);
    if (!s) throw new Error(`Required service '${name}' not registered`);
    return s;
  },

  whenReady(name, callback) {
    if (this._services.has(name)) {
      try { callback(this._services.get(name)); } catch (e) { console.error(`[AppRegistry] whenReady callback error for '${name}':`, e); }
    } else {
      if (!this._pending.has(name)) this._pending.set(name, []);
      this._pending.get(name).push(callback);
    }
  },

  has(name) {
    return this._services.has(name);
  },

  unregister(name) {
    this._services.delete(name);
  },

  list() {
    return Array.from(this._services.keys());
  }
};
