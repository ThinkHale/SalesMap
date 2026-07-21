// js/controllers/drawing-controller.js — DrawingController

const DrawingController = {
  _targetLayerId: null,
  _hintEl: null,
  _pendingLabel: '',

  _ensureTargetLayer(type) {
    const sm = AppRegistry.require('stateManager');
    const layerManager = AppRegistry.require('layerManager');
    const existingId = sm.get('targetLayerForNewFeature');
    if (existingId && layerManager.getLayer(existingId)) return existingId;

    const isArea = type === 'polygon' || type === 'freehand';
    const layerName = isArea ? 'Drawn territories' : 'Map notes';
    const layerType = isArea ? 'polygon' : 'point';
    const reusable = layerManager.getAllLayers().find(layer => layer.name === layerName);
    if (reusable) {
      sm.set('targetLayerForNewFeature', reusable.id);
      return reusable.id;
    }

    const command = new CreateLayerCommand(layerManager, layerName, [], layerType, { createdBy: 'drawing' });
    AppRegistry.require('commandHistory').execute(command);
    sm.set('targetLayerForNewFeature', command.layerId);
    SyncController.scheduleSave();
    toastManager.info(`Created “${layerName}” for your drawing.`);
    return command.layerId;
  },

  startDrawing(type) {
    const mapManager = AppRegistry.require('mapManager');
    const sm = AppRegistry.require('stateManager');

    this._targetLayerId = this._ensureTargetLayer(type);

    sm.set('drawingMode', type);
    mapManager.startDrawing(type);
    this._showDrawingHint(type);
  },

  startTextLabel() {
    drawerManager.open(body => {
      const wrapper = Utils.createElement('div', { className: 'label-setup' });
      const intro = Utils.createElement('p', { className: 'label-setup-copy' }, 'Enter the label first, then click where it should appear on the map.');
      const label = Utils.createElement('label', { className: 'form-label', for: 'mapLabelText' }, 'Label text');
      const input = Utils.createElement('input', { id: 'mapLabelText', className: 'form-control', type: 'text', maxlength: '80', placeholder: 'e.g. Priority market' });
      const addBtn = Utils.createElement('button', { className: 'btn btn-primary label-place-btn' }, 'Place label on map');
      const begin = () => {
        const value = input.value.trim();
        if (!value) { toastManager.warning('Enter label text first.'); input.focus(); return; }
        this._pendingLabel = value;
        drawerManager.close();
        this.startDrawing('label');
        const cancel = document.getElementById('cancelDrawBtn');
        if (cancel) cancel.style.display = '';
      };
      addBtn.addEventListener('click', begin);
      input.addEventListener('keydown', event => { if (event.key === 'Enter') begin(); });
      wrapper.appendChild(intro); wrapper.appendChild(label); wrapper.appendChild(input); wrapper.appendChild(addBtn);
      body.appendChild(wrapper);
      setTimeout(() => input.focus(), 50);
    }, 'Add text label');
  },

  cancelDrawing() {
    const mapManager = AppRegistry.require('mapManager');
    const sm = AppRegistry.require('stateManager');
    mapManager.stopDrawing();
    sm.set('drawingMode', null);
    this._pendingLabel = '';
    this._hideDrawingHint();
  },

  handleDrawComplete(shape) {
    const layerManager = AppRegistry.require('layerManager');
    const ch = AppRegistry.require('commandHistory');
    const syncController = AppRegistry.require('syncController');
    const sm = AppRegistry.require('stateManager');

    const feature = this._shapeToFeature(shape);
    if (!feature) {
      toastManager.error('Failed to create feature from shape');
      return;
    }

    const targetLayerId = this._targetLayerId || sm.get('targetLayerForNewFeature');
    if (!targetLayerId) {
      toastManager.error('No target layer selected');
      return;
    }

    const cmd = new AddFeatureCommand(layerManager, targetLayerId, [feature]);
    ch.execute(cmd);
    syncController.scheduleSave();
    this._hideDrawingHint();
    sm.set('drawingMode', null);
    this._pendingLabel = '';
    const cancelBtn = document.getElementById('cancelDrawBtn');
    if (cancelBtn) cancelBtn.style.display = 'none';

    // Open feature detail for editing (use AppRegistry to avoid load-order issue)
    drawerManager.open((body) => {
      const uiRenderer = AppRegistry.get('uiRenderer');
      if (uiRenderer) uiRenderer.renderFeatureInfo(feature, body, targetLayerId);
    }, 'New Feature');
  },

  _shapeToFeature(shape) {
    const id = Utils.generateId('feature');
    if (shape.type === 'point' || shape.type === 'label') {
      const isLabel = shape.type === 'label';
      return {
        id,
        name: isLabel ? (this._pendingLabel || 'New Label') : 'New Point',
        latitude: shape.latLng.lat(),
        longitude: shape.latLng.lng(),
        description: '',
        tier: '',
        bdm: '',
        source: isLabel ? 'label' : 'draw',
        isTextLabel: isLabel,
        importedAt: Utils.formatDate()
      };
    } else if (shape.type === 'polygon' || shape.type === 'freehand') {
      const path = shape.path;
      const coords = path.map(p => `${p.lng()} ${p.lat()}`);
      // Close the ring
      if (coords.length > 0) coords.push(coords[0]);
      const wkt = `POLYGON((${coords.join(', ')}))`;
      // Compute centroid for lat/lng fallback
      const latSum = path.reduce((acc, p) => acc + p.lat(), 0);
      const lngSum = path.reduce((acc, p) => acc + p.lng(), 0);
      return {
        id,
        name: shape.type === 'freehand' ? 'Freehand Shape' : 'New Polygon',
        wkt,
        latitude: latSum / path.length,  // centroid for reference
        longitude: lngSum / path.length,
        description: '',
        tier: '',
        bdm: '',
        source: shape.type === 'freehand' ? 'freehand' : 'draw',
        importedAt: Utils.formatDate()
      };
    }
    return null;
  },

  _showDrawingHint(type) {
    if (!this._hintEl) {
      this._hintEl = document.getElementById('drawingHint');
    }
    if (this._hintEl) {
      if (type === 'polygon') {
        this._hintEl.textContent = 'Click to add vertices. Click first vertex or double-click to close. Esc to cancel.';
      } else if (type === 'freehand') {
        this._hintEl.textContent = 'Press and drag on the map to sketch a shape. Release to finish. Esc to cancel.';
      } else if (type === 'label') {
        this._hintEl.textContent = 'Click where you want the label to appear. Esc to cancel.';
      } else {
        this._hintEl.textContent = 'Click on the map to place a point. Esc to cancel.';
      }
      this._hintEl.style.display = 'block';
    }
  },

  _hideDrawingHint() {
    if (!this._hintEl) this._hintEl = document.getElementById('drawingHint');
    if (this._hintEl) this._hintEl.style.display = 'none';
  }
};

AppRegistry.register('drawingController', DrawingController);
