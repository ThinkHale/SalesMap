// plugins/scout-assistant.js — "Scout" AI assistant (OpenAI, client-side)
//
// Scout is an in-app assistant that can both advise the user and take actions by
// calling tools that drive the app (search places and add them to the map, plot
// routes, filter, navigate, etc.). It uses the OpenAI Chat Completions API with
// function calling.
//
// By default it calls the shared server proxy (Firebase callable `scoutChat`,
// see functions/index.js), which holds the OpenAI key server-side — so end users
// need no key of their own. If a user sets a personal key in Scout settings, that
// key is used directly from their browser instead.

const ScoutAssistantPlugin = {
  id: 'scout-assistant',
  name: 'Scout AI Assistant',
  version: '1.0.0',
  description: 'Scout — an AI assistant that guides you and takes actions: search places onto the map, plot routes, filter, and navigate. Uses the shared Scout backend (no key needed); a personal OpenAI key is optional.',
  author: 'SalesMapper',
  minAppVersion: '4.0.0',
  defaultEnabled: false,

  permissions: ['layers.read', 'layers.write', 'map.read', 'map.write', 'ui.toast', 'ui.slot:toolbar'],

  configSchema: {
    apiKey: { type: 'text', default: '', label: 'Personal OpenAI key (optional — blank uses the shared Scout backend)' },
    model:  { type: 'text', default: 'gpt-4o-mini', label: 'OpenAI model' }
  },

  _api: null,
  _launcher: null,
  _panel: null,
  _messagesEl: null,
  _inputEl: null,
  _history: [],
  _busy: false,
  _greeted: false,
  _placesService: null,
  _routeOverlays: [],

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  init(api) {
    this._api = api;
    api.ui.addToolbarButton({ icon: '🧭', tooltip: 'Scout AI assistant', onClick: () => this._togglePanel() });
    this._injectStyles();
    this._buildLauncher();
  },

  onEnable()  { if (this._launcher) this._launcher.style.display = 'flex'; },
  onDisable() { this._clearRoute(); this._closePanel(); if (this._launcher) this._launcher.style.display = 'none'; },
  destroy()   {
    this._clearRoute();
    ['scout-launcher', 'scout-panel', 'scout-styles'].forEach(id => document.getElementById(id)?.remove());
  },

  // ── UI ──────────────────────────────────────────────────────────────────────
  _injectStyles() {
    if (document.getElementById('scout-styles')) return;
    const css = `
      .scout-launcher { position: fixed; right: 20px; bottom: 20px; width: 56px; height: 56px; border-radius: 50%;
        background: #0078d4; border: none; box-shadow: 0 4px 16px rgba(0,0,0,0.3); cursor: pointer; z-index: 10000;
        display: flex; align-items: center; justify-content: center; transition: transform .15s; }
      .scout-launcher:hover { transform: scale(1.06); }
      /* .scout-avatar is the sprite slot — set background-image here to use a sprite. */
      .scout-avatar { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center;
        justify-content: center; font-size: 24px; background-size: cover; background-position: center; }
      .scout-panel { position: fixed; right: 20px; bottom: 88px; width: 380px; max-width: calc(100vw - 40px);
        height: 560px; max-height: calc(100vh - 120px); background: #fff; border-radius: 12px; z-index: 10000;
        box-shadow: 0 8px 40px rgba(0,0,0,0.28); display: none; flex-direction: column; overflow: hidden; }
      .scout-panel.open { display: flex; }
      .scout-header { background: #0078d4; color: #fff; padding: 12px 14px; display: flex; align-items: center; gap: 10px; }
      .scout-header .scout-avatar { width: 32px; height: 32px; font-size: 20px; background: rgba(255,255,255,0.15); }
      .scout-header .scout-title { font-weight: 600; font-size: 14px; flex: 1; }
      .scout-header .scout-title small { display: block; font-weight: 400; font-size: 11px; opacity: 0.85; }
      .scout-header button { background: transparent; border: none; color: #fff; cursor: pointer; font-size: 18px; line-height: 1; }
      .scout-messages { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; background: #f7f9fb; }
      .scout-msg { max-width: 85%; padding: 8px 11px; border-radius: 12px; font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }
      .scout-msg.user { align-self: flex-end; background: #0078d4; color: #fff; border-bottom-right-radius: 3px; }
      .scout-msg.assistant { align-self: flex-start; background: #fff; color: #201f1e; border: 1px solid #e1dfdd; border-bottom-left-radius: 3px; }
      .scout-action { align-self: flex-start; font-size: 11px; color: #605e5c; background: #eef3f8; border: 1px solid #dce6f0;
        padding: 3px 8px; border-radius: 10px; }
      .scout-error { align-self: center; font-size: 12px; color: #a4262c; background: #fde7e9; padding: 6px 10px; border-radius: 8px; }
      .scout-composer { border-top: 1px solid #edebe9; padding: 10px; display: flex; gap: 8px; background: #fff; }
      .scout-composer textarea { flex: 1; resize: none; border: 1px solid #c8c6c4; border-radius: 8px; padding: 8px 10px;
        font-size: 13px; font-family: inherit; max-height: 100px; }
      .scout-composer button { background: #0078d4; color: #fff; border: none; border-radius: 8px; padding: 0 14px; cursor: pointer; font-size: 13px; }
      .scout-composer button:disabled { opacity: 0.5; cursor: default; }
      .scout-setup { padding: 16px; font-size: 13px; color: #323130; }
      .scout-setup input { width: 100%; box-sizing: border-box; border: 1px solid #c8c6c4; border-radius: 8px; padding: 8px 10px; margin: 8px 0; font-size: 13px; }
      .scout-setup a { color: #0078d4; }
      .scout-typing { align-self: flex-start; color: #605e5c; font-size: 12px; font-style: italic; }
    `;
    const style = document.createElement('style');
    style.id = 'scout-styles';
    style.textContent = css;
    document.head.appendChild(style);
  },

  _buildLauncher() {
    if (document.getElementById('scout-launcher')) return;
    const btn = document.createElement('button');
    btn.id = 'scout-launcher';
    btn.className = 'scout-launcher';
    btn.title = 'Ask Scout';
    // Swap the emoji for a sprite later by setting a background-image on .scout-avatar.
    btn.innerHTML = '<span class="scout-avatar">🧭</span>';
    btn.addEventListener('click', () => this._togglePanel());
    document.body.appendChild(btn);
    this._launcher = btn;
  },

  _buildPanel() {
    if (this._panel) return;
    const panel = document.createElement('div');
    panel.id = 'scout-panel';
    panel.className = 'scout-panel';
    panel.innerHTML =
      '<div class="scout-header">' +
        '<span class="scout-avatar">🧭</span>' +
        '<div class="scout-title">Scout<small>Your map assistant</small></div>' +
        '<button title="Clear route / overlays Scout drew" data-scout-clear>🧹</button>' +
        '<button title="Close" data-scout-close>&times;</button>' +
      '</div>' +
      '<div class="scout-messages"></div>';
    document.body.appendChild(panel);
    panel.querySelector('[data-scout-clear]').addEventListener('click', () => {
      this._clearRoute();
      this._api.ui.toast.info('Cleared Scout route overlays');
    });
    panel.querySelector('[data-scout-close]').addEventListener('click', () => this._closePanel());
    this._panel = panel;
    this._messagesEl = panel.querySelector('.scout-messages');
    this._renderComposerOrSetup();
  },

  _renderComposerOrSetup() {
    // Scout works out of the box against the shared backend, so no key gate here.
    // A personal OpenAI key can still be set in the plugin's Settings drawer.
    this._panel.querySelector('.scout-composer')?.remove();

    const composer = document.createElement('div');
    composer.className = 'scout-composer';
    composer.innerHTML = '<textarea rows="1" placeholder="Ask Scout to find places, plot a route, filter…"></textarea><button data-scout-send>Send</button>';
    this._panel.appendChild(composer);
    this._inputEl = composer.querySelector('textarea');
    const sendBtn = composer.querySelector('[data-scout-send]');
    sendBtn.addEventListener('click', () => this._onSend());
    this._inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._onSend(); }
    });
    if (!this._history.length) this._greet();
  },

  _greet() {
    if (this._greeted) return;
    this._greeted = true;
    this._addMsg('assistant',
      "Hi, I'm Scout 🧭 — I can find places and add them to the map, plot routes, filter your data, and answer questions about SalesMap. Try: \"Find coffee shops near downtown Austin and add them\" or \"Plan a route through my Accounts layer.\"");
  },

  _togglePanel() {
    this._buildPanel();
    if (this._panel.classList.contains('open')) this._closePanel();
    else { this._panel.classList.add('open'); this._renderComposerOrSetup(); this._inputEl && this._inputEl.focus(); }
  },
  _closePanel() { this._panel && this._panel.classList.remove('open'); },

  // ── Message rendering ────────────────────────────────────────────────────────
  _addMsg(role, text) {
    const el = document.createElement('div');
    el.className = 'scout-msg ' + (role === 'user' ? 'user' : 'assistant');
    el.textContent = text;
    this._messagesEl.appendChild(el);
    this._scroll();
    return el;
  },
  _addAction(text) {
    const el = document.createElement('div');
    el.className = 'scout-action';
    el.textContent = '🔧 ' + text;
    this._messagesEl.appendChild(el);
    this._scroll();
  },
  _addError(text) {
    const el = document.createElement('div');
    el.className = 'scout-error';
    el.textContent = text;
    this._messagesEl.appendChild(el);
    this._scroll();
  },
  _scroll() { this._messagesEl.scrollTop = this._messagesEl.scrollHeight; },

  _setBusy(on) {
    this._busy = on;
    const btn = this._panel?.querySelector('[data-scout-send]');
    if (btn) btn.disabled = on;
    let typing = this._messagesEl.querySelector('.scout-typing');
    if (on && !typing) {
      typing = document.createElement('div');
      typing.className = 'scout-typing';
      typing.textContent = 'Scout is thinking…';
      this._messagesEl.appendChild(typing);
      this._scroll();
    } else if (!on && typing) {
      typing.remove();
    }
  },

  // ── Send / agent loop ─────────────────────────────────────────────────────────
  _apiKey() { return (this._api.config.get('apiKey') || '').trim(); },
  _model() { return (this._api.config.get('model') || 'gpt-4o-mini').trim(); },

  async _onSend() {
    if (this._busy) return;
    const text = (this._inputEl.value || '').trim();
    if (!text) return;
    this._inputEl.value = '';
    this._addMsg('user', text);
    this._history.push({ role: 'user', content: text });
    this._setBusy(true);

    try {
      const messages = [{ role: 'system', content: this._systemPrompt() }, ...this._history];
      let iterations = 0;
      while (iterations++ < 6) {
        const data = await this._callOpenAI(messages);
        const raw = data.choices && data.choices[0] && data.choices[0].message;
        if (!raw) throw new Error('Empty response from OpenAI');

        // Store a clean copy (drop provider-only fields like refusal/annotations).
        const assistantMsg = { role: 'assistant', content: raw.content ?? null };
        if (raw.tool_calls && raw.tool_calls.length) assistantMsg.tool_calls = raw.tool_calls;
        messages.push(assistantMsg);
        this._history.push(assistantMsg);

        if (raw.content) this._addMsg('assistant', raw.content);

        if (assistantMsg.tool_calls) {
          for (const tc of assistantMsg.tool_calls) {
            const name = tc.function.name;
            let args = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
            this._addAction(this._describeAction(name, args));
            let result;
            try { result = await this._runTool(name, args); }
            catch (e) { result = { error: e.message }; }
            const toolMsg = { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) };
            messages.push(toolMsg);
            this._history.push(toolMsg);
          }
          continue; // let the model react to tool results
        }
        break; // no tool calls → done
      }
    } catch (e) {
      this._addError(e.message || 'Something went wrong');
    } finally {
      this._setBusy(false);
      this._trimHistory();
    }
  },

  _trimHistory() {
    while (this._history.length > 30) this._history.shift();
    // Never start with an orphaned tool result or a dangling tool-call turn.
    while (this._history.length &&
      (this._history[0].role === 'tool' ||
       (this._history[0].role === 'assistant' && this._history[0].tool_calls))) {
      this._history.shift();
    }
  },

  async _callOpenAI(messages) {
    // Personal key → call OpenAI directly; otherwise use the shared server proxy.
    return this._apiKey() ? this._callDirect(messages) : this._callProxy(messages);
  },

  // Bring-your-own-key path: browser → OpenAI (key stays only in this browser).
  async _callDirect(messages) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this._apiKey() },
      body: JSON.stringify({ model: this._model(), messages, tools: this._toolSpecs(), tool_choice: 'auto', temperature: 0.3 })
    });
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j.error && j.error.message ? j.error.message : ''; } catch (e) {}
      throw new Error(`OpenAI ${res.status}: ${detail || res.statusText}`);
    }
    return res.json();
  },

  // Shared-backend path: browser → Firebase callable → OpenAI. The key lives only
  // on the server, so users need no key of their own.
  async _callProxy(messages) {
    if (typeof firebase === 'undefined' || !firebase.app || typeof firebase.app().functions !== 'function') {
      throw new Error('Scout backend unavailable (Firebase Functions SDK not loaded). Add a personal OpenAI key in Scout settings, or deploy the scoutChat function.');
    }
    try {
      const callable = firebase.app().functions('us-central1').httpsCallable('scoutChat');
      const res = await callable({ model: this._model(), messages, tools: this._toolSpecs() });
      return res.data;
    } catch (e) {
      throw new Error((e && e.message) ? e.message : 'Scout backend error');
    }
  },

  _systemPrompt() {
    const layers = this._api.layers.getAll().map(l => {
      const feats = l.features || [];
      const fields = feats.length ? Object.keys(feats[0]).filter(k => !['id', 'importedAt', 'source', 'wkt'].includes(k)) : [];
      return `- "${l.name}" (id:${l.id}, ${l.type}, ${feats.length} features, visible:${l.visible}, fields:[${fields.slice(0, 12).join(', ')}])`;
    }).join('\n') || '(no layers yet)';
    const mm = this._api.map.getMap();
    const c = mm && mm.getCenter ? mm.getCenter() : null;
    const view = c ? `center ${c.lat().toFixed(3)},${c.lng().toFixed(3)} zoom ${mm.getZoom()}` : 'unknown';

    return [
      "You are Scout, a friendly, concise assistant embedded in SalesMap, a Google-Maps-based sales territory mapping app.",
      "You help users understand the app and you TAKE ACTIONS on their behalf by calling the provided tools.",
      "Prefer acting over explaining when the user asks you to do something. After acting, briefly confirm what you did.",
      "A core strength: you can deeply analyze the user's data. Call analyze_data to inspect real property values — numeric aggregates (sum/avg/min/max) and category breakdowns — for a single layer or for all layers together. Do this before answering data questions or making recommendations, rather than guessing. The layer list below only has field names, not values.",
      "When a tool needs a layer, pass its id or exact name. Ask a short clarifying question only if genuinely ambiguous.",
      "The app can import CSV/Excel, draw points/polygons, cluster markers, and has plugins for filtering, choropleth shading, territory building, route optimizing, radius coverage, area measurement, and GeoJSON/KML export. Guide users to these when relevant.",
      "Keep replies short (1-3 sentences) unless asked for detail.",
      "CRITICAL: never invent or fabricate coordinates. Do not pass made-up lat/lng to add_points. To place points you must get real coordinates from a tool: search_places / geocode_add_point for named places, or suggest_locations for analytical requests.",
      "For requests like 'best N locations', 'where should I place …', 'optimal spots', or any placement based on existing data, ALWAYS call suggest_locations (which derives real, spread-out points from the user's data) — never guess coordinates yourself.",
      "",
      "Current map view: " + view,
      "Current layers:",
      layers
    ].join('\n');
  },

  _describeAction(name, args) {
    const a = Object.entries(args).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : v}`).join(', ');
    return `${name}(${a})`;
  },

  // ── Tool specifications (OpenAI function-calling schema) ──────────────────────
  _toolSpecs() {
    return [
      { type: 'function', function: { name: 'list_layers', description: 'List the map layers with their fields and feature counts (names/types only, not values).', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'analyze_data', description: 'Analyze the actual data values in layers: per field, numeric aggregates (count/min/max/sum/avg) or category breakdowns (top values with counts). Give a layer id/name to analyze one, or omit to analyze every layer individually PLUS a combined all-layers summary. Use this to answer any question about the data and to ground decisions (placement, routing, targeting).', parameters: { type: 'object', properties: { layer: { type: 'string', description: 'Optional layer id/name; omit for all layers + combined.' } } } } },
      { type: 'function', function: { name: 'get_map_view', description: 'Get the current map center and zoom.', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'search_places', description: 'Search Google Places for businesses/points of interest and add the results to the map as a new layer.', parameters: { type: 'object', properties: {
        query: { type: 'string', description: 'What to search for, e.g. "coffee shops", "hospitals in Denver".' },
        near: { type: 'string', description: 'Optional place/address to bias the search around. Defaults to the current map view.' },
        layer_name: { type: 'string', description: 'Optional name for the new layer.' },
        max: { type: 'number', description: 'Max results (default 20).' }
      }, required: ['query'] } } },
      { type: 'function', function: { name: 'geocode_add_point', description: 'Geocode a single address/place and add it as a point.', parameters: { type: 'object', properties: {
        address: { type: 'string' }, name: { type: 'string' }, layer_name: { type: 'string', description: 'Layer to add to (created if missing). Defaults to "Scout Pins".' }
      }, required: ['address'] } } },
      { type: 'function', function: { name: 'add_points', description: 'Add already-known points (with coordinates) to a layer.', parameters: { type: 'object', properties: {
        layer_name: { type: 'string' },
        points: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } }, required: ['lat', 'lng'] } }
      }, required: ['layer_name', 'points'] } } },
      { type: 'function', function: { name: 'plan_route', description: 'Order a point layer into an efficient visiting route and draw it (road-following when possible).', parameters: { type: 'object', properties: {
        layer: { type: 'string', description: 'Layer id or name to route.' },
        start: { type: 'string', enum: ['center', 'first'], description: 'Start from nearest pin to map center, or the first pin.' }
      }, required: ['layer'] } } },
      { type: 'function', function: { name: 'filter_features', description: 'Show only features matching a field condition. Categorical (values) or numeric range (min/max).', parameters: { type: 'object', properties: {
        field: { type: 'string' }, values: { type: 'array', items: { type: 'string' } }, min: { type: 'number' }, max: { type: 'number' }
      }, required: ['field'] } } },
      { type: 'function', function: { name: 'suggest_locations', description: 'Compute N candidate locations derived from the user\'s existing point data (e.g. best spots for yard signs) and add them as a new layer. Use this for any "best/optimal locations" request instead of inventing coordinates. Strategy "density" returns cluster centers where the data is concentrated; "coverage" spreads points to blanket the whole footprint.', parameters: { type: 'object', properties: {
        count: { type: 'number', description: 'How many locations (default 10).' },
        strategy: { type: 'string', enum: ['density', 'coverage'], description: 'density = near concentrations of existing data; coverage = spread evenly across the area.' },
        layer: { type: 'string', description: 'Optional source layer id/name; defaults to all visible point layers.' },
        layer_name: { type: 'string' }
      }, required: ['count'] } } },
      { type: 'function', function: { name: 'clear_filter', description: 'Clear any active feature filter.', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'clear_route', description: 'Remove the route line and numbered stop markers Scout drew on the map.', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'fit_to_layer', description: 'Zoom/pan the map to fit a layer.', parameters: { type: 'object', properties: { layer: { type: 'string' } }, required: ['layer'] } } },
      { type: 'function', function: { name: 'set_map_view', description: 'Move the map to an address or coordinates.', parameters: { type: 'object', properties: {
        address: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, zoom: { type: 'number' }
      } } } }
    ];
  },

  // ── Tool executors ────────────────────────────────────────────────────────────
  async _runTool(name, args) {
    switch (name) {
      case 'list_layers': return this._toolListLayers();
      case 'analyze_data': return this._toolAnalyzeData(args);
      case 'get_map_view': return this._toolMapView();
      case 'search_places': return this._toolSearchPlaces(args);
      case 'geocode_add_point': return this._toolGeocodeAdd(args);
      case 'add_points': return this._toolAddPoints(args);
      case 'suggest_locations': return this._toolSuggestLocations(args);
      case 'plan_route': return this._toolPlanRoute(args);
      case 'filter_features': return this._toolFilter(args);
      case 'clear_filter': this._api.map.clearFeatureFilter && this._api.map.clearFeatureFilter(); this._applyPolygonFilter(null); return { ok: true };
      case 'clear_route': this._clearRoute(); return { ok: true };
      case 'fit_to_layer': return this._toolFit(args);
      case 'set_map_view': return this._toolSetView(args);
      default: return { error: 'Unknown tool: ' + name };
    }
  },

  _findLayer(idOrName) {
    const layers = this._api.layers.getAll();
    return layers.find(l => l.id === idOrName) ||
      layers.find(l => l.name.toLowerCase() === String(idOrName || '').toLowerCase()) || null;
  },

  _toolListLayers() {
    return {
      layers: this._api.layers.getAll().map(l => {
        const feats = l.features || [];
        const fields = feats.length ? Object.keys(feats[0]).filter(k => !['id', 'importedAt', 'source'].includes(k)) : [];
        return { id: l.id, name: l.name, type: l.type, features: feats.length, visible: l.visible, fields: fields.slice(0, 15) };
      })
    };
  },

  _toolMapView() {
    const m = this._api.map.getMap();
    const c = m.getCenter();
    return { center: { lat: c.lat(), lng: c.lng() }, zoom: m.getZoom() };
  },

  _geocode(address) {
    return new Promise((resolve, reject) => {
      new google.maps.Geocoder().geocode({ address }, (r, status) => {
        if (status === 'OK' && r && r[0]) {
          const loc = r[0].geometry.location;
          resolve({ lat: loc.lat(), lng: loc.lng(), formatted: r[0].formatted_address });
        } else reject(new Error('Could not geocode "' + address + '" (' + status + ')'));
      });
    });
  },

  _placesSearch(query, location) {
    const svc = this._placesService || (this._placesService = new google.maps.places.PlacesService(this._api.map.getMap()));
    const req = { query };
    if (location) { req.location = new google.maps.LatLng(location.lat, location.lng); req.radius = 50000; }
    return new Promise((resolve, reject) => {
      svc.textSearch(req, (results, status) => {
        const S = google.maps.places.PlacesServiceStatus;
        if (status === S.OK && results) resolve(results);
        else if (status === S.ZERO_RESULTS) resolve([]);
        else reject(new Error('Places search failed (' + status + ')'));
      });
    });
  },

  async _toolSearchPlaces(args) {
    if (!google.maps.places) return { error: 'Places library not available' };
    let location = null;
    if (args.near) { try { location = await this._geocode(args.near); } catch (e) { /* fall back to global */ } }
    if (!location) { const c = this._api.map.getMap().getCenter(); location = { lat: c.lat(), lng: c.lng() }; }

    const results = await this._placesSearch(args.query, location);
    const max = Math.min(args.max || 20, results.length);
    const features = results.slice(0, max).map(p => ({
      id: Utils.generateId('feature'),
      name: p.name || 'Place',
      latitude: p.geometry.location.lat(),
      longitude: p.geometry.location.lng(),
      address: p.formatted_address || '',
      rating: p.rating != null ? p.rating : '',
      category: (p.types || [])[0] || ''
    }));
    if (features.length === 0) return { added: 0, message: 'No places found for that search.' };

    const layerName = args.layer_name || (args.query.slice(0, 40));
    const layer = this._api.layers.create(layerName, features, 'point', { source: 'scout-places', query: args.query });
    this._fitFeatures(features);
    this._api.ui.toast.success(`Scout added ${features.length} places: ${layerName}`);
    return { added: features.length, layer_id: layer.id, layer_name: layer.name, sample: features.slice(0, 5).map(f => f.name) };
  },

  async _toolGeocodeAdd(args) {
    const g = await this._geocode(args.address);
    const feature = { id: Utils.generateId('feature'), name: args.name || g.formatted, latitude: g.lat, longitude: g.lng, address: g.formatted };
    const layerName = args.layer_name || 'Scout Pins';
    let layer = this._findLayer(layerName);
    if (layer) this._api.layers.addFeatures(layer.id, [feature]);
    else layer = this._api.layers.create(layerName, [feature], 'point', { source: 'scout' });
    this._api.map.setCenter(g.lat, g.lng, 13);
    return { ok: true, layer_id: layer.id, layer_name: layer.name, name: feature.name, lat: g.lat, lng: g.lng };
  },

  _toolAddPoints(args) {
    const pts = (args.points || []).filter(p => !isNaN(parseFloat(p.lat)) && !isNaN(parseFloat(p.lng)));
    if (pts.length === 0) return { error: 'No valid points provided' };
    const features = pts.map(p => ({ id: Utils.generateId('feature'), name: p.name || 'Point', latitude: parseFloat(p.lat), longitude: parseFloat(p.lng) }));
    let layer = this._findLayer(args.layer_name);
    if (layer) this._api.layers.addFeatures(layer.id, features);
    else layer = this._api.layers.create(args.layer_name || 'Scout Pins', features, 'point', { source: 'scout' });
    this._fitFeatures(features);
    return { added: features.length, layer_id: layer.id, layer_name: layer.name };
  },

  _fitFeatures(features) {
    const bounds = new google.maps.LatLngBounds();
    features.forEach(f => bounds.extend({ lat: f.latitude, lng: f.longitude }));
    this._api.map.fitBounds(bounds);
  },

  // ── Data analysis ─────────────────────────────────────────────────────────────
  _round(n) { return Math.round(n * 100) / 100; },

  // Per-field stats over a set of features: numeric aggregates or category counts.
  _analyzeFeatures(feats) {
    const IGNORE = new Set(['id', 'importedAt', 'source', 'wkt', 'latitude', 'longitude', 'layerId', '_rowIndex']);
    const stats = {};
    feats.forEach(f => {
      Object.entries(f).forEach(([k, v]) => {
        if (IGNORE.has(k) || v === null || v === undefined || v === '') return;
        const s = stats[k] || (stats[k] = { count: 0, numeric: 0, sum: 0, min: Infinity, max: -Infinity, values: new Map() });
        s.count++;
        const n = Utils.parseNumber(v);
        if (!isNaN(n)) { s.numeric++; s.sum += n; if (n < s.min) s.min = n; if (n > s.max) s.max = n; }
        const key = String(v);
        s.values.set(key, (s.values.get(key) || 0) + 1);
      });
    });
    const out = {};
    Object.entries(stats).forEach(([k, s]) => {
      if (s.count > 0 && s.numeric / s.count >= 0.8) {
        out[k] = { type: 'numeric', count: s.count, min: this._round(s.min), max: this._round(s.max), sum: this._round(s.sum), avg: this._round(s.sum / s.numeric) };
      } else {
        const top = [...s.values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([value, count]) => ({ value, count }));
        out[k] = { type: 'categorical', count: s.count, unique: s.values.size, top };
      }
    });
    return out;
  },

  _toolAnalyzeData(args) {
    let layers = this._api.layers.getAll();
    if (args.layer) {
      const one = this._findLayer(args.layer);
      if (!one) return { error: 'Layer not found: ' + args.layer };
      layers = [one];
    }
    if (layers.length === 0) return { error: 'No layers to analyze. Import or add data first.' };

    const perLayer = layers.map(l => ({
      id: l.id, name: l.name, type: l.type, visible: l.visible,
      features: (l.features || []).length,
      fields: this._analyzeFeatures(l.features || [])
    }));
    const result = { layers: perLayer };
    if (!args.layer && layers.length > 1) {
      const all = [];
      layers.forEach(l => (l.features || []).forEach(f => all.push(f)));
      result.combined = { total_features: all.length, fields: this._analyzeFeatures(all) };
    }
    return result;
  },

  // ── Suggested locations (real, spread-out points derived from the data) ────────
  _toolSuggestLocations(args) {
    const count = Math.max(1, Math.min(parseInt(args.count, 10) || 10, 50));
    let layers = this._api.layers.getAll().filter(l => l.visible && (l.type === 'point' || l.type === 'mixed'));
    if (args.layer) { const one = this._findLayer(args.layer); if (one) layers = [one]; }

    const pts = [];
    layers.forEach(l => (l.features || []).forEach(f => {
      const lat = parseFloat(f.latitude), lng = parseFloat(f.longitude);
      if (!isNaN(lat) && !isNaN(lng)) pts.push({ lat, lng });
    }));
    if (pts.length < count) return { error: `Only ${pts.length} source point(s) available; need at least ${count}. Try a smaller count or add data.` };

    const strategy = args.strategy === 'coverage' ? 'coverage' : 'density';
    const centers = strategy === 'coverage' ? this._farthestPoints(pts, count) : this._kmeans(pts, count, 30);
    const features = centers.map((c, i) => ({
      id: Utils.generateId('feature'), name: `Location ${i + 1}`,
      latitude: c.lat, longitude: c.lng, basis: strategy
    }));
    const layerName = args.layer_name || `Suggested Locations (${count})`;
    const layer = this._api.layers.create(layerName, features, 'point', { source: 'scout-suggest', strategy });
    this._fitFeatures(features);
    this._api.ui.toast.success(`Scout suggested ${features.length} locations (${strategy})`);
    return {
      added: features.length, layer_id: layer.id, layer_name: layer.name, strategy,
      points: features.map(f => ({ name: f.name, lat: this._round(f.latitude * 1000) / 1000, lng: this._round(f.longitude * 1000) / 1000 }))
    };
  },

  _kmeans(points, k, iterations) {
    const sorted = [...points].sort((a, b) => a.lng - b.lng);
    const centroids = [];
    for (let i = 0; i < k; i++) centroids.push({ ...sorted[Math.floor((i + 0.5) / k * sorted.length)] });
    const assign = new Array(points.length).fill(0);
    for (let it = 0; it < iterations; it++) {
      let moved = false;
      for (let i = 0; i < points.length; i++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < k; c++) {
          const dl = points[i].lat - centroids[c].lat, dg = points[i].lng - centroids[c].lng;
          const d = dl * dl + dg * dg;
          if (d < bd) { bd = d; best = c; }
        }
        if (assign[i] !== best) { assign[i] = best; moved = true; }
      }
      const sums = Array.from({ length: k }, () => ({ lat: 0, lng: 0, n: 0 }));
      points.forEach((p, i) => { const s = sums[assign[i]]; s.lat += p.lat; s.lng += p.lng; s.n++; });
      for (let c = 0; c < k; c++) if (sums[c].n > 0) { centroids[c].lat = sums[c].lat / sums[c].n; centroids[c].lng = sums[c].lng / sums[c].n; }
      if (!moved && it > 0) break;
    }
    return centroids.map(c => ({ lat: c.lat, lng: c.lng }));
  },

  // Greedy farthest-point sampling: picks existing points spread across the extent.
  _farthestPoints(points, k) {
    const chosen = [points[0]];
    while (chosen.length < k) {
      let best = null, bestD = -1;
      for (const p of points) {
        let dmin = Infinity;
        for (const c of chosen) {
          const dl = p.lat - c.lat, dg = p.lng - c.lng;
          const d = dl * dl + dg * dg;
          if (d < dmin) dmin = d;
        }
        if (dmin > bestD) { bestD = dmin; best = p; }
      }
      if (!best) break;
      chosen.push(best);
    }
    return chosen.map(p => ({ lat: p.lat, lng: p.lng }));
  },

  // ── Routing (compact; road-following via Directions when available) ───────────
  async _toolPlanRoute(args) {
    const layer = this._findLayer(args.layer);
    if (!layer) return { error: 'Layer not found: ' + args.layer };
    const pts = (layer.features || [])
      .map(f => ({ lat: parseFloat(f.latitude), lng: parseFloat(f.longitude), name: f.name || 'Stop' }))
      .filter(p => !isNaN(p.lat) && !isNaN(p.lng));
    if (pts.length < 2) return { error: 'Need at least 2 points to route' };
    if (pts.length > 100) return { error: 'Too many points for Scout to route (>100); use the Route Optimizer plugin.' };

    let startIdx = 0;
    if (args.start !== 'first') {
      const c = this._api.map.getMap().getCenter();
      let best = Infinity;
      pts.forEach((p, i) => { const d = Utils.calculateDistance(c.lat(), c.lng(), p.lat, p.lng); if (d < best) { best = d; startIdx = i; } });
    }
    const order = this._orderPoints(pts, startIdx);

    this._clearRoute();
    this._drawRouteMarkers(order);

    let miles, roads = false;
    if (typeof google.maps.DirectionsService === 'function' && order.length <= 25) {
      try {
        const road = await this._roadRoute(order);
        this._drawRoutePolyline(road.path, false);
        miles = road.meters * 0.000621371;
        roads = true;
      } catch (e) { /* fall back below */ }
    }
    if (!roads) {
      this._drawRoutePolyline(order.map(p => ({ lat: p.lat, lng: p.lng })), true);
      let km = 0; for (let i = 1; i < order.length; i++) km += Utils.calculateDistance(order[i - 1].lat, order[i - 1].lng, order[i].lat, order[i].lng);
      miles = km * 0.621371;
    }
    this._api.ui.toast.success(`Scout planned a ${order.length}-stop route (${miles.toFixed(1)} mi)`);
    return { stops: order.length, miles: Math.round(miles * 10) / 10, road_following: roads, order: order.map(p => p.name).slice(0, 30) };
  },

  _orderPoints(points, startIdx) {
    const visited = new Array(points.length).fill(false);
    const order = [points[startIdx]];
    visited[startIdx] = true;
    for (let s = 1; s < points.length; s++) {
      const last = order[order.length - 1];
      let best = -1, bestD = Infinity;
      for (let i = 0; i < points.length; i++) {
        if (visited[i]) continue;
        const d = Utils.calculateDistance(last.lat, last.lng, points[i].lat, points[i].lng);
        if (d < bestD) { bestD = d; best = i; }
      }
      visited[best] = true; order.push(points[best]);
    }
    return order;
  },

  _roadRoute(order) {
    const ds = new google.maps.DirectionsService();
    const origin = { lat: order[0].lat, lng: order[0].lng };
    const destination = { lat: order[order.length - 1].lat, lng: order[order.length - 1].lng };
    const waypoints = order.slice(1, -1).map(p => ({ location: { lat: p.lat, lng: p.lng }, stopover: true }));
    return new Promise((resolve, reject) => {
      ds.route({ origin, destination, waypoints, optimizeWaypoints: false, travelMode: google.maps.TravelMode.DRIVING },
        (r, status) => {
          if (status !== 'OK' || !r) return reject(new Error(status));
          let meters = 0; const path = [];
          r.routes[0].legs.forEach(leg => { meters += leg.distance ? leg.distance.value : 0; });
          (r.routes[0].overview_path || []).forEach(pt => path.push(pt));
          resolve({ path, meters });
        });
    });
  },

  _drawRouteMarkers(order) {
    const map = this._api.map.getMap();
    order.forEach((p, i) => {
      this._routeOverlays.push(new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng }, map,
        label: { text: String(i + 1), color: '#fff', fontSize: '11px', fontWeight: 'bold' },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 11, fillColor: '#8764b8', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
        zIndex: 4000 + i
      }));
    });
    const bounds = new google.maps.LatLngBounds();
    order.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
    map.fitBounds(bounds, 60);
  },

  _drawRoutePolyline(path, dashed) {
    const map = this._api.map.getMap();
    const opts = { path, map, strokeColor: '#8764b8', strokeWeight: 4, strokeOpacity: dashed ? 0 : 0.85, zIndex: 3000 };
    if (dashed) opts.icons = [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, scale: 3 }, offset: '0', repeat: '12px' }];
    this._routeOverlays.push(new google.maps.Polyline(opts));
  },

  _clearRoute() {
    this._routeOverlays.forEach(o => o.setMap(null));
    this._routeOverlays = [];
  },

  // ── Filtering ─────────────────────────────────────────────────────────────────
  _toolFilter(args) {
    const field = args.field;
    const hasValues = Array.isArray(args.values) && args.values.length > 0;
    const hasRange = args.min != null || args.max != null;
    if (!field || (!hasValues && !hasRange)) return { error: 'Provide a field and either values or min/max' };

    const valSet = hasValues ? new Set(args.values.map(v => String(v).toLowerCase())) : null;
    const predicate = (f) => {
      if (!f) return true;
      const v = f[field];
      if (hasValues) return valSet.has(String(v == null ? '' : v).toLowerCase());
      const n = Utils.parseNumber(v);
      if (args.min != null && (isNaN(n) || n < args.min)) return false;
      if (args.max != null && (isNaN(n) || n > args.max)) return false;
      return true;
    };
    if (this._api.map.setFeatureFilter) this._api.map.setFeatureFilter(predicate);
    this._applyPolygonFilter(predicate);

    let shown = 0, total = 0;
    this._api.layers.getAll().forEach(l => { if (!l.visible) return; (l.features || []).forEach(f => { total++; if (predicate(f)) shown++; }); });
    return { field, shown, total };
  },

  _applyPolygonFilter(predicate) {
    const map = this._api.map.getMap();
    this._api.layers.getAll().forEach(layer => {
      const data = this._api.map.getLayerData(layer.id);
      if (!data) return;
      data.polygons.forEach(p => p.setMap((layer.visible && (!predicate || predicate(p._featureData))) ? map : null));
    });
  },

  _toolFit(args) {
    const layer = this._findLayer(args.layer);
    if (!layer) return { error: 'Layer not found: ' + args.layer };
    const feats = (layer.features || []).filter(f => !isNaN(parseFloat(f.latitude)));
    if (feats.length === 0) return { error: 'Layer has no point features to fit' };
    this._fitFeatures(feats.map(f => ({ latitude: parseFloat(f.latitude), longitude: parseFloat(f.longitude) })));
    return { ok: true, layer: layer.name };
  },

  async _toolSetView(args) {
    if (args.address) {
      const g = await this._geocode(args.address);
      this._api.map.setCenter(g.lat, g.lng, args.zoom || 12);
      return { ok: true, center: { lat: g.lat, lng: g.lng }, resolved: g.formatted };
    }
    if (args.lat != null && args.lng != null) {
      this._api.map.setCenter(args.lat, args.lng, args.zoom || 12);
      return { ok: true };
    }
    return { error: 'Provide address or lat/lng' };
  }
};

AppRegistry.whenReady('pluginRegistry', r => r.register(ScoutAssistantPlugin));
