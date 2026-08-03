// js/layer-manager.js — LayerManager (facade over StateManager)

class LayerManager {
  constructor(mapManager) {
    this._mapManager = mapManager;
  }

  get layers() { return stateManager.get('layers'); }
  get layerGroups() { return stateManager.get('layerGroups'); }
  get layerOrder() { return stateManager.get('layerOrder'); }

  // ─── Layer CRUD ────────────────────────────────────────────────────────────

  createLayer(name, features = [], type = 'point', metadata = {}, id = null, options = {}) {
    const layerId = id || Utils.generateId('layer');
    const color = options.color || this._mapManager.getNextColor();

    const layer = {
      id: layerId,
      name,
      type,
      features: [...features],
      visible: options.visible !== undefined ? options.visible : true,
      opacity: options.opacity !== undefined ? options.opacity : AppConfig.layer.defaultOpacity,
      color,
      groupId: null,
      // Property-driven styling: a PropertyService rule ({ mode, property, bins |
      // entries, … }), or a solid rule for a single layer color. An explicit
      // `styleRule` option always wins — including a solid one, so undo restores a
      // deliberate "Solid" choice instead of re-deriving the tier default.
      styleRule: this._normalizeStyleRule(options.styleRule, features),
      // Explicit popup field list, or null to auto-pick (see MapManager.infoFieldsFor).
      infoFields: options.infoFields || null,
      showLabels: options.showLabels || false,
      pinScale: options.pinScale !== undefined ? options.pinScale : 1.0,
      showOnHeatmap: options.showOnHeatmap || false,
      clusterEnabled: options.clusterEnabled !== false,
      metadata: { ...metadata },
      createdAt: options.createdAt || Utils.formatDate()
    };

    this.layers.set(layerId, layer);
    const order = stateManager.get('layerOrder');
    order.push(layerId);
    stateManager.set('layerOrder', order, true);

    // Add to "All Layers" group if it exists
    const allGroupId = stateManager.get('allLayersGroupId');
    if (allGroupId) {
      this.addLayerToGroup(layerId, allGroupId);
    }
    if (options.groupId && options.groupId !== allGroupId) {
      this.addLayerToGroup(layerId, options.groupId);
    }

    // Render on map
    if (features.length > 0) {
      const assignedColor = this._mapManager.addFeaturesToLayer(layerId, features, type, color);
      layer.color = assignedColor;
      if (!layer.visible) {
        this._mapManager.toggleLayerVisibility(layerId, false);
      }
    } else {
      this._mapManager.createDataSource(layerId, type === 'point');
      if (!layer.visible) {
        this._mapManager.toggleLayerVisibility(layerId, false);
      }
    }

    eventBus.emit('layer.created', { layerId, layer });
    return layer;
  }

  addFeaturesToLayer(layerId, newFeatures, featureType = null) {
    const layer = this.layers.get(layerId);
    if (!layer) throw new Error(`Layer not found: ${layerId}`);

    layer.features.push(...newFeatures);

    // Detect mixed types
    const hasPoints = layer.features.some(f => !isNaN(parseFloat(f.latitude)));
    const hasPolygons = layer.features.some(f => f.wkt);
    if (hasPoints && hasPolygons) layer.type = 'mixed';
    else if (hasPolygons) layer.type = 'polygon';
    else if (hasPoints) layer.type = 'point';

    const type = featureType || layer.type;
    this._mapManager.addFeaturesToLayer(layerId, newFeatures, type, layer.color);
    // New features are drawn with the rule already applied, but cluster pins
    // aggregate over the whole layer and must be recomputed.
    if (PropertyService.isRule(layer.styleRule)) {
      this._mapManager.applyLayerStyle(layerId);
    }

    eventBus.emit('features.added', {
      layerId,
      features: newFeatures,
      totalCount: layer.features.length,
      addedCount: newFeatures.length
    });
    return layer;
  }

  deleteLayer(layerId) {
    const layer = this.layers.get(layerId);
    if (!layer) return;

    // Remove from any group
    if (layer.groupId) this.removeLayerFromGroup(layerId);

    this.layers.delete(layerId);
    const order = stateManager.get('layerOrder').filter(id => id !== layerId);
    stateManager.set('layerOrder', order, true);

    this._mapManager.removeLayer(layerId);

    eventBus.emit('layer.deleted', { layerId, layer });
  }

  renameLayer(layerId, newName) {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    const oldName = layer.name;
    layer.name = newName;
    eventBus.emit('layer.renamed', { layerId, newName, oldName });
  }

  getLayer(layerId) {
    return this.layers.get(layerId) || null;
  }

  getAllLayers() {
    return stateManager.getAllLayers();
  }

  toggleLayerVisibility(layerId) {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    layer.visible = !layer.visible;
    this._mapManager.toggleLayerVisibility(layerId, layer.visible);
    eventBus.emit('layer.visibility.changed', { layerId, visible: layer.visible });
  }

  setLayerVisibility(layerId, visible) {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    layer.visible = visible;
    this._mapManager.toggleLayerVisibility(layerId, visible);
    eventBus.emit('layer.visibility.changed', { layerId, visible });
  }

  setLayerOpacity(layerId, opacity) {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    layer.opacity = opacity;
    this._mapManager.setLayerOpacity(layerId, opacity);
    eventBus.emit('layer.opacity.changed', { layerId, opacity });
  }

  setLayerColor(layerId, color) {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    layer.color = color;
    this._mapManager.setLayerColor(layerId, color);
    eventBus.emit('layer.color.changed', { layerId, color });
  }

  // ─── Feature CRUD ──────────────────────────────────────────────────────────

  updateFeature(layerId, featureId, properties) {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    const feature = layer.features.find(f => f.id === featureId);
    if (!feature) return;
    Object.assign(feature, properties);
    // Re-render then restore visual state (visibility + property style)
    this._mapManager.clearLayer(layerId);
    this._mapManager.addFeaturesToLayer(layerId, layer.features, layer.type, layer.color);
    this._restoreLayerState(layer);
    eventBus.emit('feature.updated', { layerId, featureId, properties });
  }

  deleteFeature(layerId, featureId) {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    const idx = layer.features.findIndex(f => f.id === featureId);
    if (idx === -1) return;
    const [feature] = layer.features.splice(idx, 1);
    // Re-render then restore visual state
    this._mapManager.clearLayer(layerId);
    this._mapManager.addFeaturesToLayer(layerId, layer.features, layer.type, layer.color);
    this._restoreLayerState(layer);
    eventBus.emit('feature.deleted', { layerId, featureId, feature });
  }

  moveFeatureToLayer(sourceLayerId, featureId, targetLayerId) {
    const srcLayer = this.layers.get(sourceLayerId);
    const tgtLayer = this.layers.get(targetLayerId);
    if (!srcLayer || !tgtLayer) return;

    const idx = srcLayer.features.findIndex(f => f.id === featureId);
    if (idx === -1) return;
    const [feature] = srcLayer.features.splice(idx, 1);
    tgtLayer.features.push(feature);

    // Re-render both layers then restore visual state for each
    this._mapManager.clearLayer(sourceLayerId);
    this._mapManager.addFeaturesToLayer(sourceLayerId, srcLayer.features, srcLayer.type, srcLayer.color);
    this._restoreLayerState(srcLayer);
    this._mapManager.addFeaturesToLayer(targetLayerId, [feature], tgtLayer.type, tgtLayer.color);
    this._restoreLayerState(tgtLayer);

    eventBus.emit('feature.moved', { sourceLayerId, targetLayerId, featureId, feature });
  }

  // After a full layer re-render (clearLayer + addFeaturesToLayer), re-apply visibility
  // and property-based styling so the layer's logical state matches what's on the map.
  _restoreLayerState(layer) {
    if (!layer.visible) {
      this._mapManager.toggleLayerVisibility(layer.id, false);
    }
    if (PropertyService.isRule(layer.styleRule)) {
      this._mapManager.applyLayerStyle(layer.id);
    }
  }

  // ─── Property-based styling ────────────────────────────────────────────────

  _normalizeStyleRule(rule, features) {
    if (rule === undefined) return this._defaultTierStyle(features || []);
    return PropertyService.isRule(rule) ? rule : PropertyService.solidRule();
  }

  // Tier columns have always been auto-colored with the tier palette. Expressing
  // that as a real style rule (instead of a render-time special case) keeps the
  // familiar look while making it legible in the legend and editable like any
  // other property style.
  _defaultTierStyle(features) {
    const hasTier = features.some(f => f && !PropertyService.isBlank(f.tier));
    if (!hasTier) return PropertyService.solidRule();
    return PropertyService.autoRule(features, 'tier', { mode: 'categorical' })
      || PropertyService.solidRule();
  }

  // Install a PropertyService rule (or a falsy value to go back to a solid layer
  // color) and repaint pins, polygons, and cluster pins.
  setLayerStyleRule(layerId, rule) {
    const layer = this.layers.get(layerId);
    if (!layer) return null;
    const applied = PropertyService.isRule(rule) ? rule : PropertyService.solidRule();
    layer.styleRule = applied;
    this._mapManager.applyLayerStyle(layerId);
    eventBus.emit('layer.style.changed', {
      layerId,
      styleRule: applied,
      styleType: applied.mode
    });
    // null signals "not styled by a property", so callers can detect a no-op.
    return PropertyService.isRule(applied) ? applied : null;
  }

  // Build a rule for `property` straight from the layer's own data — the app-side
  // entry point for "color by this column", including smart numeric grouping.
  autoStyleLayer(layerId, property, opts = {}) {
    const layer = this.layers.get(layerId);
    if (!layer) return null;
    const rule = PropertyService.autoRule(layer.features || [], property, opts);
    if (!rule) return null;
    return this.setLayerStyleRule(layerId, rule);
  }

  clearLayerStyle(layerId) {
    return this.setLayerStyleRule(layerId, null);
  }

  getLayerProperties(layerId) {
    const layer = this.layers.get(layerId);
    return layer ? PropertyService.collectProperties(layer.features || []) : [];
  }

  setLayerInfoFields(layerId, fields) {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    layer.infoFields = (Array.isArray(fields) && fields.length > 0) ? [...fields] : null;
    eventBus.emit('layer.infoFields.changed', { layerId, infoFields: layer.infoFields });
  }

  getFeature(layerId, featureId) {
    const layer = this.layers.get(layerId);
    if (!layer) return null;
    return layer.features.find(f => f.id === featureId) || null;
  }

  // ─── Layer Groups ──────────────────────────────────────────────────────────

  createLayerGroup(name, opts = {}) {
    const id = Utils.generateId('group');
    const group = {
      id,
      name,
      layerIds: [],
      visible: true,
      opacity: 1.0,
      isDefault: opts.isDefault || false,
      createdAt: Utils.formatDate()
    };
    this.layerGroups.set(id, group);
    if (opts.isDefault) {
      stateManager.set('allLayersGroupId', id, true);
    }
    eventBus.emit('group.created', { groupId: id, group });
    return group;
  }

  deleteLayerGroup(groupId) {
    const group = this.layerGroups.get(groupId);
    if (!group || group.isDefault) return;
    group.layerIds.forEach(layerId => {
      const layer = this.layers.get(layerId);
      if (layer) layer.groupId = null;
    });
    this.layerGroups.delete(groupId);
    eventBus.emit('group.deleted', { groupId });
  }

  renameLayerGroup(groupId, name) {
    const group = this.layerGroups.get(groupId);
    if (!group) return;
    const oldName = group.name;
    group.name = name;
    eventBus.emit('group.renamed', { groupId, name, oldName });
  }

  addLayerToGroup(layerId, groupId) {
    const layer = this.layers.get(layerId);
    const group = this.layerGroups.get(groupId);
    if (!layer || !group) return;

    if (layer.groupId && layer.groupId !== groupId) {
      this.removeLayerFromGroup(layerId);
    }

    if (!group.layerIds.includes(layerId)) {
      group.layerIds.push(layerId);
    }
    layer.groupId = groupId;
    eventBus.emit('layer.grouped', { layerId, groupId });
  }

  removeLayerFromGroup(layerId) {
    const layer = this.layers.get(layerId);
    if (!layer || !layer.groupId) return;
    const group = this.layerGroups.get(layer.groupId);
    if (group) {
      group.layerIds = group.layerIds.filter(id => id !== layerId);
    }
    const oldGroupId = layer.groupId;
    layer.groupId = null;
    eventBus.emit('layer.ungrouped', { layerId, groupId: oldGroupId });
  }

  toggleGroupVisibility(groupId, visible) {
    const group = this.layerGroups.get(groupId);
    if (!group) return;
    group.visible = visible;
    group.layerIds.forEach(layerId => this.setLayerVisibility(layerId, visible));
    eventBus.emit('group.visibility.changed', { groupId, visible });
  }

  setGroupOpacity(groupId, opacity) {
    const group = this.layerGroups.get(groupId);
    if (!group) return;
    group.opacity = opacity;
    group.layerIds.forEach(layerId => this.setLayerOpacity(layerId, opacity));
  }

  getAllLayerGroups() {
    return Array.from(this.layerGroups.values());
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  exportAllLayers() {
    const layersObj = {};
    this.layers.forEach((layer, id) => {
      layersObj[id] = { ...layer, features: layer.features.map(f => ({ ...f })) };
    });
    return {
      layers: layersObj,
      layerOrder: [...stateManager.get('layerOrder')]
    };
  }

  importLayers(data) {
    if (!data || !data.layers) return;

    // Clear current map
    this.layers.forEach((_, id) => this._mapManager.removeLayer(id));

    // Rebuild state
    const newLayers = new Map();
    const layers = data.layers;
    const order = data.layerOrder || Object.keys(layers);

    order.forEach(id => {
      if (!layers[id]) return;
      const layer = { ...layers[id], features: layers[id].features || [] };
      this._migrateLegacyStyle(layer);
      newLayers.set(id, layer);
    });

    stateManager.set('layers', newLayers, true);
    stateManager.set('layerOrder', order.filter(id => newLayers.has(id)), true);

    // Re-render all layers
    newLayers.forEach((layer, id) => {
      if (layer.features.length > 0) {
        this._mapManager.addFeaturesToLayer(id, layer.features, layer.type, layer.color);
        if (!layer.visible) this._mapManager.toggleLayerVisibility(id, false);
      }
    });

    // Restore groups if present
    if (data._groups) {
      const groupsMap = new Map();
      data._groups.forEach(g => groupsMap.set(g.id, g));
      stateManager.set('layerGroups', groupsMap, true);
      const allGroupId = data._groups.find(g => g.isDefault)?.id || null;
      stateManager.set('allLayersGroupId', allGroupId, true);
    }

    // Restore layer styling state after import
    newLayers.forEach((layer, id) => {
      if (PropertyService.isRule(layer.styleRule)) {
        this._mapManager.applyLayerStyle(id);
      }
      if (layer.showLabels) {
        this._mapManager.togglePolygonLabels(id, true, layer.features);
      }
    });

    eventBus.emit('layers.imported', { layerCount: newLayers.size });
  }

  // Workspaces saved before property style rules either stored
  // { styleType: 'property', styleProperty } or relied on tier being auto-colored
  // at render time. Both are now expressed as style rules, so rebuild the
  // equivalent rule to keep those layers looking the way they were saved.
  _migrateLegacyStyle(layer) {
    if (layer.styleRule) return;

    if (layer.styleType === 'property' && layer.styleProperty) {
      layer.styleRule = PropertyService.autoRule(layer.features, layer.styleProperty, { mode: 'categorical' })
        || PropertyService.solidRule();
    } else {
      layer.styleRule = this._defaultTierStyle(layer.features);
    }
    delete layer.styleType;
    delete layer.styleProperty;
  }

  moveLayer(layerId, beforeLayerId) {
    const order = [...stateManager.get('layerOrder')];
    const currentIndex = order.indexOf(layerId);
    if (currentIndex === -1) return;
    order.splice(currentIndex, 1);
    const beforeIndex = order.indexOf(beforeLayerId);
    if (beforeIndex === -1) {
      order.push(layerId);
    } else {
      order.splice(beforeIndex, 0, layerId);
    }
    stateManager.set('layerOrder', order, true);
    eventBus.emit('layers.updated', { source: 'reorder' });
  }

  refreshLayerDisplay(layerId) {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    this._mapManager.clearLayer(layerId);
    this._mapManager.addFeaturesToLayer(layerId, layer.features, layer.type, layer.color);
    this._restoreLayerState(layer);
    eventBus.emit('layer.refreshed', { layerId });
  }

  fitToLayer(layerId) {
    this._mapManager.fitBounds([layerId]);
  }

  fitToAll() {
    this._mapManager.fitBounds([]);
  }
}
