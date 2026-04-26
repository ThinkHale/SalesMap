// js/distance-tool.js — DistanceTool

class DistanceTool {
  constructor(mapManager) {
    this._mm = mapManager;
    this._mode = 'distance'; // 'distance' | 'radius'
    this._isActive = false;
    this._points = [];
    this._markers = [];
    this._line = null;
    this._circle = null;
    this._clickListener = null;
    this._instructionsEl = null;
  }

  toggle() {
    if (this._isActive) this.deactivate();
    else this.activate();
  }

  activate() {
    this._isActive = true;
    this._mm.ignoreFeatureClicks = true;
    this._points = [];
    this._mm.map.setOptions({ draggableCursor: 'crosshair' });
    this._showInstructions();

    this._mm.setOverlayClickCallback(latLng => this._handleClick(latLng));
    this._clickListener = this._mm.map.addListener('click', e => {
      this._handleClick(e.latLng);
    });

    eventBus.emit('distance.tool.activated', { mode: this._mode });
  }

  deactivate() {
    this._isActive = false;
    this._mm.ignoreFeatureClicks = false;
    this._mm.setOverlayClickCallback(null);
    this._mm.map.setOptions({ draggableCursor: null });
    this._hideInstructions();
    this.clearCurrent();

    if (this._clickListener) {
      google.maps.event.removeListener(this._clickListener);
      this._clickListener = null;
    }

    eventBus.emit('distance.tool.deactivated', {});
  }

  setMode(mode) {
    this._mode = mode;
    this.clearCurrent();
    this._updateInstructions();
  }

  clearCurrent() {
    this._markers.forEach(m => m.setMap(null));
    this._markers = [];
    this._points = [];
    if (this._line) { this._line.setMap(null); this._line = null; }
    if (this._circle) { this._circle.setMap(null); this._circle = null; }
    this._hideResultPanel();
  }

  _handleClick(latLng) {
    if (this._mode === 'distance') {
      this._points.push(latLng);
      this._placeMarker(latLng, this._points.length);

      if (this._points.length === 2) {
        this._drawLine();
        this._showDistanceResult();
      } else if (this._points.length > 2) {
        this.clearCurrent();
        this._points.push(latLng);
        this._placeMarker(latLng, 1);
      }
    } else if (this._mode === 'radius') {
      if (this._points.length === 0) {
        this._points.push(latLng);
        this._placeMarker(latLng, 1, 'Center');
        this._updateInstructions('Click to set the radius edge');
      } else {
        this._points.push(latLng);
        this._placeMarker(latLng, 2, 'Edge');
        this._drawCircle();
        this._showRadiusResult();
      }
    }
  }

  _placeMarker(latLng, num, label = '') {
    const marker = new google.maps.Marker({
      position: latLng,
      map: this._mm.map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: '#FF6B35',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2
      },
      label: label ? { text: label, color: '#333', fontSize: '10px' } : ''
    });
    this._markers.push(marker);
  }

  _drawLine() {
    if (this._line) this._line.setMap(null);
    this._line = new google.maps.Polyline({
      path: this._points,
      strokeColor: '#FF6B35',
      strokeOpacity: 1,
      strokeWeight: 2,
      map: this._mm.map
    });
  }

  _drawCircle() {
    if (this._circle) this._circle.setMap(null);
    const center = this._points[0];
    const edge = this._points[1];
    const radiusKm = Utils.calculateDistance(
      center.lat(), center.lng(),
      edge.lat(), edge.lng()
    );

    this._circle = new google.maps.Circle({
      center,
      radius: radiusKm * 1000,
      fillColor: '#FF6B35',
      fillOpacity: 0.1,
      strokeColor: '#FF6B35',
      strokeWeight: 2,
      map: this._mm.map
    });
  }

  _showDistanceResult() {
    const [p1, p2] = this._points;
    const km = Utils.calculateDistance(p1.lat(), p1.lng(), p2.lat(), p2.lng());
    const miles = km * 0.621371;
    this._showResultPanel(`Distance: ${km.toFixed(2)} km / ${miles.toFixed(2)} mi`);
  }

  _showRadiusResult() {
    const [center, edge] = this._points;
    const km = Utils.calculateDistance(center.lat(), center.lng(), edge.lat(), edge.lng());
    const miles = km * 0.621371;
    this._showResultPanel(`Radius: ${km.toFixed(2)} km / ${miles.toFixed(2)} mi`);
  }

  _showInstructions() {
    if (!this._instructionsEl) {
      this._instructionsEl = document.getElementById('measurementInstructions');
    }
    if (this._instructionsEl) {
      this._instructionsEl.style.display = 'block';
      this._updateInstructions();
    }
  }

  _updateInstructions(text) {
    if (!this._instructionsEl) return;
    if (text) {
      this._instructionsEl.textContent = text;
      return;
    }
    if (this._mode === 'distance') {
      this._instructionsEl.textContent = 'Click two points to measure distance. Click again to reset.';
    } else {
      this._instructionsEl.textContent = 'Click to set center point.';
    }
  }

  _hideInstructions() {
    if (!this._instructionsEl) {
      this._instructionsEl = document.getElementById('measurementInstructions');
    }
    if (this._instructionsEl) this._instructionsEl.style.display = 'none';
    this._hideResultPanel();
  }

  _showResultPanel(text) {
    if (!this._instructionsEl) return;
    this._instructionsEl.textContent = text + ' (click to reset)';
  }

  _hideResultPanel() {
    if (this._instructionsEl && this._isActive) {
      this._updateInstructions();
    }
  }

  isActive() { return this._isActive; }
  getMode() { return this._mode; }
}
