// js/ui-components.js — UI Singletons

// ─── EventBus ──────────────────────────────────────────────────────────────
class EventBus {
  constructor() {
    this._listeners = new Map();
    this._wildcardListeners = new Set();
  }

  on(event, callback) {
    if (event === '*') {
      this._wildcardListeners.add(callback);
      return () => this._wildcardListeners.delete(callback);
    }
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(callback);
    return () => {
      const listeners = this._listeners.get(event);
      if (listeners) listeners.delete(callback);
    };
  }

  once(event, callback) {
    const unsub = this.on(event, (data) => {
      callback(data);
      unsub();
    });
    return unsub;
  }

  emit(event, data) {
    if (this._listeners.has(event)) {
      this._listeners.get(event).forEach(cb => {
        try { cb(data); } catch (e) { console.error(`[EventBus] Error in handler for '${event}':`, e); }
      });
    }
    this._wildcardListeners.forEach(cb => {
      try { cb(event, data); } catch (e) { console.error('[EventBus] Wildcard handler error:', e); }
    });
  }

  off(event, callback) {
    if (this._listeners.has(event)) {
      this._listeners.get(event).delete(callback);
    }
  }

  removeAllListeners(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
      this._wildcardListeners.clear();
    }
  }
}

// ─── ModalManager ──────────────────────────────────────────────────────────
class ModalManager {
  constructor() {
    this._openModals = [];
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this._openModals.length > 0) {
        this.close(this._openModals[this._openModals.length - 1]);
      }
    });
    document.addEventListener('click', e => {
      if (e.target.classList && e.target.classList.contains('modal')) {
        this.close(e.target.id);
      }
    });
  }

  show(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    if (!this._openModals.includes(id)) this._openModals.push(id);
    document.body.style.overflow = 'hidden';
  }

  close(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    this._openModals = this._openModals.filter(m => m !== id);
    if (this._openModals.length === 0) document.body.style.overflow = '';
  }

  closeAll() {
    [...this._openModals].forEach(id => this.close(id));
  }

  isOpen(id) {
    return this._openModals.includes(id);
  }
}

// ─── ToastManager ──────────────────────────────────────────────────────────
class ToastManager {
  constructor() {
    this._container = null;
  }

  _getContainer() {
    if (!this._container) {
      this._container = document.getElementById('toast-container');
      if (!this._container) {
        this._container = document.createElement('div');
        this._container.id = 'toast-container';
        document.body.appendChild(this._container);
      }
    }
    return this._container;
  }

  show(msg, type = 'info', duration) {
    const container = this._getContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = { success: '✓', error: '✗', warning: '⚠', info: 'ℹ' };
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = icons[type] || icons.info;

    const text = document.createElement('span');
    text.className = 'toast-message';
    text.textContent = msg;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.onclick = () => remove();

    toast.appendChild(icon);
    toast.appendChild(text);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    const d = duration || (type === 'error' ? AppConfig.ui.toastDurationLong : AppConfig.ui.toastDuration);
    const timer = setTimeout(remove, d);

    function remove() {
      clearTimeout(timer);
      toast.classList.remove('toast-visible');
      toast.classList.add('toast-hiding');
      setTimeout(() => toast.remove(), 300);
    }

    return remove;
  }

  success(msg, duration) { return this.show(msg, 'success', duration); }
  error(msg, duration) { return this.show(msg, 'error', duration); }
  warning(msg, duration) { return this.show(msg, 'warning', duration); }
  info(msg, duration) { return this.show(msg, 'info', duration); }
}

// ─── LoadingManager ────────────────────────────────────────────────────────
class LoadingManager {
  constructor() {
    this._overlay = null;
    this._messageEl = null;
    this._count = 0;
  }

  _init() {
    if (!this._overlay) {
      this._overlay = document.getElementById('loadingOverlay');
      this._messageEl = document.getElementById('loadingMessage');
    }
  }

  show(message = 'Loading...') {
    this._init();
    this._count++;
    if (this._overlay) {
      if (this._messageEl) this._messageEl.textContent = message;
      this._overlay.style.display = 'flex';
    }
  }

  hide() {
    this._init();
    this._count = Math.max(0, this._count - 1);
    if (this._count === 0 && this._overlay) {
      this._overlay.style.display = 'none';
    }
  }

  forceHide() {
    this._count = 0;
    if (this._overlay) this._overlay.style.display = 'none';
  }
}

// ─── ContextMenuManager ────────────────────────────────────────────────────
class ContextMenuManager {
  constructor() {
    this._activeMenu = null;
    document.addEventListener('click', () => this.hide());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.hide();
    });
  }

  show(menuId, x, y) {
    this.hide();
    const menu = document.getElementById(menuId);
    if (!menu) return;

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = 'block';
    menu.setAttribute('aria-hidden', 'false');
    this._activeMenu = menuId;

    // Keep within viewport
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) menu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > vh) menu.style.top = (y - rect.height) + 'px';
  }

  hide() {
    if (this._activeMenu) {
      const menu = document.getElementById(this._activeMenu);
      if (menu) {
        menu.style.display = 'none';
        menu.setAttribute('aria-hidden', 'true');
      }
      this._activeMenu = null;
    }
  }

  hideAll() {
    document.querySelectorAll('.context-menu').forEach(m => {
      m.style.display = 'none';
      m.setAttribute('aria-hidden', 'true');
    });
    this._activeMenu = null;
  }
}

// ─── DrawerManager ─────────────────────────────────────────────────────────
class DrawerManager {
  constructor() {
    this._drawer = null;
    this._titleEl = null;
    this._bodyEl = null;
    this._isOpen = false;
  }

  _init() {
    if (!this._drawer) {
      this._drawer = document.getElementById('detailDrawer');
      this._titleEl = document.getElementById('drawerTitle');
      this._bodyEl = document.getElementById('drawerBody');
      const closeBtn = document.getElementById('drawerClose');
      if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    }
  }

  open(contentFn, title = '', options = {}) {
    this._init();
    if (!this._drawer) return;

    if (this._titleEl) this._titleEl.textContent = title;
    if (this._bodyEl) {
      this._bodyEl.innerHTML = '';
      if (typeof contentFn === 'function') contentFn(this._bodyEl);
    }

    this._drawer.classList.add('drawer-open');
    this._isOpen = true;

    if (options.onClose) {
      this._onClose = options.onClose;
    }
  }

  close() {
    this._init();
    if (!this._drawer) return;
    this._drawer.classList.remove('drawer-open');
    this._isOpen = false;
    if (typeof this._onClose === 'function') {
      this._onClose();
      this._onClose = null;
    }
  }

  setTitle(title) {
    this._init();
    if (this._titleEl) this._titleEl.textContent = title;
  }

  setContent(contentFn) {
    this._init();
    if (this._bodyEl) {
      this._bodyEl.innerHTML = '';
      if (typeof contentFn === 'function') contentFn(this._bodyEl);
    }
  }

  isOpen() { return this._isOpen; }
}

// ─── FormManager ───────────────────────────────────────────────────────────
class FormManager {
  getData(formEl) {
    const data = {};
    const elements = formEl.querySelectorAll('input, select, textarea');
    elements.forEach(el => {
      if (!el.name) return;
      if (el.type === 'checkbox') {
        data[el.name] = el.checked;
      } else if (el.type === 'radio') {
        if (el.checked) data[el.name] = el.value;
      } else {
        data[el.name] = el.value;
      }
    });
    return data;
  }

  setData(formEl, data) {
    const elements = formEl.querySelectorAll('input, select, textarea');
    elements.forEach(el => {
      if (!el.name || !(el.name in data)) return;
      const val = data[el.name];
      if (el.type === 'checkbox') {
        el.checked = Boolean(val);
      } else if (el.type === 'radio') {
        el.checked = el.value === String(val);
      } else {
        el.value = val !== null && val !== undefined ? val : '';
      }
    });
  }

  reset(formEl) {
    formEl.reset();
  }
}

// ─── Register all singletons ───────────────────────────────────────────────
const eventBus = new EventBus();
const modalManager = new ModalManager();
const toastManager = new ToastManager();
const loadingManager = new LoadingManager();
const contextMenuManager = new ContextMenuManager();
const drawerManager = new DrawerManager();

AppRegistry.register('eventBus', eventBus);
AppRegistry.register('modalManager', modalManager);
AppRegistry.register('toastManager', toastManager);
AppRegistry.register('loadingManager', loadingManager);
AppRegistry.register('contextMenuManager', contextMenuManager);
AppRegistry.register('drawerManager', drawerManager);
