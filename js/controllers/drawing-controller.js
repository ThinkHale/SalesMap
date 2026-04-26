// js/controllers/drawing-controller.js — DrawingController

const DrawingController = {
  _targetLayerId: null,
  _hintEl: null,

  startDrawing(type) {
    const mapManager = AppRegistry.require('mapManager');
    const sm = AppRegistry.require('stateManager');

    this._targetLayerId = sm.get('targetLayerForNewFeature');
    if (!this._targetLayerId) {
      toastManager.error('Select a target layer first (right-click a layer → "Set as draw target")');
      return;
    }

    sm.set('drawingMode', type);
    mapManager.startDrawing(type);
    this._showDrawingHint(type);
  },

  cancelDrawing() {
    const mapManager = AppRegistry.require('mapManager');
    const sm = AppRegistry.require('stateManager');
    mapManager.stopDrawing();
    sm.set('drawingMode', null);
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
    if (shape.type === 'point') {
      return {
        id,
        name: 'New Point',
        latitude: shape.latLng.lat(),
        longitude: shape.latLng.lng(),
        description: '',
        tier: '',
        bdm: '',
        source: 'draw',
        importedAt: Utils.formatDate()
      };
    } else if (shape.type === 'polygon') {
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
        name: 'New Polygon',
        wkt,
        latitude: latSum / path.length,  // centroid for reference
        longitude: lngSum / path.length,
        description: '',
        tier: '',
        bdm: '',
        source: 'draw',
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
