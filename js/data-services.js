// js/data-services.js — StorageService, FirebaseService, DataSyncService

// ─── StorageService ────────────────────────────────────────────────────────
class StorageService {
  get(key) {
    try {
      const val = localStorage.getItem(key);
      if (val === null) return null;
      return JSON.parse(val);
    } catch (e) {
      console.warn('[StorageService] Failed to read key:', key, e);
      return null;
    }
  }

  set(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      console.warn('[StorageService] Failed to write key:', key, e);
      return false;
    }
  }

  remove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  clear() {
    try {
      localStorage.clear();
      return true;
    } catch (e) {
      return false;
    }
  }

  keys() {
    try {
      return Object.keys(localStorage);
    } catch (e) {
      return [];
    }
  }

  getSize() {
    try {
      let total = 0;
      for (const key of Object.keys(localStorage)) {
        total += localStorage.getItem(key).length * 2; // UTF-16
      }
      return total;
    } catch (e) {
      return 0;
    }
  }
}

// ─── FirebaseService ───────────────────────────────────────────────────────
class FirebaseService {
  constructor() {
    this._dbInstance = null;
    this._auth = null;
  }

  async save(path, data) {
    const db = firebase.database();
    await db.ref(path).set(data);
  }

  async load(path) {
    const db = firebase.database();
    const snap = await db.ref(path).once('value');
    return snap.val();
  }

  async update(path, updates) {
    const db = firebase.database();
    await db.ref(path).update(updates);
  }

  async delete(path) {
    const db = firebase.database();
    await db.ref(path).remove();
  }

  listen(path, callback) {
    const db = firebase.database();
    const ref = db.ref(path);
    const handler = snap => callback(snap.val());
    ref.on('value', handler);
    return () => ref.off('value', handler);
  }
}

// ─── DataSyncService ────────────────────────────────────────────────────────
class DataSyncService {
  constructor(storageService, firebaseService) {
    this._storage = storageService;
    this._firebase = firebaseService;
    this._syncMeta = {
      lastSyncedAt: null,
      syncCount: 0,
      failCount: 0
    };
  }

  async saveWithFallback(key, data, firebasePath) {
    let firebaseOk = false;
    try {
      if (firebasePath) {
        await this._firebase.save(firebasePath, data);
        firebaseOk = true;
      }
    } catch (e) {
      console.warn('[DataSyncService] Firebase save failed, falling back to localStorage:', e);
    }
    this._storage.set(key, data);
    this._syncMeta.lastSyncedAt = Utils.formatDate();
    if (firebaseOk) this._syncMeta.syncCount++;
    else this._syncMeta.failCount++;
    return firebaseOk;
  }

  async loadWithFallback(key, firebasePath) {
    try {
      if (firebasePath) {
        const data = await this._firebase.load(firebasePath);
        if (data) {
          this._storage.set(key, data);
          return data;
        }
      }
    } catch (e) {
      console.warn('[DataSyncService] Firebase load failed, using localStorage:', e);
    }
    return this._storage.get(key);
  }

  getSyncMeta() { return { ...this._syncMeta }; }
}

// ─── Instantiate and register ──────────────────────────────────────────────
const storageService = new StorageService();
const firebaseService = new FirebaseService();
const dataSyncService = new DataSyncService(storageService, firebaseService);

AppRegistry.register('storageService', storageService);
AppRegistry.register('firebaseService', firebaseService);
AppRegistry.register('dataSyncService', dataSyncService);
