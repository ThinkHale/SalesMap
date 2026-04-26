// js/controllers/profile-controller.js — ProfileController

const ProfileController = {
  _selectEl: null,

  async initialize() {
    this._selectEl = document.getElementById('profileSelect');

    try {
      const firebaseManager = AppRegistry.require('firebaseManager');
      let profiles = await firebaseManager.getProfiles();

      // If no profiles, create default
      if (!profiles || profiles.length === 0) {
        const defaultProfile = await firebaseManager.createProfile('Default Workspace');
        profiles = [defaultProfile];
      }

      // Store in state
      AppRegistry.require('stateManager').update({ profiles }, true);

      // Populate selector
      this._populateSelector(profiles);

      // Select first profile
      const firstProfile = profiles[0];
      await this.switchProfile(firstProfile.id, firstProfile.name);

    } catch (err) {
      AppErrorHandler.handle(err, 'ProfileController.initialize');
      // Fallback: create a local-only profile
      const localProfile = { id: Utils.generateId('profile'), name: 'Local Workspace', createdAt: Utils.formatDate() };
      AppRegistry.require('stateManager').update({ currentProfile: localProfile, profiles: [localProfile] }, true);
      this._populateSelector([localProfile]);
    }
  },

  _populateSelector(profiles) {
    if (!this._selectEl) return;
    this._selectEl.innerHTML = '';
    profiles.forEach(p => {
      const opt = Utils.createElement('option', { value: p.id });
      opt.textContent = p.name;
      this._selectEl.appendChild(opt);
    });
  },

  async switchProfile(id, name) {
    const firebaseManager = AppRegistry.require('firebaseManager');
    const layerManager = AppRegistry.require('layerManager');
    const sm = AppRegistry.require('stateManager');

    loadingManager.show('Loading workspace...');
    try {
      firebaseManager.setProfile(id);
      const data = await firebaseManager.loadAllLayers(id);

      sm.set('currentProfile', { id, name: name || id, lastUpdated: Utils.formatDate() }, true);
      sm.set('lastSaveId', null, true);

      // Clear existing layers
      layerManager.getAllLayers().forEach(l => layerManager.deleteLayer(l.id));
      AppRegistry.require('commandHistory').clear();
      layerManager.layerGroups.clear();
      sm.set('layerOrder', [], true);
      sm.set('allLayersGroupId', null, true);

      // Create default "All Layers" group
      const defaultGroup = layerManager.createLayerGroup('All Layers', { isDefault: true });

      // Import saved data
      if (data && data.layers && Object.keys(data.layers).length > 0) {
        layerManager.importLayers(data);
      }

      // Update selector
      if (this._selectEl) this._selectEl.value = id;

      loadingManager.hide();
      toastManager.success(`Switched to "${name || id}"`);
      eventBus.emit('profile.switched', { id, name });
    } catch (err) {
      loadingManager.hide();
      AppErrorHandler.handle(err, 'ProfileController.switchProfile');
    }
  },

  async createProfile(name) {
    if (!name || !name.trim()) {
      toastManager.error('Please enter a workspace name');
      return;
    }
    const firebaseManager = AppRegistry.require('firebaseManager');
    const sm = AppRegistry.require('stateManager');

    loadingManager.show('Creating workspace...');
    try {
      const profile = await firebaseManager.createProfile(name.trim());
      const profiles = [...sm.get('profiles'), profile];
      sm.set('profiles', profiles, true);
      this._populateSelector(profiles);
      await this.switchProfile(profile.id, profile.name);
      loadingManager.hide();
      toastManager.success(`Workspace "${name}" created`);
    } catch (err) {
      loadingManager.hide();
      AppErrorHandler.handle(err, 'ProfileController.createProfile');
    }
  },

  async deleteProfile(id) {
    const sm = AppRegistry.require('stateManager');
    const profiles = sm.get('profiles');

    if (profiles.length <= 1) {
      toastManager.error('Cannot delete the last workspace');
      return;
    }

    const profile = profiles.find(p => p.id === id);
    const confirmed = confirm(`Delete workspace "${profile?.name || id}"? This cannot be undone.`);
    if (!confirmed) return;

    const firebaseManager = AppRegistry.require('firebaseManager');
    loadingManager.show('Deleting workspace...');
    try {
      await firebaseManager.deleteProfile(id);
      const newProfiles = profiles.filter(p => p.id !== id);
      sm.set('profiles', newProfiles, true);
      this._populateSelector(newProfiles);
      // Switch to first remaining profile
      await this.switchProfile(newProfiles[0].id, newProfiles[0].name);
      loadingManager.hide();
      toastManager.success('Workspace deleted');
    } catch (err) {
      loadingManager.hide();
      AppErrorHandler.handle(err, 'ProfileController.deleteProfile');
    }
  },

  getCurrentProfile() {
    return AppRegistry.require('stateManager').getCurrentProfile();
  }
};

AppRegistry.register('profileController', ProfileController);
