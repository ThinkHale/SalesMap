// js/app.js — Application Coordinator (thin entry point)

// Called by Google Maps API after load
async function initMap() {
  try {
    loadingManager.show('Initializing...');

    // 1. Initialize Firebase and authenticate
    const firebaseManager = AppRegistry.require('firebaseManager');
    await firebaseManager.initialize();

    // 2. Initialize map
    const mapManager = new MapManager('googleMap');
    await mapManager.initialize();
    AppRegistry.register('mapManager', mapManager);

    // 3. Initialize services that need mapManager
    const layerManager = new LayerManager(mapManager);
    AppRegistry.register('layerManager', layerManager);

    const csvParserInstance = AppRegistry.require('csvParser'); // already registered
    const geocodingServiceInstance = AppRegistry.require('geocodingService'); // already registered

    const chInstance = new CommandHistory(50);
    AppRegistry.register('commandHistory', chInstance);

    const analyticsPanel = new AnalyticsPanel(layerManager, stateManager);
    AppRegistry.register('analyticsPanel', analyticsPanel);

    const clusterManager = new ClusterManager(mapManager.map, mapManager);
    AppRegistry.register('clusterManager', clusterManager);

    // Append clustering toggle to layers toolbar
    const clusterPanel = clusterManager.renderSettingsPanel();
    document.querySelector('.sidebar-toolbar')?.appendChild(clusterPanel);

    const distanceTool = new DistanceTool(mapManager);
    AppRegistry.register('distanceTool', distanceTool);

    const activityLog = new ActivityLog(stateManager);
    AppRegistry.register('activityLog', activityLog);

    const notificationCenter = new NotificationCenter();
    AppRegistry.register('notificationCenter', notificationCenter);

    // 4. Initialize features
    analyticsPanel.initialize();
    activityLog.initialize();
    notificationCenter.initialize();

    // 5. Initialize plugins
    pluginRegistry.getAllDefinitions().forEach(def => {
      try {
        pluginManager.initialize(def.id);
      } catch (e) {
        AppErrorHandler.handle(e, `plugin.init:${def.id}`);
      }
    });
    restorePluginStates();

    // 6. Wire map callbacks
    mapManager.setOnFeatureClick(({ properties: feature, layerId }) => {
      stateManager.set('currentEditingFeature', feature);
      drawerManager.open(body => UIRenderer.renderFeatureInfo(feature, body, layerId), `Feature: ${feature.name || 'Untitled'}`);
      eventBus.emit('feature.selected', { feature, layerId });
    });

    mapManager.setOnDrawComplete(shape => DrawingController.handleDrawComplete(shape));

    // 7. Register event subscriptions
    setupEventBusSubscriptions();

    // 8. Register DOM event listeners
    setupDOMEventListeners();

    // 9. Initialize profiles and load data
    await ProfileController.initialize();

    // 10. Start real-time sync
    SyncController.enableRealtimeSync();

    // 11. Initial render
    UIRenderer.renderLayerTree();
    UIRenderer.updateHistoryButtons();

    // 12. Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {/* offline-first not critical */});
    }

    loadingManager.hide();
    toastManager.success('Ready. Upload a CSV or draw to get started.');

  } catch (err) {
    loadingManager.forceHide();
    AppErrorHandler.handle(err, 'initMap');
    toastManager.error('Failed to initialize. Check your API keys in config.js.');
  }
}

// ─── Event Bus Subscriptions ────────────────────────────────────────────────
function setupEventBusSubscriptions() {
  const layerTreeEvents = [
    'layer.created', 'layer.deleted', 'layer.renamed', 'layer.visibility.changed',
    'layer.color.changed', 'layer.opacity.changed',
    'features.added', 'feature.updated', 'feature.deleted', 'feature.moved',
    'group.created', 'group.deleted', 'group.renamed', 'layer.grouped', 'layer.ungrouped',
    'group.visibility.changed', 'layers.updated', 'layers.imported'
  ];
  layerTreeEvents.forEach(e => eventBus.on(e, () => UIRenderer.renderLayerTree()));

  eventBus.on('history.changed', () => UIRenderer.updateHistoryButtons());

  eventBus.on('feature.deleted', () => {
    if (drawerManager.isOpen()) drawerManager.close();
  });

  // Schedule save after any data-mutating event
  const saveEvents = [
    'layer.created', 'layer.deleted', 'features.added',
    'feature.updated', 'feature.deleted', 'layer.renamed',
    'layer.grouped', 'layer.ungrouped', 'group.created', 'group.deleted',
    'layer.color.changed'
  ];
  saveEvents.forEach(e => eventBus.on(e, () => SyncController.scheduleSave()));
}

// ─── DOM Event Listeners ────────────────────────────────────────────────────
function setupDOMEventListeners() {
  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', e => {
    // Undo: Ctrl+Z / Cmd+Z
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
    }
    // Redo: Ctrl+Y / Ctrl+Shift+Z / Cmd+Shift+Z
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      handleRedo();
    }
    // Command palette: Ctrl+K / Cmd+K
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openCommandPalette();
    }
    // Close drawer: Escape
    if (e.key === 'Escape') {
      if (drawerManager.isOpen()) {
        drawerManager.close();
      }
      const dm = stateManager.get('drawingMode');
      if (dm) DrawingController.cancelDrawing();
    }
  });

  // ── File upload ──
  const fileInput = document.getElementById('csvFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        await ImportController.handleFileSelected(file);
        fileInput.value = '';
      }
    });
  }

  const uploadBtn = document.getElementById('uploadBtn');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', () => {
      document.getElementById('csvFileInput')?.click();
    });
  }

  // ── Paste import ──
  const pasteImportBtn = document.getElementById('pasteImportBtn');
  if (pasteImportBtn) {
    pasteImportBtn.addEventListener('click', () => {
      drawerManager.open(body => {
        const wrapper = Utils.createElement('div', { className: 'paste-import-wrapper' });
        const lbl = Utils.createElement('label', { className: 'form-label' }, 'Paste CSV data:');
        const ta = Utils.createElement('textarea', { className: 'form-control paste-textarea', rows: '12', placeholder: 'Paste CSV content here...' });
        const importBtn = Utils.createElement('button', { className: 'btn btn-primary', style: { marginTop: '12px' } }, 'Import Pasted Data');
        importBtn.addEventListener('click', () => ImportController.handlePastedText(ta.value));
        wrapper.appendChild(lbl);
        wrapper.appendChild(ta);
        wrapper.appendChild(importBtn);
        body.appendChild(wrapper);
      }, 'Import from Clipboard');
    });
  }

  // ── Undo/Redo buttons ──
  document.getElementById('undoBtn')?.addEventListener('click', handleUndo);
  document.getElementById('redoBtn')?.addEventListener('click', handleRedo);

  // ── Drawing tools ──
  document.getElementById('drawPointBtn')?.addEventListener('click', () => {
    DrawingController.startDrawing('point');
    document.getElementById('cancelDrawBtn')?.style && (document.getElementById('cancelDrawBtn').style.display = '');
  });
  document.getElementById('drawPolygonBtn')?.addEventListener('click', () => {
    DrawingController.startDrawing('polygon');
    document.getElementById('cancelDrawBtn')?.style && (document.getElementById('cancelDrawBtn').style.display = '');
  });
  document.getElementById('cancelDrawBtn')?.addEventListener('click', () => {
    DrawingController.cancelDrawing();
    document.getElementById('cancelDrawBtn').style.display = 'none';
  });

  // Hide cancel button when drawing completes or is cancelled via Escape
  eventBus.on('feature.created', () => {
    const btn = document.getElementById('cancelDrawBtn');
    if (btn) btn.style.display = 'none';
  });

  // ── Distance/Measure tool ──
  document.getElementById('distanceToolBtn')?.addEventListener('click', () => {
    const dt = AppRegistry.get('distanceTool');
    if (dt) dt.toggle();
  });

  // ── Profile management ──
  const profileSelect = document.getElementById('profileSelect');
  if (profileSelect) {
    profileSelect.addEventListener('change', async () => {
      const sm = stateManager.getCurrentProfile();
      const selected = profileSelect.options[profileSelect.selectedIndex];
      if (sm && selected.value !== sm.id) {
        await ProfileController.switchProfile(selected.value, selected.textContent);
      }
    });
  }

  document.getElementById('newProfileBtn')?.addEventListener('click', () => {
    const name = prompt('New workspace name:');
    if (name) ProfileController.createProfile(name);
  });

  document.getElementById('deleteProfileBtn')?.addEventListener('click', () => {
    const profile = ProfileController.getCurrentProfile();
    if (profile) ProfileController.deleteProfile(profile.id);
  });

  // ── Toolbar / Sidebar tabs ──
  document.querySelectorAll('.sidebar-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.sidebar-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sidebar-tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const content = document.getElementById(`tab-${tab}`);
      if (content) content.classList.add('active');
      if (tab === 'analytics') UIRenderer.renderAnalyticsTab();
    });
  });

  // ── Map controls ──
  document.getElementById('zoomInBtn')?.addEventListener('click', () => AppRegistry.get('mapManager')?.zoomIn());
  document.getElementById('zoomOutBtn')?.addEventListener('click', () => AppRegistry.get('mapManager')?.zoomOut());
  document.getElementById('resetViewBtn')?.addEventListener('click', () => AppRegistry.get('mapManager')?.resetView());
  document.getElementById('fitAllBtn')?.addEventListener('click', () => AppRegistry.get('layerManager')?.fitToAll());

  // ── New Layer ──
  document.getElementById('newLayerBtn')?.addEventListener('click', () => {
    const name = prompt('Layer name:', 'New Layer');
    if (!name || !name.trim()) return;
    const lm = AppRegistry.require('layerManager');
    const ch = AppRegistry.require('commandHistory');
    const cmd = new CreateLayerCommand(lm, name.trim(), [], 'point', {});
    ch.execute(cmd);
    // Auto-set as draw target so the user can immediately start drawing
    stateManager.set('targetLayerForNewFeature', cmd.layerId);
    SyncController.scheduleSave();
    toastManager.success(`Layer "${name.trim()}" created. Draw target set — use Point or Polygon to add features.`);
  });

  // ── Search ──
  const searchInput = document.getElementById('mapSearchInput');
  const searchBtn = document.getElementById('mapSearchBtn');
  if (searchInput && searchBtn) {
    const doSearch = async () => {
      const query = searchInput.value.trim();
      if (!query) return;
      try {
        const result = await AppRegistry.require('geocodingService').searchAddress(query);
        const mm = AppRegistry.require('mapManager');
        mm.addSearchMarker(result.lat, result.lng, result.formattedAddress);
        if (result.bounds) {
          mm.map.fitBounds(result.bounds);
        } else {
          mm.setCenter(result.lat, result.lng, 13);
        }
      } catch (e) {
        toastManager.error('Address not found');
      }
    };
    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  }

  // ── Plugins modal ──
  document.getElementById('pluginsBtn')?.addEventListener('click', () => {
    UIRenderer.renderPluginsModal();
    modalManager.show('pluginsModal');
  });

  // ── Export ──
  document.getElementById('exportMapBtn')?.addEventListener('click', () => {
    AppRegistry.require('mapExport').exportViewOnlyMap().catch(err => {
      console.error('Export failed', err);
      toastManager.error('Export failed. Please try again.');
    });
  });

  document.getElementById('shareLinkBtn')?.addEventListener('click', () => {
    const btn = document.getElementById('shareLinkBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Sharing…';
    AppRegistry.require('mapShare').createShareLink()
      .then(url => AppRegistry.require('mapShare').showShareDialog(url))
      .catch(err => {
        console.error('Share failed', err);
        toastManager.error('Failed to create share link. Please try again.');
      })
      .finally(() => {
        btn.disabled = false;
        btn.textContent = '🔗 Share';
      });
  });

  // ── Activity log export ──
  document.getElementById('exportActivityBtn')?.addEventListener('click', () => {
    AppRegistry.get('activityLog')?.exportCSV();
  });

  // ── Notification center ──
  document.getElementById('notificationBtn')?.addEventListener('click', () => {
    const panel = document.getElementById('notificationPanel');
    if (panel) {
      const isVisible = panel.style.display !== 'none' && panel.style.display !== '';
      if (isVisible) {
        panel.style.display = 'none';
      } else {
        AppRegistry.get('notificationCenter')?.renderPanel();
        AppRegistry.get('notificationCenter')?.markAllAsRead();
        panel.style.display = 'block';
      }
    }
  });

  // ── Realtime sync toggle ──
  document.getElementById('realtimeSyncToggle')?.addEventListener('change', (e) => {
    if (e.target.checked) {
      SyncController.enableRealtimeSync();
      toastManager.info('Real-time sync enabled');
    } else {
      SyncController.disableRealtimeSync();
      toastManager.info('Real-time sync paused');
    }
  });

  // ── Modal close buttons ──
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.closeModal;
      if (modalId) modalManager.close(modalId);
    });
  });

  // ── Map click clears selection (only when not drawing) ──
  AppRegistry.whenReady('mapManager', (mm) => {
    mm.map.addListener('click', () => {
      if (!stateManager.get('drawingMode')) {
        mm.clearSelectedFeature();
        stateManager.set('currentEditingFeature', null, true);
      }
    });
  });

  // ── Dismiss notification panel when clicking outside ──
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('notificationPanel');
    const btn = document.getElementById('notificationBtn');
    if (panel && panel.style.display !== 'none' && !panel.contains(e.target) && e.target !== btn) {
      panel.style.display = 'none';
    }
  });
}

// ─── Undo / Redo ────────────────────────────────────────────��───────────────
function handleUndo() {
  const ch = AppRegistry.require('commandHistory');
  if (ch.canUndo()) {
    const desc = ch.getUndoDescription();
    ch.undo();
    toastManager.info(`Undone: ${desc}`);
    SyncController.scheduleSave();
  }
}

function handleRedo() {
  const ch = AppRegistry.require('commandHistory');
  if (ch.canRedo()) {
    const desc = ch.getRedoDescription();
    ch.redo();
    toastManager.info(`Redone: ${desc}`);
    SyncController.scheduleSave();
  }
}

// ─── Command Palette ─────────────────────────────────────────────────────────
function openCommandPalette() {
  const lm = AppRegistry.get('layerManager');
  const layers = lm ? lm.getAllLayers() : [];

  drawerManager.open(body => {
    const wrapper = Utils.createElement('div', { className: 'command-palette-wrapper' });
    const input = Utils.createElement('input', { type: 'text', className: 'command-palette-input', placeholder: 'Type a command or search layers...' });
    const results = Utils.createElement('div', { className: 'command-palette-results' });
    wrapper.appendChild(input);
    wrapper.appendChild(results);
    body.appendChild(wrapper);

    const commands = [
      { label: 'Import CSV / Excel', action: () => { drawerManager.close(); document.getElementById('csvFileInput')?.click(); } },
      { label: 'Paste CSV Import', action: () => { drawerManager.close(); document.getElementById('pasteImportBtn')?.click(); } },
      { label: 'Export Map (View Only)', action: () => { drawerManager.close(); MapExport.exportViewOnlyMap().catch(() => toastManager.error('Export failed.')); } },
      { label: 'Reset Map View', action: () => { drawerManager.close(); AppRegistry.get('mapManager')?.resetView(); } },
      { label: 'Fit All Layers', action: () => { drawerManager.close(); lm?.fitToAll(); } },
      { label: 'Draw Point', action: () => { drawerManager.close(); DrawingController.startDrawing('point'); } },
      { label: 'Draw Polygon', action: () => { drawerManager.close(); DrawingController.startDrawing('polygon'); } },
      { label: 'Toggle Distance Tool', action: () => { drawerManager.close(); AppRegistry.get('distanceTool')?.toggle(); } },
      { label: 'Open Plugins', action: () => { drawerManager.close(); UIRenderer.renderPluginsModal(); modalManager.show('pluginsModal'); } },
      ...layers.map(l => ({
        label: `Go to layer: ${l.name}`,
        action: () => { drawerManager.close(); lm.fitToLayer(l.id); }
      }))
    ];

    const renderResults = (filter) => {
      results.innerHTML = '';
      const filtered = filter
        ? commands.filter(c => c.label.toLowerCase().includes(filter.toLowerCase()))
        : commands;
      filtered.slice(0, 20).forEach(cmd => {
        const item = Utils.createElement('div', { className: 'command-palette-item' });
        item.textContent = cmd.label;
        item.addEventListener('click', cmd.action);
        item.addEventListener('keydown', (e) => { if (e.key === 'Enter') cmd.action(); });
        results.appendChild(item);
      });
    };

    input.addEventListener('input', () => renderResults(input.value));
    renderResults('');
    setTimeout(() => input.focus(), 50);
  }, 'Command Palette (Ctrl+K)');
}
