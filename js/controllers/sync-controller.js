// js/controllers/sync-controller.js — SyncController

const SyncController = {
  _saveTimeout: null,
  _isSaving: false,
  _isImporting: false,
  _listenerActive: false,

  scheduleSave() {
    if (this._saveTimeout) clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => this._doSave(), 500);
  },

  async _doSave() {
    const firebaseManager = AppRegistry.require('firebaseManager');
    const layerManager = AppRegistry.require('layerManager');
    const sm = AppRegistry.require('stateManager');

    const profile = sm.getCurrentProfile();
    if (!profile || this._isSaving || this._isImporting) return;

    this._isSaving = true;
    const saveId = Utils.generateSaveId();
    sm.set('lastSaveId', saveId, true);

    const wasListening = sm.get('realtimeEnabled');
    if (wasListening) {
      firebaseManager.stopListening();
      this._listenerActive = false;
      sm.set('realtimeEnabled', false, true);
    }

    try {
      const layersData = layerManager.exportAllLayers();
      const groupsData = Array.from(layerManager.layerGroups.values());
      await firebaseManager.saveAllLayers({
        ...layersData,
        _groups: groupsData,
        _saveId: saveId,
        _savedAt: Utils.formatDate()
      }, profile.name);
      eventBus.emit('firebase.saved', { saveId });
    } catch (err) {
      AppErrorHandler.handle(err, 'SyncController._doSave');
      eventBus.emit('firebase.error', { message: err.message });
    } finally {
      this._isSaving = false;
      if (wasListening) {
        this.enableRealtimeSync();
      }
    }
  },

  enableRealtimeSync() {
    if (this._listenerActive) return;
    const firebaseManager = AppRegistry.require('firebaseManager');
    const sm = AppRegistry.require('stateManager');

    firebaseManager.listenForUpdates((data) => {
      if (!sm.get('realtimeEnabled')) return;
      // Echo prevention: skip if this is our own save
      if (data._saveId && data._saveId === sm.get('lastSaveId')) return;
      if (this._isSaving || this._isImporting) return;
      this._applyRemoteUpdate(data);
    });
    this._listenerActive = true;

    sm.set('realtimeEnabled', true, true);
  },

  disableRealtimeSync() {
    const firebaseManager = AppRegistry.require('firebaseManager');
    const sm = AppRegistry.require('stateManager');
    firebaseManager.stopListening();
    this._listenerActive = false;
    sm.set('realtimeEnabled', false, true);
  },

  _applyRemoteUpdate(data) {
    const layerManager = AppRegistry.require('layerManager');
    this._isImporting = true;
    try {
      layerManager.importLayers(data);
      if (data._groups) {
        // Groups are restored inside importLayers
      }
      eventBus.emit('layers.updated', { source: 'realtime' });
      toastManager.info('Map updated by another user');
    } catch (err) {
      AppErrorHandler.handle(err, 'SyncController._applyRemoteUpdate');
    } finally {
      this._isImporting = false;
    }
  },

  isSaving() { return this._isSaving; },
  isImporting() { return this._isImporting; }
};

AppRegistry.register('syncController', SyncController);
