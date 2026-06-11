// Window manager: chunky 9x windows with pointer-event dragging (mouse +
// touch), resize, minimize/maximize, focus z-order, taskbar buttons, and
// geometry persisted per-window in storage.
import { store } from './store.js';
import { sfx } from './audio.js';

const windowsRoot = () => document.getElementById('windows');
const taskButtons = () => document.getElementById('task-buttons');

let zTop = 100;
const wins = new Map();

const isMobile = () => window.innerWidth < 700;

function clampRect(r) {
  const vw = window.innerWidth, vh = window.innerHeight - (isMobile() ? 46 : 40);
  r.w = Math.min(r.w, vw);
  r.h = Math.min(r.h, vh);
  r.x = Math.max(-r.w + 90, Math.min(r.x, vw - 60));
  r.y = Math.max(0, Math.min(r.y, vh - 34));
  return r;
}

export class Win {
  constructor({ id, title, icon = '🗔', x = 60, y = 40, w = 460, h = 360, resizable = true, onClose = null, onShow = null }) {
    this.id = id;
    this.title = title;
    this.icon = icon;
    this.onClose = onClose;
    this.onShow = onShow;
    this.maximized = false;

    const saved = store.get(`win.${id}.rect`);
    this.rect = clampRect(saved ? { ...saved } : { x, y, w, h });
    if (isMobile()) this.maximized = true;     // small screens: open full-bleed

    const el = document.createElement('section');
    el.className = 'win';
    el.dataset.id = id;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', title);
    el.innerHTML = `
      <header class="win-title">
        <span class="t-icon">${icon}</span>
        <span class="t-text">${title}</span>
        <span class="t-btns">
          <button class="btn b-min" title="Minimize" aria-label="Minimize">_</button>
          <button class="btn b-max" title="Maximize" aria-label="Maximize">□</button>
          <button class="btn b-close" title="Close" aria-label="Close">✕</button>
        </span>
      </header>
      <div class="win-body"></div>
      <div class="win-resize" title="Resize"></div>`;
    this.el = el;
    this.body = el.querySelector('.win-body');
    if (!resizable) el.querySelector('.win-resize').remove();

    el.querySelector('.b-min').addEventListener('click', () => this.minimize());
    el.querySelector('.b-max').addEventListener('click', () => this.toggleMax());
    el.querySelector('.b-close').addEventListener('click', () => this.close());
    el.querySelector('.win-title').addEventListener('dblclick', (e) => {
      if (!e.target.closest('.btn')) this.toggleMax();
    });
    el.addEventListener('pointerdown', () => this.focus(), { capture: true });

    this._wireDrag(el.querySelector('.win-title'));
    const rz = el.querySelector('.win-resize');
    if (rz) this._wireResize(rz);

    this._makeTaskButton();
    windowsRoot().appendChild(el);
    wins.set(id, this);
    this.applyRect();
    this.focus();
  }

  applyRect() {
    const { el, rect } = this;
    if (this.maximized) {
      el.classList.add('maximized');
      el.style.left = '0'; el.style.top = '0';
      el.style.width = '100%';
      el.style.height = `calc(100% - ${isMobile() ? 46 : 40}px)`;
    } else {
      el.classList.remove('maximized');
      el.style.left = rect.x + 'px';
      el.style.top = rect.y + 'px';
      el.style.width = rect.w + 'px';
      el.style.height = rect.h + 'px';
    }
  }

  persist() { store.set(`win.${this.id}.rect`, this.rect); }

  _wireDrag(handle) {
    let sx, sy, ox, oy, dragging = false;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.btn') || this.maximized) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      ox = this.rect.x; oy = this.rect.y;
      try { handle.setPointerCapture(e.pointerId); } catch {}
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.rect.x = ox + (e.clientX - sx);
      this.rect.y = oy + (e.clientY - sy);
      clampRect(this.rect);
      this.applyRect();
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch {}
      this.persist();                       // ← persistent window dragging
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  _wireResize(grip) {
    let sx, sy, ow, oh, sizing = false;
    grip.addEventListener('pointerdown', (e) => {
      if (this.maximized) return;
      sizing = true;
      sx = e.clientX; sy = e.clientY;
      ow = this.rect.w; oh = this.rect.h;
      try { grip.setPointerCapture(e.pointerId); } catch {}
      e.stopPropagation();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!sizing) return;
      this.rect.w = Math.max(240, ow + (e.clientX - sx));
      this.rect.h = Math.max(140, oh + (e.clientY - sy));
      this.applyRect();
    });
    const end = (e) => {
      if (!sizing) return;
      sizing = false;
      try { grip.releasePointerCapture(e.pointerId); } catch {}
      this.persist();
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  _makeTaskButton() {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = `${this.icon} ${this.title}`;
    b.addEventListener('click', () => {
      if (this.el.classList.contains('minimized')) this.restore();
      else if (this.el.classList.contains('focused')) this.minimize();
      else this.focus();
    });
    this.taskBtn = b;
    taskButtons().appendChild(b);
  }

  focus() {
    for (const w of wins.values()) {
      w.el.classList.remove('focused');
      w.taskBtn.classList.remove('active');
    }
    this.el.classList.remove('minimized');
    this.el.classList.add('focused');
    this.taskBtn.classList.add('active');
    this.el.style.zIndex = ++zTop;
    this.onShow?.();
  }

  minimize() {
    this.el.classList.add('minimized');
    this.el.classList.remove('focused');
    this.taskBtn.classList.remove('active');
    sfx.minimize();
    this.onHide?.();
  }

  restore() { this.focus(); }

  toggleMax() {
    this.maximized = !this.maximized;
    this.applyRect();
    this.el.querySelector('.b-max').textContent = this.maximized ? '❐' : '□';
    sfx.click();
  }

  close() {
    sfx.close();
    this.onClose?.();
    this.taskBtn.remove();
    this.el.remove();
    wins.delete(this.id);
  }

  get open() { return wins.has(this.id); }
  get visible() { return this.open && !this.el.classList.contains('minimized'); }
}

export const wm = {
  get(id) { return wins.get(id); },
  all() { return [...wins.values()]; },
  minimizeAll() { for (const w of wins.values()) w.el.classList.contains('minimized') || w.minimize(); },
  cycle() {
    const list = [...wins.values()].filter(w => w.open);
    if (!list.length) return;
    const idx = list.findIndex(w => w.el.classList.contains('focused'));
    list[(idx + 1) % list.length].focus();
  },
};

window.addEventListener('resize', () => {
  for (const w of wins.values()) { clampRect(w.rect); w.applyRect(); }
});
