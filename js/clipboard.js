// js/clipboard.js — Clipboard
//
// One copy path for the whole app.
//
// navigator.clipboard is the happy path, but it *rejects* for reasons the user
// can't act on and can't see: permission denied, an unfocused document, a
// browser that only permits writes synchronously inside the gesture. Checking
// whether the API exists is not enough — a rejection has to fall through to
// execCommand, and a total failure has to hand the text back in a selectable
// overlay rather than reporting a dead end the user can do nothing about.
//
// Dependency-free, so the live app and the share page can both load it.

const Clipboard = {

  // Resolves with the mechanism that worked; rejects only when both are blocked.
  async copy(text) {
    const value = String(text == null ? '' : text);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return 'clipboard-api';
      } catch (e) {
        // Deliberately swallowed: most failures that land here (denied
        // permission, unfocused document, Safari's synchronous-only rule) still
        // succeed on the execCommand path below.
      }
    }

    if (this._execCommandCopy(value)) return 'exec-command';
    throw new Error('Clipboard write was blocked');
  },

  _execCommandCopy(value) {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    // Invisible but on-screen and non-zero sized: browsers skip selection on
    // elements parked far off-screen, and display:none can't be selected at all.
    ta.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:none;' +
      'outline:none;box-shadow:none;background:transparent;opacity:0;';
    document.body.appendChild(ta);

    const previous = document.activeElement;
    let ok = false;
    try {
      ta.focus();
      ta.select();
      // iOS ignores select() on a readonly textarea without this.
      if (ta.setSelectionRange) ta.setSelectionRange(0, value.length);
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }

    document.body.removeChild(ta);
    if (previous && previous.focus) {
      try { previous.focus(); } catch (e) { /* the old node may be gone */ }
    }
    return ok;
  },

  _copyShortcut() {
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) ||
      navigator.platform || navigator.userAgent || '';
    return /Mac|iPhone|iPad|iPod/i.test(platform) ? '⌘C' : 'Ctrl+C';
  },

  // Last resort: show the text pre-selected so the user can copy it by hand.
  showManualCopy(text, title) {
    const existing = document.getElementById('manualCopyOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'manualCopyOverlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:100000;' +
      'display:flex;align-items:center;justify-content:center;padding:24px;';

    const box = document.createElement('div');
    box.style.cssText =
      'background:#fff;border-radius:10px;padding:20px;width:640px;max-width:100%;' +
      'max-height:80vh;display:flex;flex-direction:column;gap:10px;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.3);' +
      'font:13px/1.4 -apple-system,Segoe UI,system-ui,sans-serif;color:#222;';

    const heading = document.createElement('div');
    heading.style.cssText = 'font-weight:600;font-size:14px;';
    heading.textContent = title || 'Copy this text';

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:12px;color:#666;';
    hint.textContent = 'Your browser blocked the automatic copy. The text below is ' +
      'already selected — press ' + this._copyShortcut() + ' to copy it.';

    const ta = document.createElement('textarea');
    ta.readOnly = true;
    ta.value = String(text == null ? '' : text);
    ta.style.cssText =
      'flex:1;min-height:260px;width:100%;box-sizing:border-box;padding:8px;' +
      'border:1px solid #ccc;border-radius:6px;resize:vertical;' +
      'font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:flex-end;';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.style.cssText =
      'padding:7px 14px;background:#f0f0f0;border:1px solid #ddd;' +
      'border-radius:6px;font-size:13px;cursor:pointer;';
    close.addEventListener('click', () => overlay.remove());
    row.appendChild(close);

    box.appendChild(heading);
    box.appendChild(hint);
    box.appendChild(ta);
    box.appendChild(row);
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    ta.focus();
    ta.select();
    if (ta.setSelectionRange) ta.setSelectionRange(0, ta.value.length);
    return overlay;
  },

  // Copy, falling back to the manual overlay. Resolves true when the text
  // reached the clipboard on its own, false when the user has to finish the job.
  async copyOrShow(text, title) {
    try {
      await this.copy(text);
      return true;
    } catch (e) {
      console.warn('[Clipboard] Automatic copy blocked; showing manual fallback:', e);
      this.showManualCopy(text, title);
      return false;
    }
  }
};

if (typeof AppRegistry !== 'undefined' && AppRegistry && typeof AppRegistry.register === 'function') {
  AppRegistry.register('clipboard', Clipboard);
}
