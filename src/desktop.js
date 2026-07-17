// Desktop shell: wallpapers, draggable icons with persisted positions,
// right-click (and long-press) context menu, start menu, taskbar tray.
import { store } from './store.js';
import { sfx, beat, setMuted, isMuted } from './audio.js';
import { wm } from './wm.js';

export const WALLPAPERS = [
  { name: 'Bliss Fields',
    css: `radial-gradient(140% 52% at 50% 108%, #58b449 0%, #2e7d32 55%, transparent 56%),
          linear-gradient(180deg, #7db9e8 0%, #2989d8 45%, #1e5799 100%)` },
  { name: 'Teal 95', css: `#008080` },
  { name: 'Vapor Sunset',
    css: `linear-gradient(180deg, #1b0a3a 0%, #6d2a8f 45%, #e85d9e 75%, #ffb56b 100%)` },
  { name: 'Energy Grid',
    css: `repeating-linear-gradient(0deg, rgba(43,212,43,.16) 0 1px, transparent 1px 42px),
          repeating-linear-gradient(90deg, rgba(43,212,43,.16) 0 1px, transparent 1px 42px),
          linear-gradient(180deg, #001a10 0%, #003828 100%)` },
  { name: 'Luna Olive',
    css: `linear-gradient(135deg, #5a6b3b 0%, #8a9a5b 50%, #c9d3a0 100%)` },
];

const GRID = { x0: 14, y0: 12, dx: 92, dy: 96 };

export class Desktop {
  constructor({ icons, onAbout }) {
    this.iconsDef = icons;
    this.onAbout = onAbout;
    this.el = document.getElementById('desktop');
    this.iconsEl = document.getElementById('icons');
    this.ctxEl = document.getElementById('ctx-menu');
    this.startEl = document.getElementById('start-menu');

    this.applyWallpaper(store.get('wallpaper', 1));   // default: Teal 95
    this.renderIcons();
    this._wireContextMenu();
    this._wireStartMenu();
    this._wireTray();
    this._clock();
  }

  // ------------------------------------------------------------ wallpaper
  applyWallpaper(i) {
    this.wallIdx = ((i % WALLPAPERS.length) + WALLPAPERS.length) % WALLPAPERS.length;
    this.el.style.background = WALLPAPERS[this.wallIdx].css;
    store.set('wallpaper', this.wallIdx);
  }
  nextWallpaper() {
    this.applyWallpaper(this.wallIdx + 1);
    toast(`Wallpaper: ${WALLPAPERS[this.wallIdx].name}`);
    sfx.ding();
  }

  // ------------------------------------------------------------ icons
  renderIcons() {
    this.iconsEl.innerHTML = '';
    const saved = store.get('icons.pos', {});
    this.iconsDef.forEach((def, i) => {
      const el = document.createElement('div');
      el.className = 'dicon';
      el.tabIndex = 0;
      el.dataset.id = def.id;
      el.innerHTML = `<span class="ico">${def.icon}</span><span class="lbl">${def.label}</span>`;
      const pos = saved[def.id] || this.gridPos(i);
      el.style.left = pos.x + 'px';
      el.style.top = pos.y + 'px';
      this._wireIcon(el, def);
      this.iconsEl.appendChild(el);
    });
  }

  gridPos(i) {
    const rows = Math.max(1, Math.floor((this.el.clientHeight - GRID.y0) / GRID.dy));
    return { x: GRID.x0 + Math.floor(i / rows) * GRID.dx, y: GRID.y0 + (i % rows) * GRID.dy };
  }

  autoArrange() {
    const pos = {};
    [...this.iconsEl.children].forEach((el, i) => {
      const p = this.gridPos(i);
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      pos[el.dataset.id] = p;
    });
    store.set('icons.pos', pos);
    this.flickerIcons();
    toast('Icons arranged');
    sfx.click();
  }

  refresh() {
    this.applyWallpaper(this.wallIdx);
    this.renderIcons();
    this.flickerIcons();
    sfx.click();
  }

  flickerIcons() {
    this.iconsEl.classList.remove('refreshing');
    void this.iconsEl.offsetWidth;          // restart the CSS animation
    this.iconsEl.classList.add('refreshing');
  }

  _wireIcon(el, def) {
    let sx, sy, ox, oy, moved = false, down = false;
    el.addEventListener('pointerdown', (e) => {
      down = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      ox = parseFloat(el.style.left); oy = parseFloat(el.style.top);
      try { el.setPointerCapture(e.pointerId); } catch {}
      [...this.iconsEl.children].forEach(c => c.classList.remove('selected'));
      el.classList.add('selected');
    });
    el.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      el.classList.add('dragging');
      el.style.left = Math.max(0, Math.min(ox + dx, this.el.clientWidth - 84)) + 'px';
      el.style.top = Math.max(0, Math.min(oy + dy, this.el.clientHeight - 70)) + 'px';
    });
    el.addEventListener('pointerup', (e) => {
      down = false;
      el.classList.remove('dragging');
      try { el.releasePointerCapture(e.pointerId); } catch {}
      if (moved) {
        const pos = store.get('icons.pos', {});
        pos[def.id] = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
        store.set('icons.pos', pos);
      } else {
        // single tap opens on touch; mouse uses dblclick
        if (e.pointerType !== 'mouse') { sfx.open(); def.open(); }
      }
    });
    el.addEventListener('dblclick', () => { sfx.open(); def.open(); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { sfx.open(); def.open(); }
    });
  }

  // ------------------------------------------------------------ context menu
  _menuItems() {
    return [
      { ico: '🔄', label: 'Refresh Desktop', act: () => this.refresh() },
      { sep: true },
      { ico: '▦', label: 'Auto-Arrange Icons', act: () => this.autoArrange() },
      { sep: true },
      { ico: '🗕', label: 'Minimize All', act: () => wm.minimizeAll() },
      { sep: true },
      { ico: '🖼️', label: `Change Wallpaper  (${WALLPAPERS[(this.wallIdx + 1) % WALLPAPERS.length].name})`,
        act: () => this.nextWallpaper() },
      { sep: true },
      { ico: 'ℹ️', label: 'About BOWMAN.EXE', act: () => this.onAbout?.() },
    ];
  }

  showMenu(x, y) {
    const m = this.ctxEl;
    m.innerHTML = '';
    for (const it of this._menuItems()) {
      if (it.sep) { m.appendChild(Object.assign(document.createElement('div'), { className: 'msep' })); continue; }
      const el = document.createElement('div');
      el.className = 'mi';
      el.setAttribute('role', 'menuitem');
      el.innerHTML = `<span class="mi-ico">${it.ico}</span>${it.label}`;
      el.addEventListener('click', () => { this.hideMenus(); it.act(); });
      m.appendChild(el);
    }
    m.hidden = false;
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, window.innerWidth - r.width - 4) + 'px';
    m.style.top = Math.min(y, window.innerHeight - r.height - 4) + 'px';
    sfx.menu();
  }

  hideMenus() { this.ctxEl.hidden = true; this.startEl.hidden = true; }

  _wireContextMenu() {
    this.el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (e.target.closest('.win')) { this.hideMenus(); return; }
      this.showMenu(e.clientX, e.clientY);
    });
    // long-press = right-click on touch
    let lpTimer = null;
    this.el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('.win')) return;
      lpTimer = setTimeout(() => this.showMenu(e.clientX, e.clientY), 550);
    });
    const cancelLp = () => { clearTimeout(lpTimer); lpTimer = null; };
    this.el.addEventListener('pointerup', cancelLp);
    this.el.addEventListener('pointermove', (e) => { if (lpTimer && e.movementY !== 0) cancelLp(); });
    window.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.menu') && !e.target.closest('#start-btn')) this.hideMenus();
    }, { capture: true });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hideMenus(); });
  }

  // ------------------------------------------------------------ start menu
  _wireStartMenu() {
    const btn = document.getElementById('start-btn');
    // ANY click inside the start menu closes it — item handlers run first
    // (bubble order), so actions still fire; clicks on the side strip,
    // separators or padding no longer leave it hanging open
    this.startEl.addEventListener('click', () => this.hideMenus());
    btn.addEventListener('click', () => {
      if (!this.startEl.hidden) { this.hideMenus(); return; }
      const m = this.startEl;
      m.innerHTML = `<div class="side">BOWMAN 95</div><div class="items"></div>`;
      const items = m.querySelector('.items');
      const add = (ico, label, act) => {
        const el = document.createElement('div');
        el.className = 'mi';
        el.innerHTML = `<span class="mi-ico">${ico}</span>${label}`;
        el.addEventListener('click', () => { this.hideMenus(); act(); });
        items.appendChild(el);
      };
      for (const d of this.iconsDef) add(d.icon, d.label, () => { sfx.open(); d.open(); });
      items.appendChild(Object.assign(document.createElement('div'), { className: 'msep' }));
      add('🔄', 'Refresh Desktop', () => this.refresh());
      add('▦', 'Auto-Arrange Icons', () => this.autoArrange());
      add('🗕', 'Minimize All', () => wm.minimizeAll());
      add('🖼️', 'Change Wallpaper', () => this.nextWallpaper());
      m.hidden = false;
      const r = m.getBoundingClientRect();
      m.style.left = '2px';
      m.style.top = (window.innerHeight - r.height - (window.innerWidth < 700 ? 48 : 42)) + 'px';
      sfx.menu();
    });
  }

  // ------------------------------------------------------------ tray
  _wireTray() {
    const musicBtn = document.getElementById('tray-music');
    const soundBtn = document.getElementById('tray-sound');
    const sync = () => {
      musicBtn.classList.toggle('off', !beat.playing);
      soundBtn.textContent = isMuted() ? '🔇' : '🔊';
    };
    musicBtn.addEventListener('click', () => { beat.toggle(); sync(); sfx.click(); });
    soundBtn.addEventListener('click', () => { setMuted(!isMuted()); sync(); });
    this.syncTray = sync;
    sync();
  }

  _clock() {
    const el = document.getElementById('tray-clock');
    const tick = () => {
      el.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    };
    tick();
    setInterval(tick, 20000);
  }
}

let toastTimer = null;
export function toast(text, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
