// js/controllers/ui-renderer.js — UIRenderer

const UIRenderer = {

  // ─── Layer Tree ───────────────────��─────────────────��───────────────────────

  renderLayerTree() {
    const container = document.getElementById('layerList');
    if (!container) return;

    const layerManager = AppRegistry.require('layerManager');
    const sm = AppRegistry.require('stateManager');
    const layers = layerManager.getAllLayers();
    const groups = layerManager.getAllLayerGroups();

    container.innerHTML = '';
    container.ondragover = (e) => { e.preventDefault(); };
    container.ondrop = (e) => {
      e.preventDefault();
      const draggedLayerId = e.dataTransfer?.getData('text/plain');
      if (!draggedLayerId) return;
      layerManager.moveLayer(draggedLayerId, null);
    };

    if (layers.length === 0) {
      const empty = Utils.createElement('div', { className: 'layer-list-empty' });
      empty.textContent = 'No layers yet. Import a CSV to get started.';
      container.appendChild(empty);
      return;
    }

    const activeFilter = sm.get('activeGroupFilter');

    // Render groups (non-default first)
    const nonDefaultGroups = groups.filter(g => !g.isDefault && g.layerIds.length > 0);
    const defaultGroupId = sm.get('allLayersGroupId');
    const expandedGroups = sm.get('expandedGroups');

    // When a group filter is active, show filtered layers directly
    if (activeFilter) {
      const group = groups.find(g => g.id === activeFilter);
      if (group) {
        const filterBar = Utils.createElement('div', { className: 'active-filter-bar' });
        const filterLabel = Utils.createElement('span');
        filterLabel.textContent = `Showing: ${group.name}`;
        const clearBtn = Utils.createElement('button', { className: 'btn-icon', title: 'Show all' }, '×');
        clearBtn.addEventListener('click', () => {
          sm.set('activeGroupFilter', null);
          this.renderLayerTree();
        });
        filterBar.appendChild(filterLabel);
        filterBar.appendChild(clearBtn);
        container.appendChild(filterBar);
      }
    }

    // Group sections
    nonDefaultGroups.forEach(group => {
      if (activeFilter && group.id !== activeFilter) return;
      const groupEl = this._buildGroupElement(group, layerManager, sm, expandedGroups);
      container.appendChild(groupEl);
    });

    // Ungrouped layers (or all layers if no filter)
    const ungroupedLayers = layers.filter(l => {
      if (activeFilter) {
        const group = groups.find(g => g.id === activeFilter);
        return group ? group.layerIds.includes(l.id) : false;
      }
      // Ungrouped = not in any non-default group
      const inNonDefault = nonDefaultGroups.some(g => g.layerIds.includes(l.id));
      return !inNonDefault;
    });

    if (ungroupedLayers.length > 0 && !activeFilter) {
      const ungroupedTitle = Utils.createElement('div', { className: 'layer-section-title' }, 'Layers');
      container.appendChild(ungroupedTitle);
    }

    ungroupedLayers.forEach(layer => {
      container.appendChild(this._buildLayerElement(layer, layerManager, sm));
    });
  },

  _buildGroupElement(group, layerManager, sm, expandedGroups) {
    const isExpanded = !expandedGroups || expandedGroups.has(group.id) || expandedGroups.size === 0;

    const el = Utils.createElement('div', { className: 'layer-group' });
    const header = Utils.createElement('div', { className: 'group-header' });

    const arrow = Utils.createElement('span', { className: `group-arrow ${isExpanded ? 'expanded' : ''}` }, isExpanded ? '▾' : '▸');
    const visBtn = Utils.createElement('button', { className: `layer-vis-btn ${group.visible ? '' : 'hidden'}`, title: 'Toggle group visibility' });
    visBtn.textContent = group.visible ? '👁' : '🚫';
    visBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      layerManager.toggleGroupVisibility(group.id, !group.visible);
      this.renderLayerTree();
    });

    const nameEl = Utils.createElement('span', { className: 'group-name' });
    nameEl.textContent = group.name;

    const countEl = Utils.createElement('span', { className: 'group-count' });
    countEl.textContent = `${group.layerIds.length}`;

    const menuBtn = Utils.createElement('button', { className: 'layer-menu-btn', title: 'Group options' }, '⋯');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showGroupContextMenu(e, group, layerManager);
    });

    header.appendChild(arrow);
    header.appendChild(visBtn);
    header.appendChild(nameEl);
    header.appendChild(countEl);
    header.appendChild(menuBtn);

    header.addEventListener('click', () => {
      const expanded = sm.get('expandedGroups') || new Set();
      if (expanded.has(group.id)) expanded.delete(group.id);
      else expanded.add(group.id);
      sm.set('expandedGroups', expanded, true);
      this.renderLayerTree();
    });

    el.appendChild(header);

    if (isExpanded) {
      const layerContainer = Utils.createElement('div', { className: 'group-layers' });
      group.layerIds.forEach(layerId => {
        const layer = layerManager.getLayer(layerId);
        if (layer) layerContainer.appendChild(this._buildLayerElement(layer, layerManager, sm));
      });
      el.appendChild(layerContainer);
    }

    return el;
  },

  _expandedLayers: new Set(),

  _buildLayerElement(layer, layerManager, sm) {
    const isTarget = sm.get('targetLayerForNewFeature') === layer.id;
    const isExpanded = this._expandedLayers.has(layer.id);
    const features = layer.features || [];

    const wrapper = Utils.createElement('div', { className: 'layer-item-wrapper', 'data-layer-id': layer.id });

    const el = Utils.createElement('div', { className: `layer-item${isTarget ? ' draw-target' : ''}` });

    // Expand/collapse arrow (only meaningful when there are features)
    const expandBtn = Utils.createElement('button', {
      className: `layer-expand-btn${isExpanded ? ' expanded' : ''}`,
      title: isExpanded ? 'Collapse features' : 'Expand features'
    }, isExpanded ? '▾' : '▸');
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._expandedLayers.has(layer.id)) {
        this._expandedLayers.delete(layer.id);
      } else {
        this._expandedLayers.add(layer.id);
      }
      this.renderLayerTree();
    });

    const visBtn = Utils.createElement('button', { className: `layer-vis-btn ${layer.visible ? '' : 'hidden'}`, title: 'Toggle visibility' });
    visBtn.textContent = layer.visible ? '👁' : '🚫';
    visBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      layerManager.toggleLayerVisibility(layer.id);
    });

    const colorSwatch = Utils.createElement('div', { className: 'layer-color-swatch', title: 'Click to change color' });
    colorSwatch.style.background = layer.color || '#ccc';
    colorSwatch.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showColorPicker(layer, layerManager);
    });

    const info = Utils.createElement('div', { className: 'layer-info' });
    const nameEl = Utils.createElement('div', { className: 'layer-name' });
    nameEl.textContent = layer.name;
    const meta = Utils.createElement('div', { className: 'layer-meta' });
    meta.textContent = `${features.length} features · ${layer.type}`;
    info.appendChild(nameEl);
    info.appendChild(meta);

    const menuBtn = Utils.createElement('button', { className: 'layer-menu-btn', title: 'Layer options' }, '⋯');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showLayerContextMenu(e, layer, layerManager, sm);
    });

    el.appendChild(expandBtn);
    el.appendChild(visBtn);
    el.appendChild(colorSwatch);
    el.appendChild(info);
    el.appendChild(menuBtn);

    // Click layer name area to fit bounds
    info.addEventListener('click', () => {
      layerManager.fitToLayer(layer.id);
    });

    // Drag to reorder
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', layer.id);
        e.dataTransfer.effectAllowed = 'move';
      }
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const draggedLayerId = e.dataTransfer?.getData('text/plain');
      if (!draggedLayerId || draggedLayerId === layer.id) return;
      this._moveLayerBefore(draggedLayerId, layer.id);
    });

    wrapper.appendChild(el);

    // Feature list panel (shown when expanded)
    if (isExpanded) {
      wrapper.appendChild(this._buildFeatureList(layer, layerManager));
    }

    return wrapper;
  },

  _buildFeatureList(layer, layerManager) {
    const container = Utils.createElement('div', { className: 'layer-features' });

    const features = layer.features || [];
    if (features.length === 0) {
      const empty = Utils.createElement('div', { className: 'layer-features-empty' }, 'No features in this layer');
      container.appendChild(empty);
      return container;
    }

    features.forEach(feature => {
      const row = Utils.createElement('div', { className: 'feature-row' });

      const icon = Utils.createElement('span', { className: 'feature-row-icon' });
      icon.textContent = feature.wkt ? '⬡' : '●';

      const nameEl = Utils.createElement('span', { className: 'feature-row-name' });
      nameEl.textContent = feature.name || feature.id || 'Untitled';
      nameEl.title = feature.name || '';

      const editBtn = Utils.createElement('button', { className: 'feature-row-btn', title: 'Edit feature' }, '✎');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        drawerManager.open(
          body => UIRenderer.renderFeatureInfo(feature, body, layer.id),
          `Feature: ${feature.name || 'Untitled'}`
        );
      });

      const deleteBtn = Utils.createElement('button', { className: 'feature-row-btn feature-row-btn-danger', title: 'Delete feature' }, '✕');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${feature.name || 'this feature'}"?`)) {
          const ch = AppRegistry.require('commandHistory');
          ch.execute(new DeleteFeatureCommand(layerManager, layer.id, feature.id));
          AppRegistry.require('syncController').scheduleSave();
        }
      });

      row.appendChild(icon);
      row.appendChild(nameEl);
      row.appendChild(editBtn);
      row.appendChild(deleteBtn);
      container.appendChild(row);
    });

    return container;
  },

  _moveLayerBefore(draggedLayerId, targetLayerId) {
    const layerManager = AppRegistry.require('layerManager');
    layerManager.moveLayer(draggedLayerId, targetLayerId);
  },

  _showLayerContextMenu(e, layer, layerManager, sm) {
    // Build a temporary context menu
    let menu = document.getElementById('layerContextMenu');
    if (!menu) {
      menu = Utils.createElement('div', { className: 'context-menu', id: 'layerContextMenu' });
      document.body.appendChild(menu);
    }
    menu.innerHTML = '';

    const items = [
      { label: 'Rename', action: () => this._promptRenameLayer(layer, layerManager) },
      { label: 'Style Layer', action: () => eventBus.emit('layer.styler.open', { layerId: layer.id }) },
      { label: 'Zoom to Layer', action: () => layerManager.fitToLayer(layer.id) },
      { label: 'Set as Draw Target', action: () => { sm.set('targetLayerForNewFeature', layer.id); this.renderLayerTree(); toastManager.info(`Draw target: "${layer.name}"`); } },
      { label: 'Toggle Labels', action: () => this._toggleLayerLabels(layer, layerManager) },
      { label: 'Export Layer', action: () => this._exportLayer(layer) },
      { label: '── Groups ──', action: null },
      { label: 'Create Group from Layer', action: () => this._createGroupFromLayer(layer, layerManager) },
      { label: '── Danger ──', action: null },
      { label: 'Delete Layer', action: () => this._confirmDeleteLayer(layer, layerManager), className: 'danger' }
    ];

    items.forEach(({ label, action, className }) => {
      if (!action) {
        menu.appendChild(Utils.createElement('div', { className: 'context-menu-separator' }, label));
        return;
      }
      const item = Utils.createElement('div', { className: `context-menu-item${className ? ` ${className}` : ''}` });
      item.textContent = label;
      item.addEventListener('click', () => {
        contextMenuManager.hide();
        action();
      });
      menu.appendChild(item);
    });

    contextMenuManager.show('layerContextMenu', e.clientX, e.clientY);
  },

  _showGroupContextMenu(e, group, layerManager) {
    let menu = document.getElementById('groupContextMenu');
    if (!menu) {
      menu = Utils.createElement('div', { className: 'context-menu', id: 'groupContextMenu' });
      document.body.appendChild(menu);
    }
    menu.innerHTML = '';

    const items = [
      { label: 'Rename Group', action: () => this._promptRenameGroup(group, layerManager) },
      { label: 'Zoom to Group', action: () => { const lm = AppRegistry.require('layerManager'); lm._mapManager.fitBounds(group.layerIds); } },
      { label: 'Filter to Group', action: () => { AppRegistry.require('stateManager').set('activeGroupFilter', group.id); this.renderLayerTree(); } },
      { label: 'Delete Group', action: () => layerManager.deleteLayerGroup(group.id), className: 'danger' }
    ];

    items.forEach(({ label, action, className }) => {
      const item = Utils.createElement('div', { className: `context-menu-item${className ? ` ${className}` : ''}` });
      item.textContent = label;
      item.addEventListener('click', () => {
        contextMenuManager.hide();
        if (action) action();
      });
      menu.appendChild(item);
    });

    contextMenuManager.show('groupContextMenu', e.clientX, e.clientY);
  },

  _promptRenameLayer(layer, layerManager) {
    const newName = prompt('Rename layer:', layer.name);
    if (newName && newName.trim() && newName.trim() !== layer.name) {
      const ch = AppRegistry.require('commandHistory');
      ch.execute(new RenameLayerCommand(layerManager, layer.id, newName.trim(), layer.name));
      AppRegistry.require('syncController').scheduleSave();
    }
  },

  _promptRenameGroup(group, layerManager) {
    const newName = prompt('Rename group:', group.name);
    if (newName && newName.trim()) {
      layerManager.renameLayerGroup(group.id, newName.trim());
      AppRegistry.require('syncController').scheduleSave();
    }
  },

  _confirmDeleteLayer(layer, layerManager) {
    if (confirm(`Delete layer "${layer.name}" and all its features? This cannot be undone.`)) {
      const ch = AppRegistry.require('commandHistory');
      ch.execute(new DeleteLayerCommand(layerManager, layer.id));
      AppRegistry.require('syncController').scheduleSave();
    }
  },

  _toggleLayerLabels(layer, layerManager) {
    const newState = !layer.showLabels;
    layer.showLabels = newState;
    const mm = AppRegistry.require('mapManager');
    mm.togglePolygonLabels(layer.id, newState, layer.features);
  },

  _createGroupFromLayer(layer, layerManager) {
    const name = prompt('Group name:', layer.name + ' Group');
    if (!name) return;
    const ch = AppRegistry.require('commandHistory');
    const cmd = new CreateGroupCommand(layerManager, name);
    ch.execute(cmd);
    if (cmd.groupId) layerManager.addLayerToGroup(layer.id, cmd.groupId);
    AppRegistry.require('syncController').scheduleSave();
  },

  _exportLayer(layer) {
    const features = layer.features || [];
    if (features.length === 0) { toastManager.warning('No features to export'); return; }

    // Build headers from all keys present across every feature so custom CSV
    // columns imported from the file are preserved in the export.
    const systemFirst = ['id', 'name', 'latitude', 'longitude', 'wkt', 'tier', 'bdm', 'revenue', 'description'];
    const extraKeys = new Set();
    features.forEach(f => {
      Object.keys(f).forEach(k => {
        if (!systemFirst.includes(k) && !k.startsWith('_')) extraKeys.add(k);
      });
    });
    const headers = [...systemFirst, ...extraKeys];

    const rows = [headers.map(h => `"${h}"`).join(',')];
    features.forEach(f => {
      rows.push(headers.map(h => `"${String(f[h] !== null && f[h] !== undefined ? f[h] : '').replace(/"/g, '""')}"`).join(','));
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${Utils.toSafeId(layer.name)}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  _showColorPicker(layer, layerManager) {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = layer.color || '#0078d4';
    input.addEventListener('input', () => {
      layerManager.setLayerColor(layer.id, input.value);
    });
    input.addEventListener('change', () => {
      AppRegistry.require('syncController').scheduleSave();
    });
    input.click();
  },

  // ─── Feature Info ─────────────────────────���───────────────────────���─────────

  renderFeatureInfo(feature, container, layerId) {
    const body = container || drawerManager._bodyEl;
    if (!body) {
      if (!container) {
        drawerManager.open(b => this.renderFeatureInfo(feature, b, layerId), `Feature: ${feature.name || 'Untitled'}`);
      }
      return;
    }

    body.innerHTML = '';

    const form = Utils.createElement('form', { className: 'feature-edit-form', id: 'featureEditForm' });

    // Standard editable fields
    const editableFields = ['name', 'description', 'tier', 'bdm', 'revenue'];
    editableFields.forEach(field => {
      if (feature[field] === undefined && !['name','description'].includes(field)) return;
      const group = Utils.createElement('div', { className: 'form-group' });
      const label = Utils.createElement('label', { className: 'form-label' });
      label.textContent = field.charAt(0).toUpperCase() + field.slice(1);

      let input;
      if (field === 'tier') {
        input = Utils.createElement('select', { className: 'form-control', name: field });
        ['', '1', '2', '3'].forEach(v => {
          const opt = Utils.createElement('option', { value: v }, v ? `Tier ${v}` : '— Select Tier —');
          if (String(feature[field]) === v) opt.selected = true;
          input.appendChild(opt);
        });
      } else if (field === 'description') {
        input = Utils.createElement('textarea', { className: 'form-control', name: field, rows: '3' });
        input.textContent = feature[field] || '';
      } else {
        input = Utils.createElement('input', { type: field === 'revenue' ? 'number' : 'text', className: 'form-control', name: field });
        input.value = feature[field] !== undefined ? feature[field] : '';
      }
      group.appendChild(label);
      group.appendChild(input);
      form.appendChild(group);
    });

    // Read-only properties
    const systemProps = new Set(AppConfig.featureInfo.systemProperties.concat(['name','description','tier','bdm','revenue']));
    const extraProps = Object.keys(feature).filter(k => !systemProps.has(k) && !k.startsWith('_'));
    if (extraProps.length > 0) {
      const extraSection = Utils.createElement('div', { className: 'feature-extra-props' });
      const extraTitle = Utils.createElement('div', { className: 'extra-props-title' }, 'Additional Properties');
      extraSection.appendChild(extraTitle);
      extraProps.forEach(key => {
        const row = Utils.createElement('div', { className: 'extra-prop-row' });
        const k = Utils.createElement('span', { className: 'extra-prop-key' });
        k.textContent = key + ':';
        const v = Utils.createElement('span', { className: 'extra-prop-value' });
        v.textContent = String(feature[key] !== null && feature[key] !== undefined ? feature[key] : '');
        row.appendChild(k);
        row.appendChild(v);
        extraSection.appendChild(row);
      });
      form.appendChild(extraSection);
    }

    // Location info
    if (feature.latitude && feature.longitude) {
      const locRow = Utils.createElement('div', { className: 'feature-location' });
      const locText = Utils.createElement('span', { className: 'feature-location-text' });
      locText.textContent = `${parseFloat(feature.latitude).toFixed(5)}, ${parseFloat(feature.longitude).toFixed(5)}`;
      locRow.appendChild(locText);
      form.appendChild(locRow);
    }

    body.appendChild(form);

    // Action buttons
    const btnRow = Utils.createElement('div', { className: 'feature-action-row' });

    // Edit Shape (polygons only)
    if (feature.wkt && feature.wkt.trim()) {
      const editShapeBtn = Utils.createElement('button', { type: 'button', className: 'btn btn-secondary' }, 'Edit Shape');
      editShapeBtn.addEventListener('click', () => {
        const targetLayerId = layerId || feature._layerId;
        if (!targetLayerId) { toastManager.error('Cannot determine layer for this feature'); return; }
        this._startShapeEdit(feature, targetLayerId);
      });
      btnRow.appendChild(editShapeBtn);
    }

    const saveBtn = Utils.createElement('button', { type: 'button', className: 'btn btn-primary' }, 'Save');
    saveBtn.addEventListener('click', () => {
      const inputs = form.querySelectorAll('input, select, textarea');
      const updates = {};
      inputs.forEach(inp => {
        if (inp.name) updates[inp.name] = inp.tagName === 'INPUT' && inp.type === 'number'
          ? (inp.value !== '' ? parseFloat(inp.value) : null)
          : inp.value;
      });

      const targetLayerId = layerId || feature._layerId || AppRegistry.require('stateManager').get('targetLayerForNewFeature');
      if (!targetLayerId) { toastManager.error('Cannot determine layer for this feature'); return; }

      const lm = AppRegistry.require('layerManager');
      const ch = AppRegistry.require('commandHistory');
      const oldProps = {};
      editableFields.forEach(f => { oldProps[f] = feature[f]; });
      ch.execute(new UpdateFeatureCommand(lm, targetLayerId, feature.id, updates, oldProps));
      AppRegistry.require('syncController').scheduleSave();
      toastManager.success('Feature saved');
      drawerManager.close();
    });

    const deleteBtn = Utils.createElement('button', { type: 'button', className: 'btn btn-danger' }, 'Delete');
    deleteBtn.addEventListener('click', () => {
      const targetLayerId = layerId || feature._layerId;
      if (!targetLayerId) return;
      if (confirm(`Delete feature "${feature.name || 'this feature'}"?`)) {
        const lm = AppRegistry.require('layerManager');
        const ch = AppRegistry.require('commandHistory');
        ch.execute(new DeleteFeatureCommand(lm, targetLayerId, feature.id));
        AppRegistry.require('syncController').scheduleSave();
        drawerManager.close();
      }
    });

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(deleteBtn);
    body.appendChild(btnRow);

    if (!container) {
      drawerManager.setTitle(`Feature: ${feature.name || 'Untitled'}`);
    }
  },

  // ─── Polygon shape editing ──────────────────────────────────────────────

  _startShapeEdit(feature, layerId) {
    const mm = AppRegistry.require('mapManager');
    const polygon = mm.enableShapeEdit(layerId, feature.id);
    if (!polygon) {
      toastManager.error('Could not start shape editing for this feature');
      return;
    }

    drawerManager.close();
    mm.infoWindow?.close();

    // Build a floating control bar
    let bar = document.getElementById('shapeEditBar');
    if (!bar) {
      bar = Utils.createElement('div', { id: 'shapeEditBar', className: 'shape-edit-bar' });
      document.getElementById('mapContainer')?.appendChild(bar);
    }
    bar.innerHTML = '';
    bar.style.display = 'flex';

    const hint = Utils.createElement('span', { className: 'shape-edit-hint' });
    hint.textContent = 'Drag vertices to reshape · Drag midpoints to add new vertices';

    const saveBtn = Utils.createElement('button', { className: 'btn btn-primary btn-sm' }, 'Save Shape');
    const cancelBtn = Utils.createElement('button', { className: 'btn btn-secondary btn-sm' }, 'Cancel');

    const cleanup = () => {
      bar.style.display = 'none';
      bar.innerHTML = '';
    };

    saveBtn.addEventListener('click', () => {
      const result = mm.commitShapeEdit();
      if (!result) {
        toastManager.error('Shape needs at least 3 points');
        return;
      }
      const lm = AppRegistry.require('layerManager');
      const ch = AppRegistry.require('commandHistory');
      const oldProps = { wkt: feature.wkt, latitude: feature.latitude, longitude: feature.longitude };
      ch.execute(new UpdateFeatureCommand(lm, layerId, feature.id, result, oldProps));
      AppRegistry.require('syncController').scheduleSave();
      toastManager.success('Shape updated');
      cleanup();
    });

    cancelBtn.addEventListener('click', () => {
      mm.cancelShapeEdit();
      cleanup();
    });

    bar.appendChild(hint);
    bar.appendChild(saveBtn);
    bar.appendChild(cancelBtn);
  },

  // ─── Analytics Tab ───────────────���─────────────────────────────���───────────

  renderAnalyticsTab() {
    const ap = AppRegistry.get('analyticsPanel');
    if (ap) ap.render();
  },

  // ─── Plugins Modal ──────────────────────────────────────────────────────────

  renderPluginsModal() {
    const container = document.getElementById('pluginsList');
    if (!container) return;
    container.innerHTML = '';

    const pm = AppRegistry.require('pluginManager');
    const statuses = pm.getAllStatus();

    if (statuses.length === 0) {
      container.appendChild(Utils.createElement('p', { className: 'no-plugins-msg' }, 'No plugins loaded.'));
      return;
    }

    statuses.forEach(({ id, name, version, enabled }) => {
      const card = Utils.createElement('div', { className: `plugin-card ${enabled ? 'enabled' : 'disabled'}` });

      const cardHeader = Utils.createElement('div', { className: 'plugin-card-header' });
      const nameEl = Utils.createElement('span', { className: 'plugin-name' });
      nameEl.textContent = name;
      const versionEl = Utils.createElement('span', { className: 'plugin-version' });
      versionEl.textContent = `v${version}`;
      cardHeader.appendChild(nameEl);
      cardHeader.appendChild(versionEl);

      const def = AppRegistry.require('pluginRegistry').getDefinition(id);
      if (def && def.description) {
        const desc = Utils.createElement('div', { className: 'plugin-desc' });
        desc.textContent = def.description;
        card.appendChild(cardHeader);
        card.appendChild(desc);
      } else {
        card.appendChild(cardHeader);
      }

      const actions = Utils.createElement('div', { className: 'plugin-actions' });
      const toggleBtn = Utils.createElement('button', { className: 'btn btn-sm btn-secondary' });
      toggleBtn.textContent = enabled ? 'Disable' : 'Enable';
      toggleBtn.addEventListener('click', () => {
        if (enabled) pm.disable(id); else pm.enable(id);
        // Persist
        const states = storageService.get('pluginStates') || {};
        states[id] = !enabled;
        storageService.set('pluginStates', states);
        this.renderPluginsModal();
      });

      if (def && def.configSchema && Object.keys(def.configSchema).length > 0) {
        const settingsBtn = Utils.createElement('button', { className: 'btn btn-sm btn-secondary' }, 'Settings');
        settingsBtn.addEventListener('click', () => {
          const settingsUI = pm.buildSettingsUI(id);
          if (settingsUI) {
            drawerManager.open(body => body.appendChild(settingsUI), `${name} Settings`);
            modalManager.close('pluginsModal');
          }
        });
        actions.appendChild(settingsBtn);
      }

      actions.appendChild(toggleBtn);
      card.appendChild(actions);
      container.appendChild(card);
    });
  },

  // ─── History Buttons ────────────────────────────────────────────────────────

  updateHistoryButtons() {
    const ch = AppRegistry.get('commandHistory');
    if (!ch) return;

    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');

    if (undoBtn) {
      undoBtn.disabled = !ch.canUndo();
      undoBtn.title = ch.canUndo() ? `Undo: ${ch.getUndoDescription()}` : 'Nothing to undo';
    }
    if (redoBtn) {
      redoBtn.disabled = !ch.canRedo();
      redoBtn.title = ch.canRedo() ? `Redo: ${ch.getRedoDescription()}` : 'Nothing to redo';
    }
  }
};

AppRegistry.register('uiRenderer', UIRenderer);
