// js/notification-center.js — NotificationCenter

class NotificationCenter {
  constructor() {
    this._notifications = [];
    this._badgeEl = null;
    this._panelEl = null;
    this._unreadCount = 0;
  }

  initialize() {
    this._badgeEl = document.getElementById('notificationBadge');
    this._panelEl = document.getElementById('notificationPanel');

    // Listen for system events to create notifications
    eventBus.on('firebase.error', (data) => {
      this.addNotification('error', 'Sync Error', `Firebase sync failed: ${data?.message || 'Unknown error'}`);
    });

    // Only notify on genuine remote updates, not the initial profile load.
    // SyncController emits layers.updated{source:'realtime'} for remote changes;
    // layers.imported fires for both initial load and remote imports.
    eventBus.on('layers.updated', (data) => {
      if (data.source === 'realtime') {
        this.addNotification('info', 'Map Updated', 'Another user updated the map');
      }
    });

    eventBus.on('plugin.initialized', (data) => {
      this.addNotification('success', 'Plugin Ready', `Plugin initialized: ${data.pluginId}`);
    });
  }

  addNotification(type, title, message) {
    const notification = {
      id: Utils.generateId('notif'),
      type,
      title,
      message,
      timestamp: new Date(),
      read: false
    };

    this._notifications.unshift(notification);
    this._unreadCount++;
    this._updateBadge();
    this._prependToPanel(notification);
    return notification.id;
  }

  dismiss(id) {
    const idx = this._notifications.findIndex(n => n.id === id);
    if (idx === -1) return;
    const [n] = this._notifications.splice(idx, 1);
    if (!n.read) this._unreadCount = Math.max(0, this._unreadCount - 1);
    this._updateBadge();
    this.renderPanel();
  }

  clearAll() {
    this._notifications = [];
    this._unreadCount = 0;
    this._updateBadge();
    if (this._panelEl) this._panelEl.innerHTML = '';
  }

  markAllAsRead() {
    this._notifications.forEach(n => { n.read = true; });
    this._unreadCount = 0;
    this._updateBadge();
    // Update panel items visually
    if (this._panelEl) {
      this._panelEl.querySelectorAll('.notification-item').forEach(el => {
        el.classList.remove('unread');
      });
    }
  }

  renderPanel() {
    if (!this._panelEl) this._panelEl = document.getElementById('notificationPanel');
    if (!this._panelEl) return;
    this._panelEl.innerHTML = '';

    if (this._notifications.length === 0) {
      const empty = Utils.createElement('div', { className: 'notif-empty' }, 'No notifications');
      this._panelEl.appendChild(empty);
      return;
    }

    this._notifications.slice(0, 50).forEach(n => this._prependToPanel(n, true));
  }

  _prependToPanel(notification, append = false) {
    if (!this._panelEl) this._panelEl = document.getElementById('notificationPanel');
    if (!this._panelEl) return;

    const icons = { info: 'ℹ️', success: '✓', warning: '⚠️', error: '✗' };
    const item = Utils.createElement('div', { className: `notification-item notif-${notification.type}${notification.read ? '' : ' unread'}` });
    item.setAttribute('data-id', notification.id);

    const icon = Utils.createElement('span', { className: 'notif-icon' });
    icon.textContent = icons[notification.type] || 'ℹ️';

    const content = Utils.createElement('div', { className: 'notif-content' });
    const title = Utils.createElement('div', { className: 'notif-title' });
    title.textContent = notification.title;
    const msg = Utils.createElement('div', { className: 'notif-message' });
    msg.textContent = notification.message;
    const time = Utils.createElement('div', { className: 'notif-time' });
    time.textContent = Utils.formatRelativeTime(notification.timestamp);
    content.appendChild(title);
    content.appendChild(msg);
    content.appendChild(time);

    const dismissBtn = Utils.createElement('button', { className: 'notif-dismiss', title: 'Dismiss' }, '×');
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismiss(notification.id);
    });

    item.addEventListener('click', () => {
      if (!notification.read) {
        notification.read = true;
        this._unreadCount = Math.max(0, this._unreadCount - 1);
        this._updateBadge();
        item.classList.remove('unread');
      }
    });

    item.appendChild(icon);
    item.appendChild(content);
    item.appendChild(dismissBtn);

    if (append) {
      this._panelEl.appendChild(item);
    } else {
      this._panelEl.insertBefore(item, this._panelEl.firstChild);
    }
  }

  _updateBadge() {
    if (!this._badgeEl) this._badgeEl = document.getElementById('notificationBadge');
    if (!this._badgeEl) return;
    if (this._unreadCount > 0) {
      this._badgeEl.textContent = this._unreadCount > 99 ? '99+' : this._unreadCount;
      this._badgeEl.style.display = 'inline-flex';
    } else {
      this._badgeEl.style.display = 'none';
    }
  }

  getUnreadCount() { return this._unreadCount; }
  getNotifications() { return [...this._notifications]; }
}
