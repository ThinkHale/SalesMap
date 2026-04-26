// js/analytics-panel.js — AnalyticsPanel

class AnalyticsPanel {
  constructor(layerManager, stateManager) {
    this._lm = layerManager;
    this._sm = stateManager;
    this._container = null;
    this._boundsFilter = null;
  }

  initialize() {
    this._container = document.getElementById('analyticsPanel');

    // Reactive subscriptions
    const rerender = Utils.debounce(() => this.render(), 150);
    const events = [
      'layer.created', 'layer.deleted', 'layer.visibility.changed',
      'features.added', 'feature.deleted', 'feature.updated',
      'layers.imported', 'layers.updated'
    ];
    events.forEach(e => eventBus.on(e, rerender));

    eventBus.on('map.bounds.changed', Utils.debounce(({ bounds }) => {
      this._boundsFilter = bounds;
      this.render();
    }, 500));
  }

  render() {
    if (!this._container) this._container = document.getElementById('analyticsPanel');
    if (!this._container) return;

    this._container.innerHTML = '';

    const layers = this._lm.getAllLayers();
    if (layers.length === 0) {
      const msg = Utils.createElement('div', { className: 'analytics-empty' });
      msg.textContent = 'No layers loaded. Import data to see analytics.';
      this._container.appendChild(msg);
      return;
    }

    // Global summary
    const summary = this._buildGlobalSummary(layers);
    this._container.appendChild(summary);

    // Per-layer sections
    const activeLayers = layers.filter(l => {
      const af = this._sm.get('activeGroupFilter');
      if (!af) return true;
      return l.groupId === af;
    });

    activeLayers.forEach(layer => {
      const section = this._buildLayerSection(layer);
      this._container.appendChild(section);
    });

    // Export button
    const exportBtn = Utils.createElement('button', { className: 'btn btn-secondary btn-sm analytics-export' }, 'Export CSV');
    exportBtn.addEventListener('click', () => this._exportCSV(layers));
    this._container.appendChild(exportBtn);
  }

  _buildGlobalSummary(layers) {
    const el = Utils.createElement('div', { className: 'analytics-summary' });

    const totalFeatures = layers.reduce((acc, l) => acc + (l.features || []).length, 0);
    const visibleLayers = layers.filter(l => l.visible).length;

    let totalRevenue = 0;
    layers.forEach(l => {
      (l.features || []).forEach(f => {
        const rev = Utils.parseNumber(f.revenue);
        if (!isNaN(rev)) totalRevenue += rev;
      });
    });

    const stats = [
      { label: 'Layers', value: layers.length },
      { label: 'Visible', value: visibleLayers },
      { label: 'Features', value: Utils.formatNumber(totalFeatures) },
      { label: 'Total Revenue', value: totalRevenue > 0 ? Utils.formatCurrency(totalRevenue) : '–' }
    ];

    const title = Utils.createElement('div', { className: 'analytics-section-title' }, 'Overview');
    el.appendChild(title);

    const grid = Utils.createElement('div', { className: 'analytics-stats-grid' });
    stats.forEach(({ label, value }) => {
      const card = Utils.createElement('div', { className: 'analytics-stat-card' });
      const v = Utils.createElement('div', { className: 'analytics-stat-value' });
      v.textContent = String(value);
      const l = Utils.createElement('div', { className: 'analytics-stat-label' });
      l.textContent = label;
      card.appendChild(v);
      card.appendChild(l);
      grid.appendChild(card);
    });
    el.appendChild(grid);
    return el;
  }

  _buildLayerSection(layer) {
    const section = Utils.createElement('div', { className: 'analytics-layer-section' });

    const header = Utils.createElement('div', { className: 'analytics-layer-header' });
    const colorDot = Utils.createElement('span', { className: 'layer-color-dot', style: { background: layer.color || '#ccc' } });
    const nameEl = Utils.createElement('span', { className: 'analytics-layer-name' });
    nameEl.textContent = layer.name;
    const countEl = Utils.createElement('span', { className: 'analytics-layer-count' });
    countEl.textContent = `${(layer.features || []).length} features`;
    header.appendChild(colorDot);
    header.appendChild(nameEl);
    header.appendChild(countEl);
    section.appendChild(header);

    const features = layer.features || [];
    if (features.length === 0) return section;

    // Tier distribution
    const tierCounts = {};
    let revenueSum = 0, revenueCount = 0, revenueMin = Infinity, revenueMax = -Infinity;
    const bdmCounts = {};

    features.forEach(f => {
      const tier = String(f.tier || 'unknown').toLowerCase();
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;

      const rev = Utils.parseNumber(f.revenue);
      if (!isNaN(rev)) {
        revenueSum += rev;
        revenueCount++;
        if (rev < revenueMin) revenueMin = rev;
        if (rev > revenueMax) revenueMax = rev;
      }

      const bdm = f.bdm || 'Unassigned';
      bdmCounts[bdm] = (bdmCounts[bdm] || 0) + 1;
    });

    // Tier distribution bars
    if (Object.keys(tierCounts).length > 0) {
      const tierSection = Utils.createElement('div', { className: 'analytics-sub-section' });
      const tierTitle = Utils.createElement('div', { className: 'analytics-sub-title' }, 'Tier Distribution');
      tierSection.appendChild(tierTitle);

      const tierEntries = Utils.sortBy(Object.entries(tierCounts), ([k]) => k);
      tierEntries.forEach(([tier, count]) => {
        const pct = Utils.percentage(count, features.length);
        const row = Utils.createElement('div', { className: 'tier-bar-row' });
        const label = Utils.createElement('span', { className: 'tier-bar-label' });
        label.textContent = tier;
        const barWrap = Utils.createElement('div', { className: 'tier-bar-wrap' });
        const bar = Utils.createElement('div', { className: 'tier-bar-fill' });
        const tierColor = AppConfig.colors.tierMap[tier] || layer.color || AppConfig.colors.default;
        bar.style.width = pct + '%';
        bar.style.background = tierColor;
        const countEl = Utils.createElement('span', { className: 'tier-bar-count' });
        countEl.textContent = `${count} (${pct}%)`;
        barWrap.appendChild(bar);
        row.appendChild(label);
        row.appendChild(barWrap);
        row.appendChild(countEl);
        tierSection.appendChild(row);
      });
      section.appendChild(tierSection);
    }

    // Revenue stats
    if (revenueCount > 0) {
      const revSection = Utils.createElement('div', { className: 'analytics-sub-section' });
      const revTitle = Utils.createElement('div', { className: 'analytics-sub-title' }, 'Revenue');
      revSection.appendChild(revTitle);

      const revStats = [
        { label: 'Total', value: Utils.formatCurrency(revenueSum) },
        { label: 'Avg', value: Utils.formatCurrency(revenueSum / revenueCount) },
        { label: 'Min', value: Utils.formatCurrency(revenueMin) },
        { label: 'Max', value: Utils.formatCurrency(revenueMax) }
      ];
      const revGrid = Utils.createElement('div', { className: 'analytics-mini-grid' });
      revStats.forEach(({ label, value }) => {
        const cell = Utils.createElement('div', { className: 'analytics-mini-cell' });
        const v = Utils.createElement('div', { className: 'mini-value' });
        v.textContent = value;
        const l = Utils.createElement('div', { className: 'mini-label' });
        l.textContent = label;
        cell.appendChild(v);
        cell.appendChild(l);
        revGrid.appendChild(cell);
      });
      revSection.appendChild(revGrid);
      section.appendChild(revSection);
    }

    // BDM counts (top 5)
    const topBDMs = Utils.sortBy(Object.entries(bdmCounts), ([, count]) => count, 'desc').slice(0, 5);
    if (topBDMs.length > 0) {
      const bdmSection = Utils.createElement('div', { className: 'analytics-sub-section' });
      const bdmTitle = Utils.createElement('div', { className: 'analytics-sub-title' }, 'Top BDMs');
      bdmSection.appendChild(bdmTitle);
      topBDMs.forEach(([bdm, count]) => {
        const row = Utils.createElement('div', { className: 'bdm-row' });
        const nameEl = Utils.createElement('span', { className: 'bdm-name' });
        nameEl.textContent = bdm;
        const countEl = Utils.createElement('span', { className: 'bdm-count' });
        countEl.textContent = count;
        row.appendChild(nameEl);
        row.appendChild(countEl);
        bdmSection.appendChild(row);
      });
      section.appendChild(bdmSection);
    }

    // Polygon area (if polygon layer)
    if (layer.type === 'polygon' && typeof google !== 'undefined' && google.maps && google.maps.geometry) {
      const mapData = AppRegistry.has('mapManager') ? AppRegistry.get('mapManager').getLayerData(layer.id) : null;
      if (mapData && mapData.polygons && mapData.polygons.length > 0) {
        let totalArea = 0;
        mapData.polygons.forEach(poly => {
          try {
            totalArea += google.maps.geometry.spherical.computeArea(poly.getPath());
          } catch (e) { /* skip */ }
        });
        if (totalArea > 0) {
          const areaSection = Utils.createElement('div', { className: 'analytics-sub-section' });
          const areaTxt = Utils.createElement('div', { className: 'analytics-sub-title' });
          const sqKm = (totalArea / 1e6).toFixed(1);
          const sqMi = (totalArea / 2589988).toFixed(1);
          areaTxt.textContent = `Total Area: ${sqKm} km² / ${sqMi} mi²`;
          areaSection.appendChild(areaTxt);
          section.appendChild(areaSection);
        }
      }
    }

    return section;
  }

  _exportCSV(layers) {
    const rows = [];
    rows.push(['Layer', 'Feature ID', 'Name', 'Type', 'Tier', 'BDM', 'Revenue', 'Latitude', 'Longitude'].join(','));

    layers.forEach(layer => {
      (layer.features || []).forEach(f => {
        rows.push([
          Utils.escapeHtml(layer.name),
          f.id,
          Utils.escapeHtml(f.name || ''),
          layer.type,
          f.tier || '',
          f.bdm || '',
          f.revenue || '',
          f.latitude || '',
          f.longitude || ''
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
      });
    });

    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `salesmap_analytics_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

AppRegistry.whenReady('stateManager', () => {
  AppRegistry.register('analyticsPanel', null); // placeholder until init
});
