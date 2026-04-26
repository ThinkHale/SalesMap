// js/firebase-config.js — FirebaseManager

class FirebaseManager {
  constructor() {
    this._app = null;
    this._db = null;
    this._auth = null;
    this._uid = null;
    this._profileId = null;
    this._unsubscribe = null;
    this._initialized = false;
  }

  async initialize() {
    if (this._initialized) return;

    this._app = firebase.initializeApp(AppConfig.firebase);
    this._db = firebase.database();
    this._auth = firebase.auth();

    // Anonymous auth
    try {
      const result = await this._auth.signInAnonymously();
      this._uid = result.user.uid;
      eventBus.emit('firebase.auth.ready', { uid: this._uid });
    } catch (e) {
      console.warn('[FirebaseManager] Anonymous auth failed, continuing without auth:', e);
      this._uid = 'anonymous_' + Utils.generateId('uid');
    }

    this._initialized = true;
    return this._uid;
  }

  setProfile(profileId) {
    this._profileId = profileId;
  }

  _profilePath(profileId) {
    return `salesTerritoryData/profiles/${profileId || this._profileId}`;
  }

  async saveAllLayers(data, profileName) {
    if (!this._profileId) throw new Error('No profile selected');
    const payload = {
      ...data,
      _savedBy: this._uid,
      _savedAt: Utils.formatDate(),
      _profileName: profileName
    };
    await this._db.ref(this._profilePath()).set(payload);
    eventBus.emit('firebase.saved', { profileId: this._profileId });
    return true;
  }

  async loadAllLayers(profileId) {
    const path = this._profilePath(profileId);
    const snap = await this._db.ref(path).once('value');
    const data = snap.val();
    eventBus.emit('firebase.loaded', { profileId: profileId || this._profileId, data });
    return data;
  }

  listenForUpdates(callback) {
    if (!this._profileId) return;
    const path = this._profilePath();
    const ref = this._db.ref(path);
    const handler = snap => {
      const data = snap.val();
      if (data) callback(data);
    };
    ref.on('value', handler);
    this._unsubscribe = () => ref.off('value', handler);
  }

  stopListening() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  async getProfiles() {
    try {
      const snap = await this._db.ref('salesTerritoryData/profiles').once('value');
      const val = snap.val();
      if (!val) return [];
      return Object.entries(val).map(([id, data]) => ({
        id,
        name: data._profileName || id,
        lastUpdated: data._savedAt || null,
        createdAt: data._createdAt || null
      }));
    } catch (e) {
      console.warn('[FirebaseManager] getProfiles failed:', e);
      return [];
    }
  }

  async createProfile(name) {
    const id = Utils.generateId('profile');
    const path = `salesTerritoryData/profiles/${id}`;
    await this._db.ref(path).set({
      _profileName: name,
      _createdAt: Utils.formatDate(),
      _savedAt: Utils.formatDate(),
      _savedBy: this._uid,
      layers: {},
      layerOrder: []
    });
    return { id, name, createdAt: Utils.formatDate() };
  }

  async deleteProfile(id) {
    await this._db.ref(`salesTerritoryData/profiles/${id}`).remove();
  }

  async switchProfile(id) {
    this.stopListening();
    this._profileId = id;
    return this.loadAllLayers(id);
  }

  isInitialized() { return this._initialized; }
  getUid() { return this._uid; }
  getCurrentProfileId() { return this._profileId; }
}

const firebaseManager = new FirebaseManager();
AppRegistry.register('firebaseManager', firebaseManager);
