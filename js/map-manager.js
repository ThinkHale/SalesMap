// js/map-manager.js — MapManager

class MapManager {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.layers = new Map();  // layerId → { markers, polygons, labels, type, color, visible }
    this.selectedFeature = null;
    this.onFeatureClick = null;
    this.onDrawComplete = null;
    this.drawingMode = null;
    this.polygonPath = [];
    this.tempMarkers = [];
    this.previewPolyline = null;
    this.drawnShapes = [];
    this.ignoreFeatureClicks = false;
    this.colorPalette = AppConfig.colors.primary;
    this.colorIndex = 0;
    this.infoWindow = null;
    this.searchMarker = null;
    this._mapClickListener = null;
    this._mapDblClickListener = null;
    this._drawingHintEl = null;
    this._overlayClickCallback = null;
  }

  setOverlayClickCallback(fn) { this._overlayClickCallback = fn; }

  async initialize() {
    const mapOptions = {
      center: AppConfig.map.defaultCenter,
      zoom: AppConfig.map.defaultZoom,
      mapTypeControl: AppConfig.map.mapTypeControl,
      streetViewControl: AppConfig.map.streetViewControl,
      fullscreenControl: AppConfig.map.fullscreenControl,
      zoomControl: AppConfig.map.zoomControl,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      gestureHandling: 'greedy',
      styles: []
    };

    this.map = new google.maps.Map(
      document.getElementById(this.containerId),
      mapOptions
    );

    this.infoWindow = new google.maps.InfoWindow();

    // Emit bounds changed for analytics
    this.map.addListener('idle', () => {
      eventBus.emit('map.bounds.changed', {
        bounds: this.map.getBounds(),
        center: this.map.getCenter(),
        zoom: this.map.getZoom()
      });
    });

    eventBus.emit('map.initialized', { map: this.map });
    return this.map;
  }

  setOnFeatureClick(fn) { this.onFeatureClick = fn; }
  setOnDrawComplete(fn) { this.onDrawComplete = fn; }

  // ─── Layer rendering ──────────────────────────────────────────────────────

  addFeaturesToLayer(layerId, features, type, existingColor) {
    if (!this.layers.has(layerId)) {
      this.layers.set(layerId, { markers: [], polygons: [], labels: [], type, visible: true, color: existingColor || this.getNextColor() });
    }
    const layerData = this.layers.get(layerId);
    if (!existingColor && !layerData.color) {
      layerData.color = this.getNextColor();
    }
    const color = existingColor || layerData.color;
    layerData.type = type;
    layerData.color = color;

    features.forEach(feature => {
      if (feature.wkt && feature.wkt.trim()) {
        this._addPolygonFeature(layerId, feature, color);
      } else if (!isNaN(parseFloat(feature.latitude)) && !isNaN(parseFloat(feature.longitude))) {
        this._addPointFeature(layerId, feature, color);
      }
    });

    return color;
  }

  _addPointFeature(layerId, feature, color) {
    const layerData = this.layers.get(layerId);
    if (!layerData) return;

    const tierColor = AppConfig.colors.tierMap[String(feature.tier).toLowerCase()] || null;
    const fillColor = tierColor || color;

    const marker = new google.maps.Marker({
      position: { lat: parseFloat(feature.latitude), lng: parseFloat(feature.longitude) },
      map: layerData.visible ? this.map : null,
      title: feature.name || '',
      icon: {
        path: AppConfig.marker.pinPath,
        fillColor: fillColor,
        fillOpacity: AppConfig.marker.fillOpacity,
        strokeColor: AppConfig.marker.strokeColor,
        strokeWeight: AppConfig.marker.strokeWeight,
        scale: AppConfig.marker.scale,
        anchor: new google.maps.Point(0, 0),
        labelOrigin: new google.maps.Point(0, -30)
      }
    });

    marker._featureId = feature.id;
    marker._layerId = layerId;
    marker._featureData = feature;

    marker.addListener('click', () => {
      if (this.ignoreFeatureClicks) {
        if (this._overlayClickCallback) this._overlayClickCallback(marker.getPosition());
        return;
      }
      this._selectFeature(feature, marker, layerData.color, layerId);
    });

    layerData.markers.push(marker);

    // Register with cluster manager if available
    if (AppRegistry.has('clusterManager')) {
      AppRegistry.get('clusterManager').addMarkersToCluster(layerId, [marker]);
    }
  }

  _addPolygonFeature(layerId, feature, color) {
    const layerData = this.layers.get(layerId);
    if (!layerData) return;

    let geoJson;
    try {
      if (typeof wellknown !== 'undefined') {
        geoJson = wellknown.parse(feature.wkt);
      }
    } catch (e) {
      console.warn('[MapManager] Failed to parse WKT:', feature.wkt, e);
      return;
    }

    if (!geoJson) return;

    const paths = this._geojsonToPaths(geoJson);
    if (!paths) return;

    const tierColor = AppConfig.colors.tierMap[String(feature.tier || '').toLowerCase()];
    const fillColor = tierColor || color;

    const polygon = new google.maps.Polygon({
      paths,
      fillColor,
      fillOpacity: AppConfig.polygon.fillOpacity,
      strokeColor: fillColor,
      strokeWeight: AppConfig.polygon.strokeWeight,
      strokeOpacity: 0.8,
      clickable: true,
      map: layerData.visible ? this.map : null
    });

    polygon._featureId = feature.id;
    polygon._layerId = layerId;
    polygon._featureData = feature;

    polygon.addListener('click', (e) => {
      if (this.ignoreFeatureClicks) {
        if (this._overlayClickCallback) this._overlayClickCallback(e.latLng);
        return;
      }
      this._selectFeature(feature, polygon, fillColor, layerId);
    });

    layerData.polygons.push(polygon);
  }

  _geojsonToPaths(geoJson) {
    if (!geoJson) return null;
    if (geoJson.type === 'Polygon') {
      return geoJson.coordinates.map(ring =>
        ring.map(coord => ({ lat: coord[1], lng: coord[0] }))
      );
    }
    if (geoJson.type === 'MultiPolygon') {
      // Return array of rings from first polygon
      return geoJson.coordinates[0].map(ring =>
        ring.map(coord => ({ lat: coord[1], lng: coord[0] }))
      );
    }
    return null;
  }

  _selectFeature(feature, mapObject, color, layerId) {
    this.selectedFeature = { feature, mapObject, layerId };
    this._openInfoWindow(feature, mapObject, layerId);
  }

  _openInfoWindow(feature, mapObject, layerId) {
    const container = document.createElement('div');
    container.className = 'info-window-content';

    const title = Utils.createElement('div', { className: 'iw-title' });
    title.textContent = feature.name || 'Untitled Feature';
    container.appendChild(title);

    const displayProps = AppConfig.featureInfo.displayProperties;

    displayProps.forEach(prop => {
      if (feature[prop] !== undefined && feature[prop] !== null && feature[prop] !== '') {
        const row = Utils.createElement('div', { className: 'iw-row' });
        const lbl = Utils.createElement('span', { className: 'iw-label' }, prop + ':');
        const val = Utils.createElement('span', { className: 'iw-value' });
        val.textContent = feature[prop];
        row.appendChild(lbl);
        row.appendChild(val);
        container.appendChild(row);
      }
    });

    const editBtn = Utils.createElement('button', { className: 'btn btn-sm btn-primary iw-edit-btn' }, 'View Details');
    editBtn.addEventListener('click', () => {
      this.infoWindow.close();
      if (this.onFeatureClick) this.onFeatureClick({ properties: feature, mapObject, layerId });
    });
    container.appendChild(editBtn);

    this.infoWindow.setContent(container);

    if (mapObject instanceof google.maps.Marker) {
      this.infoWindow.open(this.map, mapObject);
    } else if (mapObject instanceof google.maps.Polygon) {
      const bounds = new google.maps.LatLngBounds();
      mapObject.getPath().forEach(p => bounds.extend(p));
      this.infoWindow.setPosition(bounds.getCenter());
      this.infoWindow.open(this.map);
    }
  }

  clearSelectedFeature() {
    if (this.infoWindow) this.infoWindow.close();
    this.selectedFeature = null;
  }

  createDataSource(layerId, isPoint) {
    if (!this.layers.has(layerId)) {
      this.layers.set(layerId, {
        markers: [], polygons: [], labels: [],
        type: isPoint ? 'point' : 'polygon',
        visible: true,
        color: this.getNextColor()
      });
    }
  }

  getNextColor() {
    const color = this.colorPalette[this.colorIndex % this.colorPalette.length];
    this.colorIndex++;
    return color;
  }

  // ─── Layer visibility & styling ───────────────────────────────────────────

  toggleLayerVisibility(layerId, visible) {
    const layerData = this.layers.get(layerId);
    if (!layerData) return;
    layerData.visible = visible;
    layerData.markers.forEach(m => m.setMap(visible ? this.map : null));
    layerData.polygons.forEach(p => p.setMap(visible ? this.map : null));
    layerData.labels.forEach(l => l.setMap(visible ? this.map : null));
  }

  removeLayer(layerId) {
    const layerData = this.layers.get(layerId);
    if (!layerData) return;
    layerData.markers.forEach(m => m.setMap(null));
    layerData.polygons.forEach(p => p.setMap(null));
    layerData.labels.forEach(l => l.setMap(null));
    this.layers.delete(layerId);
  }

  clearLayer(layerId) {
    const layerData = this.layers.get(layerId);
    if (!layerData) return;
    layerData.markers.forEach(m => m.setMap(null));
    layerData.polygons.forEach(p => p.setMap(null));
    layerData.labels.forEach(l => l.setMap(null));
    layerData.markers = [];
    layerData.polygons = [];
    layerData.labels = [];
  }

  fitBounds(layerIds) {
    const bounds = new google.maps.LatLngBounds();
    let hasPoints = false;

    const targetLayers = layerIds && layerIds.length > 0
      ? layerIds.map(id => this.layers.get(id)).filter(Boolean)
      : Array.from(this.layers.values());

    targetLayers.forEach(layerData => {
      layerData.markers.forEach(m => {
        bounds.extend(m.getPosition());
        hasPoints = true;
      });
      layerData.polygons.forEach(p => {
        p.getPath().forEach(point => { bounds.extend(point); hasPoints = true; });
      });
    });

    if (hasPoints) {
      this.map.fitBounds(bounds, AppConfig.map.fitBoundsPadding);
    }
  }

  setLayerColor(layerId, color) {
    const layerData = this.layers.get(layerId);
    if (!layerData) return;
    layerData.color = color;
    layerData.markers.forEach(m => {
      const icon = m.getIcon();
      if (icon) {
        m.setIcon({ ...icon, fillColor: color });
      }
    });
    layerData.polygons.forEach(p => {
      p.setOptions({ fillColor: color, strokeColor: color });
    });
  }

  applyPropertyBasedStyle(layerId, property) {
    const layerData = this.layers.get(layerId);
    if (!layerData) return;

    layerData.markers.forEach(m => {
      const val = String(m._featureData[property] || '').toLowerCase();
      const color = AppConfig.colors.tierMap[val] || layerData.color || AppConfig.colors.default;
      const icon = m.getIcon();
      if (icon) m.setIcon({ ...icon, fillColor: color });
    });

    layerData.polygons.forEach(p => {
      const val = String(p._featureData[property] || '').toLowerCase();
      const color = AppConfig.colors.tierMap[val] || layerData.color || AppConfig.colors.default;
      p.setOptions({ fillColor: color, strokeColor: color });
    });
  }

  togglePolygonLabels(layerId, show, features) {
    const layerData = this.layers.get(layerId);
    if (!layerData) return;

    // Remove existing labels
    layerData.labels.forEach(l => l.setMap(null));
    layerData.labels = [];

    if (!show || !features) return;

    layerData.polygons.forEach((polygon, idx) => {
      const feature = features[idx];
      if (!feature || !feature.name) return;
      const bounds = new google.maps.LatLngBounds();
      polygon.getPath().forEach(p => bounds.extend(p));
      const center = bounds.getCenter();

      const label = new google.maps.Marker({
        position: center,
        map: layerData.visible ? this.map : null,
        label: {
          text: feature.name.substring(0, 20),
          color: '#333',
          fontSize: '11px',
          fontWeight: 'bold'
        },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 }
      });
      layerData.labels.push(label);
    });
  }

  setLayerOpacity(layerId, opacity) {
    const layerData = this.layers.get(layerId);
    if (!layerData) return;
    layerData.markers.forEach(m => {
      const icon = m.getIcon();
      if (icon) m.setIcon({ ...icon, fillOpacity: opacity });
    });
    layerData.polygons.forEach(p => {
      p.setOptions({ fillOpacity: opacity * AppConfig.polygon.fillOpacity, strokeOpacity: opacity * 0.8 });
    });
  }

  // ─── Custom drawing (no deprecated Drawing Library) ───────────────────────

  startDrawing(mode) {
    this.stopDrawing();
    this.drawingMode = mode;
    this.polygonPath = [];
    this.map.setOptions({ draggableCursor: 'crosshair', disableDoubleClickZoom: true });

    if (mode === 'polygon') {
      this._mapClickListener = this.map.addListener('click', (e) => {
        // Close polygon if user clicks near the first vertex
        if (this.polygonPath.length >= 3) {
          const first = this.polygonPath[0];
          const clickPx = this.map.getProjection()?.fromLatLngToPoint(e.latLng);
          const firstPx = this.map.getProjection()?.fromLatLngToPoint(first);
          if (clickPx && firstPx) {
            const scale = Math.pow(2, this.map.getZoom());
            const dx = (clickPx.x - firstPx.x) * scale;
            const dy = (clickPx.y - firstPx.y) * scale;
            if (Math.sqrt(dx * dx + dy * dy) < 12) {
              // Single click near first vertex — no spurious vertex was added
              this._closePolygon(false);
              return;
            }
          }
        }
        this._addPolygonVertex(e.latLng);
      });
      this._mapDblClickListener = this.map.addListener('dblclick', () => {
        // Google Maps fires a click immediately before dblclick on the same spot,
        // so one spurious vertex was added and must be removed.
        this._closePolygon(true);
      });
    } else if (mode === 'point') {
      this._mapClickListener = this.map.addListener('click', (e) => {
        this._placePoint(e.latLng);
      });
    }
  }

  _addPolygonVertex(latLng) {
    this.polygonPath.push(latLng);

    const vertexMarker = new google.maps.Marker({
      position: latLng,
      map: this.map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: AppConfig.drawing.vertexScale,
        fillColor: AppConfig.drawing.vertexColor,
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 1.5
      },
      draggable: false
    });
    this.tempMarkers.push(vertexMarker);

    // Update preview polyline
    if (this.previewPolyline) this.previewPolyline.setMap(null);
    if (this.polygonPath.length > 1) {
      this.previewPolyline = new google.maps.Polyline({
        path: this.polygonPath,
        strokeColor: AppConfig.drawing.polygonColor,
        strokeOpacity: AppConfig.drawing.strokeOpacity,
        strokeWeight: AppConfig.drawing.strokeWeight,
        map: this.map
      });
    }
  }

  _closePolygon(popLast = false) {
    if (popLast && this.polygonPath.length > 0) {
      this.polygonPath.pop();
      const lastMarker = this.tempMarkers.pop();
      if (lastMarker) lastMarker.setMap(null);
    }

    if (this.polygonPath.length < 3) {
      toastManager.warning('A polygon requires at least 3 points');
      return;
    }

    if (this.previewPolyline) {
      this.previewPolyline.setMap(null);
      this.previewPolyline = null;
    }

    const path = [...this.polygonPath];
    this.stopDrawing();

    if (this.onDrawComplete) {
      this.onDrawComplete({ type: 'polygon', path });
    }
  }

  _placePoint(latLng) {
    this.stopDrawing();
    if (this.onDrawComplete) {
      this.onDrawComplete({ type: 'point', latLng });
    }
  }

  stopDrawing() {
    if (this._mapClickListener) {
      google.maps.event.removeListener(this._mapClickListener);
      this._mapClickListener = null;
    }
    if (this._mapDblClickListener) {
      google.maps.event.removeListener(this._mapDblClickListener);
      this._mapDblClickListener = null;
    }
    this.tempMarkers.forEach(m => m.setMap(null));
    this.tempMarkers = [];
    if (this.previewPolyline) {
      this.previewPolyline.setMap(null);
      this.previewPolyline = null;
    }
    this.polygonPath = [];
    this.drawingMode = null;
    if (this.map) this.map.setOptions({ draggableCursor: null });
  }

  // ─── Map controls ─────────────────────────────────────────────────────────

  zoomIn() { this.map.setZoom(this.map.getZoom() + 1); }
  zoomOut() { this.map.setZoom(this.map.getZoom() - 1); }

  resetView() {
    this.map.setCenter(AppConfig.map.defaultCenter);
    this.map.setZoom(AppConfig.map.defaultZoom);
  }

  setCenter(lat, lng, zoom) {
    this.map.setCenter({ lat, lng });
    if (zoom !== undefined) this.map.setZoom(zoom);
  }

  addSearchMarker(lat, lng, title) {
    this.clearSearchMarker();
    this.searchMarker = new google.maps.Marker({
      position: { lat, lng },
      map: this.map,
      title: title || 'Search Result',
      animation: google.maps.Animation.DROP,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: '#4285F4',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2
      }
    });
  }

  clearSearchMarker() {
    if (this.searchMarker) {
      this.searchMarker.setMap(null);
      this.searchMarker = null;
    }
  }

  getAllVisibleMarkers() {
    const markers = [];
    this.layers.forEach(layerData => {
      if (layerData.visible) markers.push(...layerData.markers);
    });
    return markers;
  }

  getLayerData(layerId) {
    return this.layers.get(layerId) || null;
  }
}
