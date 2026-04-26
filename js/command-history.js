// js/command-history.js — CommandHistory + Command classes

// ─── Command classes ────────────────────────────────────────────────────────

class CreateLayerCommand {
  constructor(layerManager, name, features, type, metadata) {
    this.layerManager = layerManager;
    this.name = name;
    this.features = features;
    this.type = type;
    this.metadata = metadata;
    this.layerId = null;
    this.description = `Create layer "${name}"`;
  }
  execute() {
    const layer = this.layerManager.createLayer(this.name, this.features, this.type, this.metadata);
    this.layerId = layer.id;
  }
  undo() {
    if (this.layerId) this.layerManager.deleteLayer(this.layerId);
  }
}

class DeleteLayerCommand {
  constructor(layerManager, layerId) {
    this.layerManager = layerManager;
    this.layerId = layerId;
    this._snapshot = null;
    this._groupId = null;
    this.description = `Delete layer`;
  }
  execute() {
    const layer = this.layerManager.getLayer(this.layerId);
    if (!layer) return;
    this.description = `Delete layer "${layer.name}"`;
    this._snapshot = Utils.deepClone(layer);
    this._groupId = layer.groupId;
    this.layerManager.deleteLayer(this.layerId);
  }
  undo() {
    if (!this._snapshot) return;
    const layer = this.layerManager.createLayer(
      this._snapshot.name,
      this._snapshot.features,
      this._snapshot.type,
      this._snapshot.metadata,
      this._snapshot.id,
      {
        color: this._snapshot.color,
        visible: this._snapshot.visible,
        opacity: this._snapshot.opacity,
        styleType: this._snapshot.styleType,
        styleProperty: this._snapshot.styleProperty,
        showLabels: this._snapshot.showLabels,
        groupId: this._groupId,
        createdAt: this._snapshot.createdAt
      }
    );

    if (this._snapshot.visible === false) {
      this.layerManager.setLayerVisibility(layer.id, false);
    }
    if (this._snapshot.opacity !== undefined && this._snapshot.opacity !== null) {
      this.layerManager.setLayerOpacity(layer.id, this._snapshot.opacity);
    }
    if (this._snapshot.styleType === 'property' && this._snapshot.styleProperty) {
      this.layerManager._mapManager.applyPropertyBasedStyle(layer.id, this._snapshot.styleProperty);
    }
    if (this._snapshot.showLabels) {
      this.layerManager._mapManager.toggleLayerLabels(layer.id, true, layer.features);
    }
  }
}

class AddFeatureCommand {
  constructor(layerManager, layerId, features) {
    this.layerManager = layerManager;
    this.layerId = layerId;
    this.features = features;
    this._addedIds = [];
    this.description = `Add ${features.length} feature(s)`;
  }
  execute() {
    this._addedIds = this.features.map(f => f.id);
    this.layerManager.addFeaturesToLayer(this.layerId, this.features);
  }
  undo() {
    this._addedIds.forEach(fid => this.layerManager.deleteFeature(this.layerId, fid));
  }
}

class DeleteFeatureCommand {
  constructor(layerManager, layerId, featureId) {
    this.layerManager = layerManager;
    this.layerId = layerId;
    this.featureId = featureId;
    this._snapshot = null;
    this.description = 'Delete feature';
  }
  execute() {
    this._snapshot = Utils.deepClone(this.layerManager.getFeature(this.layerId, this.featureId));
    if (this._snapshot) this.description = `Delete feature "${this._snapshot.name || this.featureId}"`;
    this.layerManager.deleteFeature(this.layerId, this.featureId);
  }
  undo() {
    if (this._snapshot) {
      this.layerManager.addFeaturesToLayer(this.layerId, [this._snapshot]);
    }
  }
}

class UpdateFeatureCommand {
  constructor(layerManager, layerId, featureId, newProps, oldProps) {
    this.layerManager = layerManager;
    this.layerId = layerId;
    this.featureId = featureId;
    this.newProps = newProps;
    this.oldProps = oldProps;
    this.description = `Update feature`;
  }
  execute() {
    this.layerManager.updateFeature(this.layerId, this.featureId, this.newProps);
  }
  undo() {
    this.layerManager.updateFeature(this.layerId, this.featureId, this.oldProps);
  }
}

class CreateGroupCommand {
  constructor(layerManager, name) {
    this.layerManager = layerManager;
    this.name = name;
    this.groupId = null;
    this.description = `Create group "${name}"`;
  }
  execute() {
    const group = this.layerManager.createLayerGroup(this.name);
    this.groupId = group.id;
  }
  undo() {
    if (this.groupId) this.layerManager.deleteLayerGroup(this.groupId);
  }
}

class RenameLayerCommand {
  constructor(layerManager, layerId, newName, oldName) {
    this.layerManager = layerManager;
    this.layerId = layerId;
    this.newName = newName;
    this.oldName = oldName;
    this.description = `Rename layer to "${newName}"`;
  }
  execute() { this.layerManager.renameLayer(this.layerId, this.newName); }
  undo() { this.layerManager.renameLayer(this.layerId, this.oldName); }
}

// ─── CommandHistory ─────────────────────────────────────────────────────────

class CommandHistory {
  constructor(maxSteps = 50) {
    this._history = [];
    this._position = -1;
    this._maxSteps = maxSteps;
    this.isExecuting = false;
  }

  execute(cmd) {
    if (this.isExecuting) return;
    this.isExecuting = true;
    try {
      cmd.execute();
      // Truncate any future history
      this._history = this._history.slice(0, this._position + 1);
      this._history.push(cmd);
      if (this._history.length > this._maxSteps) {
        this._history.shift();
      }
      this._position = this._history.length - 1;
      eventBus.emit('history.changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    } finally {
      this.isExecuting = false;
    }
  }

  undo() {
    if (!this.canUndo() || this.isExecuting) return;
    this.isExecuting = true;
    try {
      const cmd = this._history[this._position];
      cmd.undo();
      this._position--;
      eventBus.emit('history.changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    } finally {
      this.isExecuting = false;
    }
  }

  redo() {
    if (!this.canRedo() || this.isExecuting) return;
    this.isExecuting = true;
    try {
      this._position++;
      const cmd = this._history[this._position];
      cmd.execute();
      eventBus.emit('history.changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    } finally {
      this.isExecuting = false;
    }
  }

  canUndo() { return this._position >= 0; }
  canRedo() { return this._position < this._history.length - 1; }

  getUndoDescription() {
    if (!this.canUndo()) return '';
    return this._history[this._position].description || 'Action';
  }

  getRedoDescription() {
    if (!this.canRedo()) return '';
    return this._history[this._position + 1].description || 'Action';
  }

  clear() {
    this._history = [];
    this._position = -1;
    eventBus.emit('history.changed', { canUndo: false, canRedo: false });
  }
}

const commandHistory = new CommandHistory(50);
AppRegistry.register('commandHistory', commandHistory);
