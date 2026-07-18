// The application suite — 15 desktop apps in the XP spirit, built on the
// window manager. Each app is { id, icon, label, menu, open }. `menu` hints
// where the start menu places it ('left' = programs column, 'right' = places
// column). buildApps(ctx) wires apps that need desktop/theme/brain access.
import * as THREE from 'three';
import { Win, wm } from './wm.js';
import { sfx, beat, pianoNote, getAnalyser, setMixer, getMixer, modemDial } from './audio.js';
import { store } from './store.js';
import { PROJECTS } from './projects.js';
import { WALLPAPERS } from './desktop.js';
import { CONFIG } from './config.js';
import { Character } from './character.js';
import { webSearch, pageSummary, weatherAt, WMO_CODES } from './datalink.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

/** Open-or-focus helper: returns null when the window already exists. */
function shell(id, title, icon, opt = {}) {
  const ex = wm.get(id);
  if (ex) { ex.focus(); return null; }
  return new Win({ id, title, icon, ...opt });
}

// ============================================================ NOTEPAD
function openNotepad() {
  const win = shell('notepad', 'Untitled - Notepad', '📝', { x: 90, y: 70, w: 460, h: 380 });
  if (!win) return;
  win.body.innerHTML = `
    <div class="app-col">
      <div class="app-toolbar">
        <button class="btn b-save">Save as .txt</button>
        <button class="btn b-clear">Clear</button>
        <span class="spacer"></span><span class="np-count muted"></span>
      </div>
      <textarea class="np-text field" spellcheck="false" placeholder="…"></textarea>
    </div>`;
  const ta = $('.np-text', win.body);
  const count = $('.np-count', win.body);
  ta.value = store.get('notepad', '');
  const sync = () => { count.textContent = `${ta.value.length} chars`; store.set('notepad', ta.value); };
  ta.addEventListener('input', sync); sync();
  $('.b-clear', win.body).addEventListener('click', () => { ta.value = ''; sync(); sfx.click(); });
  $('.b-save', win.body).addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ta.value], { type: 'text/plain' }));
    a.download = 'untitled.txt';
    a.click();
    URL.revokeObjectURL(a.href);
    sfx.ding();
  });
}

// ============================================================ PAINT
function openPaint() {
  const win = shell('paint', 'untitled - Paint', '🎨', { x: 70, y: 50, w: 520, h: 430 });
  if (!win) return;
  const COLORS = ['#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4', '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#efe4b0', '#b5e61d'];
  win.body.innerHTML = `
    <div class="app-col">
      <div class="app-toolbar">
        <button class="btn b-pen pressed">✏️</button>
        <button class="btn b-eraser">🧽</button>
        <input type="range" class="p-size" min="1" max="24" value="3" title="Brush size">
        <button class="btn b-clear">Clear</button>
        <button class="btn b-save">Save PNG</button>
      </div>
      <div class="paint-wrap"><canvas class="p-canvas" width="640" height="420"></canvas></div>
      <div class="paint-palette">${COLORS.map(c => `<span class="p-swatch" style="background:${c}" data-c="${c}"></span>`).join('')}</div>
    </div>`;
  const cv = $('.p-canvas', win.body);
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.lineCap = g.lineJoin = 'round';
  let color = '#000000', erase = false, drawing = false, last = null;
  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height];
  };
  cv.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); try { cv.setPointerCapture(e.pointerId); } catch {} });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    g.strokeStyle = erase ? '#ffffff' : color;
    g.lineWidth = +$('.p-size', win.body).value * (erase ? 3 : 1);
    g.beginPath(); g.moveTo(...last); g.lineTo(...p); g.stroke();
    last = p;
  });
  cv.addEventListener('pointerup', () => { drawing = false; });
  win.body.querySelectorAll('.p-swatch').forEach(s => s.addEventListener('click', () => { color = s.dataset.c; erase = false; toolSel(false); }));
  const toolSel = (er) => {
    erase = er;
    $('.b-pen', win.body).classList.toggle('pressed', !er);
    $('.b-eraser', win.body).classList.toggle('pressed', er);
  };
  $('.b-pen', win.body).addEventListener('click', () => toolSel(false));
  $('.b-eraser', win.body).addEventListener('click', () => toolSel(true));
  $('.b-clear', win.body).addEventListener('click', () => { g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); sfx.click(); });
  $('.b-save', win.body).addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = 'untitled.png';
    a.click();
    sfx.ding();
  });
}

// ============================================================ MINESWEEPER
function openMines() {
  const win = shell('mines', 'Minesweeper', '💣', { x: 200, y: 80, w: 330, h: 420, resizable: false });
  if (!win) return;
  win.el.dataset.trapkeys = '1';
  const W = 9, H = 9, MINES = 10;
  win.body.innerHTML = `
    <div class="app-col mines">
      <div class="mines-top"><span class="m-count">010</span><button class="btn m-face">🙂</button><span class="m-time">000</span></div>
      <div class="mines-grid" style="grid-template-columns:repeat(${W},28px)"></div>
    </div>`;
  const grid = $('.mines-grid', win.body);
  const face = $('.m-face', win.body);
  const countEl = $('.m-count', win.body);
  const timeEl = $('.m-time', win.body);
  let cells, mines, revealed, flagged, started, dead, t0, timer;

  const idx = (x, y) => y * W + x;
  const around = (x, y) => {
    const out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H) out.push([nx, ny]);
    }
    return out;
  };
  const reset = () => {
    clearInterval(timer);
    cells = []; mines = new Set(); revealed = new Set(); flagged = new Set();
    started = false; dead = false;
    face.textContent = '🙂'; timeEl.textContent = '000'; countEl.textContent = String(MINES).padStart(3, '0');
    grid.innerHTML = '';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = el(`<button class="m-cell" data-x="${x}" data-y="${y}"></button>`);
      c.addEventListener('click', () => reveal(x, y));
      c.addEventListener('contextmenu', (e) => { e.preventDefault(); flag(x, y); });
      grid.appendChild(c); cells.push(c);
    }
  };
  const plant = (sx, sy) => {
    while (mines.size < MINES) {
      const x = Math.floor(Math.random() * W), y = Math.floor(Math.random() * H);
      if (Math.abs(x - sx) <= 1 && Math.abs(y - sy) <= 1) continue;
      mines.add(idx(x, y));
    }
    t0 = Date.now();
    timer = setInterval(() => { timeEl.textContent = String(Math.min(999, Math.floor((Date.now() - t0) / 1000))).padStart(3, '0'); }, 500);
  };
  const nAt = (x, y) => around(x, y).filter(([a, b]) => mines.has(idx(a, b))).length;
  const reveal = (x, y) => {
    if (dead || flagged.has(idx(x, y)) || revealed.has(idx(x, y))) return;
    if (!started) { started = true; plant(x, y); }
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      const i = idx(cx, cy);
      if (revealed.has(i) || flagged.has(i)) continue;
      revealed.add(i);
      const c = cells[i];
      c.classList.add('open');
      if (mines.has(i)) { c.textContent = '💥'; return boom(); }
      const n = nAt(cx, cy);
      if (n) { c.textContent = n; c.dataset.n = n; }
      else around(cx, cy).forEach(p => stack.push(p));
    }
    sfx.click();
    if (revealed.size === W * H - MINES) {
      dead = true; clearInterval(timer); face.textContent = '😎'; sfx.ding();
    }
  };
  const flag = (x, y) => {
    const i = idx(x, y);
    if (dead || revealed.has(i)) return;
    flagged.has(i) ? flagged.delete(i) : flagged.add(i);
    cells[i].textContent = flagged.has(i) ? '🚩' : '';
    countEl.textContent = String(MINES - flagged.size).padStart(3, '0');
    sfx.menu();
  };
  const boom = () => {
    dead = true; clearInterval(timer); face.textContent = '😵';
    mines.forEach(i => { if (!cells[i].textContent) { cells[i].classList.add('open'); cells[i].textContent = '💣'; } });
    sfx.error();
  };
  face.addEventListener('click', () => { reset(); sfx.click(); });
  win.onClose = () => clearInterval(timer);
  reset();
}

// ============================================================ CALCULATOR
function openCalc() {
  const win = shell('calc', 'Calculator', '🧮', { x: 240, y: 120, w: 250, h: 330, resizable: false });
  if (!win) return;
  win.body.innerHTML = `
    <div class="app-col calc">
      <input class="calc-display field" readonly value="0">
      <div class="calc-grid">
        ${['C', '±', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '⌫', '='].map(k =>
          `<button class="btn c-k" data-k="${k}">${k}</button>`).join('')}
      </div>
    </div>`;
  const disp = $('.calc-display', win.body);
  let acc = null, op = null, fresh = true;
  const apply = (a, b, o) => o === '+' ? a + b : o === '−' ? a - b : o === '×' ? a * b : b === 0 ? NaN : a / b;
  const show = (v) => { disp.value = String(v).length > 14 ? Number(v).toPrecision(10) : String(v); };
  win.body.querySelectorAll('.c-k').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.k;
    sfx.click();
    if (/[0-9]/.test(k)) { disp.value = (fresh || disp.value === '0') ? k : disp.value + k; fresh = false; return; }
    if (k === '.') { if (fresh) { disp.value = '0.'; fresh = false; } else if (!disp.value.includes('.')) disp.value += '.'; return; }
    if (k === 'C') { acc = op = null; fresh = true; show(0); return; }
    if (k === '⌫') { disp.value = disp.value.slice(0, -1) || '0'; return; }
    if (k === '±') { disp.value = String(-parseFloat(disp.value || '0')); return; }
    if (k === '%') { disp.value = String(parseFloat(disp.value || '0') / 100); return; }
    const cur = parseFloat(disp.value || '0');
    if (k === '=') {
      if (op !== null && acc !== null) { show(apply(acc, cur, op)); acc = null; op = null; fresh = true; }
      return;
    }
    // an operator
    acc = (op !== null && acc !== null && !fresh) ? apply(acc, cur, op) : cur;
    if (op !== null) show(acc);
    op = k; fresh = true;
  }));
}

// ============================================================ COMMAND PROMPT
function openCmd(ctx) {
  const win = shell('cmd', 'Command Prompt', '⌨️', { x: 120, y: 110, w: 520, h: 360 });
  if (!win) return;
  win.body.innerHTML = `
    <div class="app-col cmd">
      <div class="cmd-log"></div>
      <div class="cmd-row"><span class="cmd-ps">C:\\BOWMAN&gt;</span><input class="cmd-in" spellcheck="false" autocomplete="off"></div>
    </div>`;
  const log = $('.cmd-log', win.body);
  const input = $('.cmd-in', win.body);
  const print = (t = '') => { log.appendChild(el(`<div>${t.replace(/</g, '&lt;') || '&nbsp;'}</div>`)); log.scrollTop = 1e9; };
  print(`${CONFIG.appName} [Version 5.1.2600]`);
  print('(C) BOWMAN Megatrends, Inc. Type HELP for commands.');
  print();
  const CMDS = {
    help: () => ['HELP, VER, DIR, START <app>, TALK <msg>, CLS, COLOR, EXIT'].forEach(print),
    ver: () => print(`${CONFIG.appName} [Version 5.1.2600]`),
    cls: () => { log.innerHTML = ''; },
    exit: () => win.close(),
    color: () => { log.parentElement.classList.toggle('cmd-green'); },
    dir: () => {
      print(' Directory of C:\\BOWMAN\\PROJECTS');
      print();
      PROJECTS.forEach(p => print(`  ${p.id.toUpperCase().padEnd(18)} <EXHIBIT>  ${p.name}`));
      print(`       ${PROJECTS.length} exhibit(s)`);
    },
    start: (arg) => {
      const a = (ctx.allApps() || []).find(x => x.id === arg?.toLowerCase() || x.label.toLowerCase() === arg?.toLowerCase());
      if (a) { a.open(); print(`Starting ${a.label}…`); } else print(`'${arg}' is not recognized. Try DIR of your soul.`);
    },
    talk: async (arg) => {
      if (!arg) return print('Usage: TALK <message>');
      const brain = window.BOWMAN?.brain;
      if (!brain) return print('Brain offline.');
      const r = await brain.ask(arg, window.BOWMAN?.showroom?.project);
      print(`${CONFIG.guideName.toUpperCase()}: ${r.text}`);
      window.BOWMAN?.showroom?.character.talk(r.text, r.anim);
    },
  };
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const raw = input.value.trim();
    input.value = '';
    print(`C:\\BOWMAN&gt; ${raw}`);
    if (!raw) return;
    const [cmd, ...rest] = raw.split(/\s+/);
    const fn = CMDS[cmd.toLowerCase()];
    if (fn) await fn(rest.join(' '));
    else print(`'${cmd}' is not recognized as an internal or external command.`);
  });
  win.el.addEventListener('pointerdown', () => setTimeout(() => input.focus(), 0));
  setTimeout(() => input.focus(), 100);
}

// ============================================================ INTERNET EXPLORER
let ieNav = null;   // last IE window's navigate fn — lets Search deep-link

function openIEAt(ctx, url) {
  openIE(ctx);
  setTimeout(() => ieNav?.(url), 60);
}

function openIE(ctx) {
  const win = shell('iexplore', 'BOWMAN Portal - Internet Explorer', '🌐', { x: 60, y: 40, w: 560, h: 440 });
  if (!win) return;
  win.body.innerHTML = `
    <div class="app-col">
      <div class="app-toolbar">
        <button class="btn ie-back">◀</button>
        <button class="btn ie-home">🏠</button>
        <input class="field ie-url" value="bowman://home" spellcheck="false">
        <button class="btn ie-go">Go</button>
      </div>
      <div class="ie-page sunken"></div>
    </div>`;
  const page = $('.ie-page', win.body);
  const url = $('.ie-url', win.body);
  const hist = [];
  const nav = (u, push = true) => {
    if (push) hist.push(u);
    url.value = u;
    const escT = (s) => String(s).replace(/</g, '&lt;');
    if (u.startsWith('datalink://')) {
      // DATALINK: live article fetched from the real web (Wikipedia REST)
      const title = decodeURIComponent(u.slice('datalink://'.length));
      page.innerHTML = '<p class="muted">☎️ Dialing the datalink…</p>';
      pageSummary(title).then((s) => {
        page.innerHTML = `
          <h2>🌐 ${escT(s.title)}</h2>
          ${s.thumb ? `<img src="${s.thumb}" alt="" style="max-width:180px;float:right;margin:0 0 8px 10px;border:1px solid #ccc">` : ''}
          <p>${escT(s.extract)}</p>
          <p class="muted" style="font-size:11px">Live from Wikipedia via Datalink — fetched straight from your browser, no middleman.</p>
          ${s.url ? '<p><button class="btn ie-ext2">Open full article ↗</button></p>' : ''}`;
        $('.ie-ext2', page)?.addEventListener('click', () => window.open(s.url, '_blank', 'noopener'));
      }).catch((e) => {
        page.innerHTML = `<h3>📡 Datalink error</h3><p>${escT(e.message)} — the tubes may be clogged.</p>`;
      });
      return;
    }
    if (u.startsWith('websearch://')) {
      const q = decodeURIComponent(u.slice('websearch://'.length));
      page.innerHTML = `<p class="muted">🔎 Searching the web for “${escT(q)}”…</p>`;
      webSearch(q, 8).then(({ provider, results: hits }) => {
        page.innerHTML = `<h3>🌐 Web results for “${escT(q)}”</h3><p class="muted">via ${escT(provider)}</p>` +
          (hits.length ? hits.map((h, i) => h.kind === 'wiki'
              ? `<p>▸ <a href="#" data-u="datalink://${encodeURIComponent(h.title)}">${escT(h.title)}</a>${h.desc ? ` — <span class="muted">${escT(h.desc)}</span>` : ''}</p>`
              : `<p>▸ <a href="#" data-x="${i}">${escT(h.title)} ↗</a>${h.desc ? ` — <span class="muted">${escT(h.desc)}</span>` : ''}</p>`).join('')
                       : '<p class="muted">Nothing found out there.</p>');
        page.querySelectorAll('a[data-u]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); nav(a.dataset.u); sfx.click(); }));
        page.querySelectorAll('a[data-x]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); window.open(hits[+a.dataset.x].url, '_blank', 'noopener'); sfx.click(); }));
      }).catch((e) => { page.innerHTML = `<p>Datalink error: ${escT(e.message)}</p>`; });
      return;
    }
    if (u.startsWith('http')) {
      page.innerHTML = `<h3>🔒 External site</h3><p>Real websites can't be framed inside the portal, but I can open it in a new tab for you.</p><p><button class="btn ie-ext">Open ${u.replace(/</g, '&lt;')} ↗</button></p>`;
      $('.ie-ext', page).addEventListener('click', () => window.open(u, '_blank', 'noopener'));
      return;
    }
    const proj = u.match(/^bowman:\/\/project\/(.+)$/)?.[1];
    if (proj) {
      const p = PROJECTS.find(x => x.id === proj);
      if (p) {
        page.innerHTML = `
          <h2>${p.icon} ${p.name}</h2><p class="muted">${p.sub}</p>
          <p>${p.blurb}</p>
          <h4>Specifications</h4><ul>${p.specs.map(s => `<li>${s}</li>`).join('')}</ul>
          <h4>How it works</h4><p>${p.how}</p>
          <p><button class="btn ie-view">View in 3D showroom</button></p>`;
        $('.ie-view', page).addEventListener('click', () => {
          const i = PROJECTS.indexOf(p);
          ctx.openViewer?.();
          window.BOWMAN?.showroom?.setProject(i);
        });
        return;
      }
    }
    // home
    page.innerHTML = `
      <div class="ie-hero"><h1>⭐ BOWMAN PORTAL ⭐</h1><p>Your gateway to ${PROJECTS.length} handcrafted exhibits — best viewed at 800×600.</p></div>
      <p class="ie-searchrow">🌐 Search the real web:
        <input class="field ie-q" placeholder="anything…" spellcheck="false">
        <button class="btn ie-qgo">Datalink!</button></p>
      ${PROJECTS.map(p => `<p>▸ <a href="#" data-u="bowman://project/${p.id}">${p.icon} ${p.name}</a> — ${p.blurb}</p>`).join('')}
      <hr><p class="muted">You are visitor № ${Math.floor(Math.random() * 90000 + 10000)}. This page is under construction. 🚧</p>`;
    page.querySelectorAll('a[data-u]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); nav(a.dataset.u); sfx.click(); }));
    const q = $('.ie-q', page);
    const go = () => { if (q.value.trim()) nav('websearch://' + encodeURIComponent(q.value.trim())); };
    $('.ie-qgo', page)?.addEventListener('click', go);
    q?.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  };
  ieNav = nav;
  $('.ie-go', win.body).addEventListener('click', () => nav(url.value.trim()));
  url.addEventListener('keydown', (e) => { if (e.key === 'Enter') nav(url.value.trim()); });
  $('.ie-home', win.body).addEventListener('click', () => nav('bowman://home'));
  $('.ie-back', win.body).addEventListener('click', () => { hist.pop(); nav(hist.pop() || 'bowman://home'); });
  nav('bowman://home');
}

// ============================================================ MY COMPUTER
function openMyComputer() {
  const win = shell('mycomputer', 'My Computer', '💻', { x: 150, y: 90, w: 440, h: 380 });
  if (!win) return;
  win.body.classList.add('sunken');
  win.body.innerHTML = '<p>Interrogating hardware…</p>';
  (async () => {
    let gpu = 'WebGPU unavailable';
    try {
      const ad = await navigator.gpu?.requestAdapter();
      const info = ad?.info ?? {};
      gpu = [info.vendor, info.architecture, info.device].filter(Boolean).join(' · ') || 'WebGPU adapter (details hidden)';
    } catch { /* ignore */ }
    let quota = '';
    try {
      const est = await navigator.storage?.estimate();
      if (est) quota = `${(est.usage / 1048576).toFixed(1)} MB used of ${(est.quota / 1073741824).toFixed(1)} GB`;
    } catch { /* ignore */ }
    const sr = window.BOWMAN?.showroom;
    win.body.innerHTML = `
      <h3 style="margin-top:0">💻 System Properties</h3>
      <table class="kv-table">
        <tr><td>System</td><td>${CONFIG.appName} v5.1</td></tr>
        <tr><td>Renderer</td><td>${sr?.backendName ?? 'not started'} (three.js)</td></tr>
        <tr><td>Graphics</td><td>${gpu}</td></tr>
        <tr><td>CPU threads</td><td>${navigator.hardwareConcurrency ?? '?'}</td></tr>
        <tr><td>Device memory</td><td>${navigator.deviceMemory ? navigator.deviceMemory + ' GB (as reported)' : 'not reported'}</td></tr>
        <tr><td>Display</td><td>${screen.width}×${screen.height} @ ${devicePixelRatio}x</td></tr>
        <tr><td>Site storage</td><td>${quota || 'unknown'}</td></tr>
        <tr><td>Guide rig</td><td>${sr?.character?.usingFBX ? `FBX (${sr.character.report?.found?.length}/19 bones)` : 'procedural'}</td></tr>
      </table>
      <p class="muted" style="font-size:11px">Registered to: a very cool visitor.</p>`;
  })();
}

// ============================================================ RECYCLE BIN
function openRecycle() {
  const win = shell('recycle', 'Recycle Bin', '🗑️', { x: 260, y: 140, w: 400, h: 300 });
  if (!win) return;
  const ITEMS = [
    ['📄', 'new text document (2).txt', '1 KB'],
    ['🖼️', 'me_at_the_zoo_FINAL_v3(1).bmp', '2.4 MB'],
    ['📄', 'passwords DO NOT DELETE.txt', '1 KB'],
    ['💔', 'mixtape_2004.mp3', '3.1 MB'],
    ['🦴', 'buried_bone_backup.fbx', '42 MB'],
  ];
  const render = (items) => {
    win.body.innerHTML = `
      <div class="app-col">
        <div class="app-toolbar">
          <button class="btn b-restore" ${items.length ? '' : 'disabled'}>Restore all</button>
          <button class="btn b-empty" ${items.length ? '' : 'disabled'}>Empty Recycle Bin</button>
        </div>
        <div class="sunken" style="flex:1;overflow:auto">
          ${items.length ? items.map(([i, n, s]) => `<p>${i} ${n} <span class="muted">(${s})</span></p>`).join('')
                        : '<p class="muted">The Recycle Bin is empty. Serene. Zen, almost.</p>'}
        </div>
      </div>`;
    $('.b-empty', win.body)?.addEventListener('click', () => { render([]); sfx.error(); });
    $('.b-restore', win.body)?.addEventListener('click', () => { render([]); sfx.ding(); });
  };
  render(ITEMS);
}

// ============================================================ CLOCK & CALENDAR
function openClock() {
  const win = shell('clock', 'Date and Time', '🕒', { x: 300, y: 100, w: 380, h: 330, resizable: false });
  if (!win) return;
  win.body.innerHTML = `
    <div class="app-row-split">
      <div class="clock-side"><canvas class="clk" width="150" height="150"></canvas><div class="clk-digital"></div></div>
      <div class="cal-side"></div>
    </div>`;
  const cv = $('.clk', win.body), g = cv.getContext('2d');
  const dig = $('.clk-digital', win.body);
  const draw = () => {
    const now = new Date();
    g.clearRect(0, 0, 150, 150);
    g.save(); g.translate(75, 75);
    g.beginPath(); g.arc(0, 0, 70, 0, 7); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#666'; g.lineWidth = 3; g.stroke();
    for (let i = 0; i < 12; i++) {
      g.save(); g.rotate(i * Math.PI / 6);
      g.fillStyle = '#333'; g.fillRect(-1.5, -66, 3, 10);
      g.restore();
    }
    const h = now.getHours() % 12 + now.getMinutes() / 60;
    const m = now.getMinutes() + now.getSeconds() / 60;
    const s = now.getSeconds();
    const hand = (ang, len, wid, col) => {
      g.save(); g.rotate(ang);
      g.strokeStyle = col; g.lineWidth = wid; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 8); g.lineTo(0, -len); g.stroke(); g.restore();
    };
    hand(h * Math.PI / 6, 38, 5, '#222');
    hand(m * Math.PI / 30, 55, 3, '#222');
    hand(s * Math.PI / 30, 60, 1.5, '#c00');
    g.restore();
    dig.textContent = now.toLocaleTimeString();
  };
  const cal = () => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    let html = `<h4>${now.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h4><table class="cal-table"><tr>${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<th>${d}</th>`).join('')}</tr><tr>`;
    for (let i = 0; i < first.getDay(); i++) html += '<td></td>';
    for (let d = 1; d <= days; d++) {
      if ((first.getDay() + d - 1) % 7 === 0 && d !== 1) html += '</tr><tr>';
      html += `<td class="${d === now.getDate() ? 'today' : ''}">${d}</td>`;
    }
    $('.cal-side', win.body).innerHTML = html + '</tr></table>';
  };
  const timer = setInterval(draw, 1000);
  draw(); cal();
  win.onClose = () => clearInterval(timer);
}

// ============================================================ TASK MANAGER
function openTaskman() {
  const win = shell('taskman', 'Task Manager', '📊', { x: 320, y: 70, w: 380, h: 400 });
  if (!win) return;
  win.body.innerHTML = `
    <div class="app-col">
      <div class="sunken" style="height:90px;padding:4px"><canvas class="tm-graph" width="340" height="80"></canvas></div>
      <div class="tm-list sunken" style="flex:1;overflow:auto"></div>
      <div class="app-toolbar"><span class="tm-stats muted"></span><span class="spacer"></span></div>
    </div>`;
  const list = $('.tm-list', win.body);
  const stats = $('.tm-stats', win.body);
  const cv = $('.tm-graph', win.body), g = cv.getContext('2d');
  const samples = new Array(85).fill(0);
  let last = performance.now(), raf;
  const tick = (t) => {
    const dt = t - last; last = t;
    samples.push(Math.min(1, dt / 66));   // 15 fps == pegged
    samples.shift();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const render = () => {
    // graph
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = '#003c00'; g.lineWidth = 1;
    for (let x = 0; x < cv.width; x += 12) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, cv.height); g.stroke(); }
    g.strokeStyle = '#00d000'; g.lineWidth = 2; g.beginPath();
    samples.forEach((v, i) => { const x = i * 4, y = cv.height - v * (cv.height - 6) - 3; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    // processes
    list.innerHTML = '';
    for (const w of wm.all()) {
      const row = el(`<div class="tm-row"><span>${w.icon} ${w.title}</span><button class="btn tm-end">End Task</button></div>`);
      $('.tm-end', row).addEventListener('click', () => { w.close(); sfx.click(); });
      list.appendChild(row);
    }
    const mem = performance.memory ? ` · JS heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : '';
    stats.textContent = `Processes: ${wm.all().length} · frame load graph${mem}`;
  };
  const timer = setInterval(render, 900);
  render();
  win.onClose = () => { clearInterval(timer); cancelAnimationFrame(raf); };
}

// ============================================================ SNAKE
function openSnake() {
  const win = shell('snake', 'Snake', '🐍', { x: 220, y: 90, w: 360, h: 330, resizable: false });
  if (!win) return;
  win.el.dataset.trapkeys = '1';
  win.body.innerHTML = `
    <div class="app-col">
      <div class="app-toolbar"><span class="sn-score">Score: 0</span><span class="spacer"></span><span class="muted">arrows to steer</span></div>
      <canvas class="sn-cv" width="320" height="240" style="background:#9cb23c;image-rendering:pixelated"></canvas>
    </div>`;
  const cv = $('.sn-cv', win.body), g = cv.getContext('2d');
  const CELL = 16, W = 20, H = 15;
  let snake, dir, nextDir, food, score, dead, timer;
  const reset = () => {
    snake = [[10, 7], [9, 7], [8, 7]];
    dir = [1, 0]; nextDir = dir; score = 0; dead = false;
    placeFood();
    $('.sn-score', win.body).textContent = 'Score: 0';
  };
  const placeFood = () => {
    do { food = [Math.floor(Math.random() * W), Math.floor(Math.random() * H)]; }
    while (snake.some(([x, y]) => x === food[0] && y === food[1]));
  };
  const step = () => {
    if (dead) return;
    dir = nextDir;
    const head = [snake[0][0] + dir[0], snake[0][1] + dir[1]];
    if (head[0] < 0 || head[0] >= W || head[1] < 0 || head[1] >= H ||
        snake.some(([x, y]) => x === head[0] && y === head[1])) {
      dead = true; sfx.error(); return;
    }
    snake.unshift(head);
    if (head[0] === food[0] && head[1] === food[1]) {
      score += 10; $('.sn-score', win.body).textContent = 'Score: ' + score;
      sfx.click(); placeFood();
    } else snake.pop();
    draw();
  };
  const draw = () => {
    g.fillStyle = '#9cb23c'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#2c3608';
    snake.forEach(([x, y]) => g.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2));
    g.fillStyle = '#7a1f1f';
    g.fillRect(food[0] * CELL + 3, food[1] * CELL + 3, CELL - 6, CELL - 6);
    if (dead) {
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = '#fff'; g.font = 'bold 18px monospace'; g.textAlign = 'center';
      g.fillText('GAME OVER — click to restart', cv.width / 2, cv.height / 2);
    }
  };
  const keys = (e) => {
    if (!win.el.classList.contains('focused')) return;
    const map = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const d = map[e.key];
    if (!d) return;
    e.preventDefault();
    if (d[0] !== -dir[0] || d[1] !== -dir[1]) nextDir = d;
  };
  window.addEventListener('keydown', keys);
  cv.addEventListener('click', () => { if (dead) { reset(); draw(); } });
  timer = setInterval(step, 130);
  reset(); draw();
  win.onClose = () => { clearInterval(timer); window.removeEventListener('keydown', keys); };
}

// ============================================================ TIC-TAC-TOE
function openTicTacToe() {
  const win = shell('ttt', 'Tic-Tac-Toe vs ' + CONFIG.guideName, '⭕', { x: 280, y: 130, w: 260, h: 330, resizable: false });
  if (!win) return;
  win.body.innerHTML = `
    <div class="app-col" style="align-items:center">
      <div class="ttt-status">Your move — you are ✖</div>
      <div class="ttt-grid">${Array.from({ length: 9 }, (_, i) => `<button class="ttt-c" data-i="${i}"></button>`).join('')}</div>
      <button class="btn ttt-reset">New game</button>
    </div>`;
  const cells = [...win.body.querySelectorAll('.ttt-c')];
  const status = $('.ttt-status', win.body);
  let board, over;
  const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  const winner = (b) => { for (const [a, c, d] of LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a]; return b.every(Boolean) ? 'tie' : null; };
  const render = () => cells.forEach((c, i) => { c.textContent = board[i] === 'x' ? '✖' : board[i] === 'o' ? '⭕' : ''; });
  const finish = (w) => {
    over = true;
    status.textContent = w === 'tie' ? 'A tie. Respectable.' : w === 'x' ? 'You win! 🎉' : `${CONFIG.guideName} wins! *smug fox noise*`;
    (w === 'x' ? sfx.ding : sfx.error)();
  };
  const botMove = () => {
    const empty = board.map((v, i) => v ? null : i).filter(v => v !== null);
    const tryWin = (mark) => { for (const i of empty) { const b = [...board]; b[i] = mark; if (winner(b) === mark) return i; } return null; };
    const pick = tryWin('o') ?? tryWin('x') ?? (board[4] ? null : 4) ?? [0, 2, 6, 8].find(i => !board[i]) ?? empty[0];
    board[pick] = 'o';
    render();
    const w = winner(board);
    if (w) finish(w); else status.textContent = 'Your move.';
  };
  cells.forEach(c => c.addEventListener('click', () => {
    const i = +c.dataset.i;
    if (over || board[i]) return;
    board[i] = 'x'; render(); sfx.click();
    const w = winner(board);
    if (w) return finish(w);
    status.textContent = CONFIG.guideName + ' is thinking…';
    setTimeout(botMove, 350);
  }));
  const reset = () => { board = Array(9).fill(null); over = false; status.textContent = 'Your move — you are ✖'; render(); };
  $('.ttt-reset', win.body).addEventListener('click', () => { reset(); sfx.click(); });
  reset();
}

// ============================================================ SCREENSAVER
function openScreensaver() {
  if (document.getElementById('saver')) return;
  const ov = el('<div id="saver"><canvas></canvas></div>');
  document.body.appendChild(ov);
  const cv = ov.querySelector('canvas'), g = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  let x = 80, y = 80, vx = 2.2, vy = 1.7, hue = 120, raf;
  const loop = () => {
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, cv.width, cv.height);
    g.font = 'bold 42px Tahoma'; g.textBaseline = 'top';
    const w = g.measureText(CONFIG.appName).width;
    x += vx; y += vy;
    if (x < 0 || x + w > cv.width) { vx *= -1; hue = (hue + 47) % 360; }
    if (y < 0 || y + 48 > cv.height) { vy *= -1; hue = (hue + 47) % 360; }
    g.fillStyle = `hsl(${hue} 90% 60%)`;
    g.fillText(CONFIG.appName, x, y);
    raf = requestAnimationFrame(loop);
  };
  g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
  raf = requestAnimationFrame(loop);
  const off = () => { cancelAnimationFrame(raf); ov.remove(); window.removeEventListener('keydown', off); };
  ov.addEventListener('pointerdown', off);
  window.addEventListener('keydown', off);
}

// ============================================================ DISPLAY PROPERTIES
function openDisplay(ctx) {
  const win = shell('display', 'Display Properties', '🖥️', { x: 180, y: 60, w: 400, h: 430 });
  if (!win) return;
  win.body.innerHTML = `
    <div class="app-col" style="overflow:auto">
      <div class="disp-monitor"><div class="disp-screen"></div></div>
      <fieldset><legend>Theme</legend>
        <label><input type="radio" name="theme" value="xp"> Windows XP (Luna)</label><br>
        <label><input type="radio" name="theme" value="95"> Windows Classic (95)</label>
      </fieldset>
      <fieldset><legend>Wallpaper</legend><div class="wall-swatches"></div></fieldset>
    </div>`;
  const screenEl = $('.disp-screen', win.body);
  const syncPreview = () => { screenEl.style.background = WALLPAPERS[ctx.desktop.wallIdx].css; };
  const sw = $('.wall-swatches', win.body);
  WALLPAPERS.forEach((w, i) => {
    const s = el(`<div class="wall-swatch" title="${w.name}"></div>`);
    s.style.background = w.css;
    if (i === ctx.desktop.wallIdx) s.classList.add('current');
    s.addEventListener('click', () => {
      ctx.desktop.applyWallpaper(i);
      sw.querySelectorAll('.wall-swatch').forEach(x => x.classList.remove('current'));
      s.classList.add('current');
      syncPreview(); sfx.ding();
    });
    sw.appendChild(s);
  });
  const cur = store.get('theme', 'xp');
  win.body.querySelectorAll('input[name=theme]').forEach(r => {
    r.checked = r.value === cur;
    r.addEventListener('change', () => { ctx.setTheme(r.value); sfx.ding(); });
  });
  syncPreview();
}

// ============================================================ SEARCH (with companions!)
// The XP search sidekick, reborn in 3D: the actual FBX characters — with the
// full bone-retargeting/animation pipeline — take turns helping you dig
// through apps, projects, help topics and the live web.
const COMPANIONS = [
  {
    name: 'Spotty', species: 'African Wild Dog', fbx: 'src/AWD.fbx',
    lines: { idle: 'The pack is ready. What are we hunting?', search: '*ears swivel, nose to the ground*', found: 'Tracked it down! *victory yip*', none: 'Trail went cold… try other words?', pet: '*whole-body happy wiggle*' },
  },
  {
    name: 'Bowman variant 1', species: 'Wolf-Hyena', fbx: 'src/FORCOMMANDER17 - Copy.fbx',
    lines: { idle: 'The pack listens. What do we chase?', search: '*low cackle, nose working the ground*', found: 'Got it! *triumphant whoop*', none: 'Cold trail. Even my cackle went quiet.', pet: '*giggly hyena wheeze, tail going wild*' },
  },
  {
    name: 'Bowman variant 2', species: 'Wolf-Hyena', fbx: 'src/weekend21.fbx',
    lines: { idle: 'Relaxed hunt today. Whatcha need?', search: '*unhurried sniffing, very thorough*', found: 'There it is. Told you.', none: 'Nothing out there. Nap instead?', pet: '*melts into a happy heap*' },
  },
];

// Character instances are heavy (FBX parse + GPU upload) — cache for the
// session so switching companions back and forth is instant.
const companionCache = new Map();

/** Tiny three.js stage rendering a full Character in the search sidebar. */
class CompanionView {
  constructor(canvas) {
    this.canvas = canvas;
    this.char = null;
    this.ready = this._init();
  }
  async _init() {
    let r;
    try {
      r = new THREE.WebGPURenderer({ canvas: this.canvas, alpha: true, antialias: true });
      await r.init();
    } catch {
      r = new THREE.WebGPURenderer({ canvas: this.canvas, alpha: true, forceWebGL: true });
      await r.init();
    }
    this.renderer = r;
    r.setPixelRatio(1);                    // mini stage: resolution is plenty at 1×
    r.setSize(150, 170, false);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x777066, 1.9));
    const key = new THREE.DirectionalLight(0xfff4e0, 2.6);
    key.position.set(1.4, 2.4, 2.2);
    this.scene.add(key);
    this.camera = new THREE.PerspectiveCamera(38, 150 / 170, 0.1, 20);
    this.camera.position.set(0, 1.28, 1.75);
    this.camera.lookAt(0, 1.05, 0);
    this.clock = new THREE.Clock();
    // This is a SECOND render loop competing with the main showroom for the
    // GPU, so it plays nice: capped at 30 fps, and fully asleep whenever the
    // Search window is minimized/hidden (display:none ⇒ offsetWidth 0).
    let acc = 0;
    r.setAnimationLoop(() => {
      acc += Math.min(this.clock.getDelta(), 0.1);
      if (acc < 1 / 30 || !this.canvas.offsetWidth) return;
      if (this.char) this.char.update(acc, this.camera.position);   // head tracks YOU
      r.render(this.scene, this.camera);
      acc = 0;
    });
  }
  async show(def, onLoading) {
    await this.ready;
    let entry = companionCache.get(def.fbx);
    if (!entry) {
      const char = new Character();
      entry = { char, loaded: char.loadFBX(def.fbx).then(() => true).catch((e) => { console.warn('companion load failed:', e); return false; }) };
      companionCache.set(def.fbx, entry);
      onLoading?.();
    }
    const ok = await entry.loaded;
    if (this.char) this.scene.remove(this.char.root);
    this.char = entry.char;
    this.char.root.position.set(0, 0, 0);
    this.char.root.rotation.y = 0.12;
    this.scene.add(this.char.root);
    return ok;
  }
  setState(mood) {
    const map = { idle: 'idle', search: 'think', found: 'excited', none: 'headshake', pet: 'wave' };
    this.char?.setState(map[mood] ?? 'idle', { hold: mood === 'idle' ? 0 : 3 });
  }
  dispose() { this.renderer?.setAnimationLoop(null); }
}

function drawCompanion(g, kind, t, state, blink) {
  g.clearRect(0, 0, 120, 120);
  g.save();
  g.translate(60, 66);
  const bob = state === 'found' ? -Math.abs(Math.sin(t * 9)) * 10 : Math.sin(t * 2.2) * 2;
  const sad = state === 'none';
  g.translate(0, bob + (sad ? 4 : 0));
  const wag = Math.sin(t * (state === 'pet' || state === 'found' ? 16 : 5)) * (sad ? 0.08 : 0.5);
  const eyeH = blink ? 1.2 : 4;

  if (kind === 'awd') {
    // the African Wild Dog: white coat, black patches, ochre head with a
    // black mask, enormous round ears, white-tipped tail
    const earPerk = state === 'search' ? Math.sin(t * 12) * 0.12 : 0;
    g.fillStyle = '#f2efe6';
    g.beginPath(); g.ellipse(2, 14, 26, 19, 0, 0, 7); g.fill();               // body
    g.fillStyle = '#2b2b2b';                                                   // patches
    g.beginPath(); g.ellipse(14, 8, 9, 6, 0.6, 0, 7); g.fill();
    g.beginPath(); g.ellipse(-6, 22, 8, 5, -0.4, 0, 7); g.fill();
    g.fillStyle = '#c99a4e';
    g.beginPath(); g.ellipse(-2, 6, 7, 5, 0.3, 0, 7); g.fill();                // tan patch
    g.save(); g.translate(26, 8); g.rotate(-0.6 + wag);                        // tail
    g.fillStyle = '#2b2b2b'; g.fillRect(0, -3.5, 15, 7);
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(17, 0, 6, 4.5, 0, 0, 7); g.fill();
    g.restore();
    // ears first (behind head): the signature giant round ears
    g.fillStyle = '#1d1d1d';
    g.save(); g.rotate(-0.12 + earPerk);
    g.beginPath(); g.ellipse(-22, -36 - (sad ? -4 : 0), 11, 13, -0.15, 0, 7); g.fill(); g.restore();
    g.save(); g.rotate(0.12 - earPerk);
    g.beginPath(); g.ellipse(10, -37 - (sad ? -4 : 0), 11, 13, 0.15, 0, 7); g.fill(); g.restore();
    g.fillStyle = '#6b6257';
    g.beginPath(); g.ellipse(-21, -35, 5.5, 7, -0.15, 0, 7); g.fill();         // inner ears
    g.beginPath(); g.ellipse(9, -36, 5.5, 7, 0.15, 0, 7); g.fill();
    g.fillStyle = '#c99a4e';
    g.beginPath(); g.ellipse(-6, -18, 19, 16, 0, 0, 7); g.fill();              // ochre head
    g.fillStyle = '#1d1d1d';
    g.beginPath(); g.ellipse(-6, -24, 8, 7, 0, 0, 7); g.fill();                // black brow blaze
    g.beginPath(); g.ellipse(-13, -9, 9, 7, 0.2, 0, 7); g.fill();              // dark muzzle
    g.fillStyle = '#000';
    g.beginPath(); g.arc(-19, -11, 3, 0, 7); g.fill();                         // nose
    g.fillStyle = '#2ba8a0';                                                   // teal eyes
    g.fillRect(-10, -22, 4, eyeH); g.fillRect(2, -22, 4, eyeH);
    if (!blink) { g.fillStyle = '#000'; g.fillRect(-9, -21, 2, 2); g.fillRect(3, -21, 2, 2); }
  } else if (kind === 'dog') {
    g.fillStyle = '#b5813f';
    g.beginPath(); g.ellipse(0, 14, 26, 20, 0, 0, 7); g.fill();               // body
    g.save(); g.translate(24, 8); g.rotate(-0.7 + wag);                        // tail
    g.fillRect(0, -4, 20, 8); g.restore();
    g.beginPath(); g.ellipse(-6, -16, 20, 18, 0, 0, 7); g.fill();              // head
    g.fillStyle = '#8a5a24';
    g.beginPath(); g.ellipse(-22, -26, 7, 12, -0.5, 0, 7); g.fill();           // ears
    g.beginPath(); g.ellipse(9, -28, 7, 12, 0.4 + (state === 'search' ? Math.sin(t * 10) * 0.2 : 0), 0, 7); g.fill();
    g.fillStyle = '#7a4a1c';
    g.beginPath(); g.ellipse(-14, -8, 9, 7, 0, 0, 7); g.fill();                // muzzle
    g.fillStyle = '#222';
    g.beginPath(); g.arc(-18, -10, 3.2, 0, 7); g.fill();                       // nose
    g.fillRect(-8, -22, 3, eyeH); g.fillRect(2, -22, 3, eyeH);                 // eyes
  } else if (kind === 'bot') {
    g.fillStyle = '#9aa2ad';
    g.fillRect(-18, -2, 36, 32);                                               // body
    g.fillStyle = '#7d8590';
    g.fillRect(-16, -30, 32, 26);                                              // head
    g.fillStyle = '#0d1f12';
    g.fillRect(-12, -26, 24, 16);                                              // screen
    g.fillStyle = '#35e05a';
    if (sad) { g.fillRect(-9, -19, 6, 2); g.fillRect(3, -19, 6, 2); }
    else { g.fillRect(-9, -22, 5, eyeH + 2); g.fillRect(4, -22, 5, eyeH + 2); }
    if (state === 'search') { g.fillStyle = `hsl(${(t * 200) % 360} 80% 55%)`; g.fillRect(-12, -12, 24, 2); }
    g.save(); g.translate(0, -34); g.rotate(wag * 0.4);                        // antenna
    g.strokeStyle = '#666'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 4); g.lineTo(0, -8); g.stroke();
    g.fillStyle = '#e33'; g.beginPath(); g.arc(0, -10, 3.4, 0, 7); g.fill();
    g.restore();
  } else { // fox
    g.fillStyle = '#d97b29';
    g.beginPath(); g.ellipse(0, 14, 24, 18, 0, 0, 7); g.fill();                // body
    g.save(); g.translate(22, 12); g.rotate(-0.9 + wag);                       // tail
    g.beginPath(); g.ellipse(12, 0, 16, 8, 0, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(24, 0, 6, 6, 0, 0, 7); g.fill();
    g.restore();
    g.fillStyle = '#d97b29';
    g.beginPath(); g.moveTo(-24, -34); g.lineTo(-16, -14); g.lineTo(-30, -18); g.fill();  // ears
    g.beginPath(); g.moveTo(16, -36); g.lineTo(24, -16); g.lineTo(8, -18); g.fill();
    g.beginPath(); g.ellipse(-4, -18, 19, 16, 0, 0, 7); g.fill();              // head
    g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(-10, -10, 10, 8, 0.2, 0, 7); g.fill();            // white muzzle
    g.fillStyle = '#222';
    g.beginPath(); g.arc(-16, -12, 2.6, 0, 7); g.fill();                       // nose
    g.fillRect(-6, -24, 3, eyeH); g.fillRect(4, -24, 3, eyeH);                 // eyes
  }
  if (state === 'pet') {
    g.fillStyle = '#e2485f';
    for (let i = 0; i < 3; i++) {
      const hy = -46 - ((t * 40 + i * 22) % 40);
      g.font = '13px sans-serif';
      g.fillText('❤', -20 + i * 16, hy);
    }
  }
  g.restore();
}

function openSearch(ctx) {
  const win = shell('search', 'Search', '🔍', { x: 110, y: 60, w: 560, h: 440 });
  if (!win) return;
  win.body.innerHTML = `
    <div class="search-split">
      <div class="search-side">
        <div class="comp-stage">
          <canvas class="comp-cv" width="150" height="170" title="Click to pet!"></canvas>
          <div class="comp-hearts"></div>
        </div>
        <div class="comp-bubble"></div>
        <div class="comp-name muted"></div>
        <button class="btn comp-swap">Change character</button>
      </div>
      <div class="search-main">
        <div class="app-toolbar">
          <input class="field s-in" placeholder="Search apps, projects, help… and the web" spellcheck="false">
        </div>
        <div class="s-results sunken"></div>
      </div>
    </div>`;
  const cv = $('.comp-cv', win.body);
  const hearts = $('.comp-hearts', win.body);
  const bubble = $('.comp-bubble', win.body);
  const nameEl = $('.comp-name', win.body);
  const input = $('.s-in', win.body);
  const results = $('.s-results', win.body);
  const esc = (s) => String(s).replace(/</g, '&lt;');

  const view = new CompanionView(cv);
  let compIdx = store.get('search.companion', 0) % COMPANIONS.length;
  const comp = () => COMPANIONS[compIdx];
  const say = (which) => {
    bubble.textContent = comp().lines[which];
    nameEl.textContent = `${comp().name} the search ${comp().species}`;
  };
  const setState = (mood) => { say(mood); view.setState(mood); };
  const showCompanion = async () => {
    say('idle');
    const ok = await view.show(comp(), () => { bubble.textContent = `*${comp().name} is on the way… (first load)*`; });
    if (!ok) bubble.textContent = `${comp().name} got lost on the way here. Try another character?`;
    else say('idle');
  };
  cv.addEventListener('pointerdown', () => {
    setState('pet');
    sfx.ding();
    for (let i = 0; i < 4; i++) {
      const h = el(`<span class="heart" style="left:${28 + Math.random() * 80}px;animation-delay:${i * 0.14}s">❤</span>`);
      hearts.appendChild(h);
      setTimeout(() => h.remove(), 1600 + i * 140);
    }
  });
  $('.comp-swap', win.body).addEventListener('click', () => {
    compIdx = (compIdx + 1) % COMPANIONS.length;
    store.set('search.companion', compIdx);
    sfx.click();
    showCompanion();
  });

  const corpus = () => [
    ...ctx.allApps().map(a => ({ icon: a.icon, title: a.label, sub: 'Application', act: () => a.open() })),
    ...PROJECTS.map(p => ({
      icon: p.icon, title: p.name, sub: `Exhibit — ${p.blurb}`, keys: (p.keywords || []).join(' '),
      act: () => { ctx.openViewer?.(); window.BOWMAN?.showroom?.setProject(PROJECTS.indexOf(p)); },
    })),
    { icon: '⌨️', title: 'Keyboard shortcuts', sub: 'Help topic', act: () => ctx.allApps().find(a => a.id === 'help')?.open() },
    { icon: '🔒', title: 'Privacy & memory', sub: 'Help topic — "forget me", encryption', act: () => ctx.allApps().find(a => a.id === 'settings')?.open() },
  ];

  // DATALINK: live web results appended below the local ones
  let webToken = 0;
  const webRun = async (q) => {
    const token = ++webToken;
    const sec = el('<div class="s-websec"><div class="s-webhead">🌐 Datalink — live web results</div><p class="muted" style="padding:2px 8px">dialing…</p></div>');
    results.appendChild(sec);
    try {
      const { provider, results: hits } = await webSearch(q, 5);
      if (token !== webToken) return;                       // stale query
      sec.querySelector('p')?.remove();
      sec.querySelector('.s-webhead').textContent = `🌐 Datalink — live results via ${provider}`;
      if (!hits.length) {
        sec.appendChild(el('<p class="muted" style="padding:2px 8px">The web has nothing. Suspicious.</p>'));
        return;
      }
      for (const h of hits) {
        const sub = h.kind === 'wiki' ? (h.desc || 'Wikipedia article — click to read via Datalink')
                                      : `${h.desc || h.url} — opens in a new tab`;
        const row = el(`<div class="s-row"><span class="s-ico">🌐</span><span><b>${esc(h.title)}</b><br><span class="muted">${esc(sub)}</span></span></div>`);
        row.addEventListener('click', () => {
          if (h.kind === 'wiki') openIEAt(ctx, 'datalink://' + h.title);
          else window.open(h.url, '_blank', 'noopener');
          sfx.open();
        });
        sec.appendChild(row);
      }
      setState('found');
    } catch (err) {
      if (token !== webToken) return;
      sec.querySelector('p')?.remove();
      sec.appendChild(el(`<p class="muted" style="padding:2px 8px">Datalink offline (${esc(err.message)}).</p>`));
    }
  };

  let debounce;
  const run = () => {
    const q = input.value.trim().toLowerCase();
    results.innerHTML = '';
    webToken++;                                             // cancel stale web fetches
    if (!q) { setState('idle'); results.innerHTML = '<p class="muted" style="padding:8px">Type to search apps, exhibits — and the real web. Or pet the assistant. All productive.</p>'; return; }
    const hits = corpus().filter(r =>
      r.title.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q) || (r.keys || '').toLowerCase().includes(q));
    if (hits.length) {
      setState('found');
      for (const h of hits.slice(0, 10)) {
        const row = el(`<div class="s-row"><span class="s-ico">${h.icon}</span><span><b>${esc(h.title)}</b><br><span class="muted">${esc(h.sub)}</span></span></div>`);
        row.addEventListener('click', () => { h.act(); sfx.open(); });
        results.appendChild(row);
      }
    } else {
      setState('none');
      results.innerHTML = `<p class="muted" style="padding:8px">Nothing local matched “${esc(input.value)}”. Checking the web…</p>`;
    }
    webRun(q);
  };
  input.addEventListener('input', () => {
    setState('search');
    clearTimeout(debounce);
    debounce = setTimeout(run, 380);
  });
  showCompanion();
  run();
  win.onClose = () => view.dispose();
  setTimeout(() => input.focus(), 120);
}

// ============================================================ VISUALIZER
function openVisualizer() {
  const win = shell('visualizer', 'Visualizer', '🎚️', { x: 300, y: 60, w: 360, h: 240, resizable: false });
  if (!win) return;
  win.body.innerHTML = `<div class="app-col"><canvas class="viz" width="330" height="170" style="background:#000"></canvas>
    <div class="app-toolbar"><button class="btn v-play">▶ Music</button><span class="muted">spectrum of the music bus</span></div></div>`;
  const cv = $('.viz', win.body), g = cv.getContext('2d');
  $('.v-play', win.body).addEventListener('click', () => { beat.toggle(); sfx.click(); });
  let raf;
  const loop = () => {
    const an = getAnalyser();
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    if (an) {
      const data = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(data);
      const bars = 32, bw = cv.width / bars;
      for (let i = 0; i < bars; i++) {
        const v = data[Math.floor(i * data.length / bars / 1.6)] / 255;
        const h = v * (cv.height - 8);
        g.fillStyle = `hsl(${120 - v * 110} 90% 50%)`;
        for (let y = 0; y < h; y += 7) g.fillRect(i * bw + 2, cv.height - 4 - y - 5, bw - 4, 5);
      }
    } else {
      g.fillStyle = '#2bd42b'; g.font = '12px monospace';
      g.fillText('click ▶ Music to feed me', 80, 90);
    }
    raf = requestAnimationFrame(loop);
  };
  loop();
  win.onClose = () => cancelAnimationFrame(raf);
}

// ============================================================ CHARACTER MAP
function openCharmap() {
  const win = shell('charmap', 'Character Map', '🔣', { x: 200, y: 100, w: 420, h: 340 });
  if (!win) return;
  const CHARS = '☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼†‡°±×÷≈≠≤≥∞µΩ∑√∫αβγδεπστφω®©™«»¿¡№☎✂✈✉✎✓✗★☆♻�category⚡❄❤➔' .replace('category','');
  win.body.innerHTML = `<div class="app-col"><div class="cm-grid sunken">${[...CHARS].map(c => `<button class="cm-c" title="copy">${c}</button>`).join('')}</div>
    <div class="app-toolbar"><span class="cm-status muted">Click a character to copy it.</span></div></div>`;
  const status = $('.cm-status', win.body);
  win.body.querySelectorAll('.cm-c').forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.textContent); status.textContent = `Copied ${b.textContent} to the clipboard.`; sfx.click(); }
    catch { status.textContent = 'Clipboard blocked by the browser.'; }
  }));
}

// ============================================================ PIANO
function openPiano() {
  const win = shell('piano', 'Piano', '🎹', { x: 160, y: 200, w: 480, h: 220, resizable: false });
  if (!win) return;
  win.el.dataset.trapkeys = '1';
  const NOTES = [['C', 60], ['C#', 61], ['D', 62], ['D#', 63], ['E', 64], ['F', 65], ['F#', 66], ['G', 67], ['G#', 68], ['A', 69], ['A#', 70], ['B', 71], ['C', 72], ['C#', 73], ['D', 74], ['D#', 75], ['E', 76]];
  const KEYMAP = 'awsedftgyhujkolp;';
  win.body.innerHTML = `<div class="app-col"><div class="piano-keys">${NOTES.map(([n, m], i) =>
    `<button class="pk ${n.includes('#') ? 'black' : 'white'}" data-m="${m}"><span>${KEYMAP[i] ?? ''}</span></button>`).join('')}</div>
    <p class="muted" style="text-align:center">play with the mouse or the ${KEYMAP.toUpperCase()} keys</p></div>`;
  const play = (m) => pianoNote(m, 96, 0, 1.4);
  win.body.querySelectorAll('.pk').forEach(k => k.addEventListener('pointerdown', () => { play(+k.dataset.m); k.classList.add('pressed'); setTimeout(() => k.classList.remove('pressed'), 180); }));
  const keys = (e) => {
    if (!win.el.classList.contains('focused') || e.repeat) return;
    const i = KEYMAP.indexOf(e.key);
    if (i >= 0 && NOTES[i]) { play(NOTES[i][1]); e.preventDefault(); }
  };
  window.addEventListener('keydown', keys);
  win.onClose = () => window.removeEventListener('keydown', keys);
}

// ============================================================ PONG
function openPong() {
  const win = shell('pong', 'Pong', '🏓', { x: 240, y: 110, w: 420, h: 320, resizable: false });
  if (!win) return;
  win.body.innerHTML = `<div class="app-col"><div class="app-toolbar"><span class="pg-score">0 : 0</span><span class="spacer"></span><span class="muted">mouse moves your paddle</span></div>
    <canvas class="pg" width="380" height="230" style="background:#000"></canvas></div>`;
  const cv = $('.pg', win.body), g = cv.getContext('2d');
  let py = 95, ay = 95, bx = 190, by = 115, vx = 3, vy = 1.6, ps = 0, as = 0, timer;
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect();
    py = Math.max(0, Math.min(190, (e.clientY - r.top) * cv.height / r.height - 20));
  });
  const step = () => {
    bx += vx; by += vy;
    if (by < 4 || by > cv.height - 4) vy *= -1;
    if (bx < 16 && by > py && by < py + 40) { vx = Math.abs(vx) * 1.04; vy += (by - py - 20) * 0.06; sfx.click(); }
    if (bx > cv.width - 16 && by > ay && by < ay + 40) { vx = -Math.abs(vx) * 1.04; sfx.click(); }
    ay += Math.sign(by - ay - 20) * Math.min(2.6, Math.abs(by - ay - 20) * 0.1);
    if (bx < 0) { as++; reset(); } else if (bx > cv.width) { ps++; reset(); }
    $('.pg-score', win.body).textContent = `${ps} : ${as}`;
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#fff';
    for (let y = 0; y < cv.height; y += 16) g.fillRect(cv.width / 2 - 1, y, 2, 8);
    g.fillRect(8, py, 6, 40); g.fillRect(cv.width - 14, ay, 6, 40);
    g.fillRect(bx - 4, by - 4, 8, 8);
  };
  const reset = () => { bx = cv.width / 2; by = cv.height / 2; vx = (Math.random() < 0.5 ? 3 : -3); vy = (Math.random() - 0.5) * 3; if (ps >= 5 || as >= 5) { (ps >= 5 ? sfx.ding : sfx.error)(); ps = 0; as = 0; } };
  timer = setInterval(step, 1000 / 60);
  win.onClose = () => clearInterval(timer);
}

// ============================================================ BREAKOUT
function openBreakout() {
  const win = shell('breakout', 'Breakout', '🧱', { x: 260, y: 90, w: 420, h: 350, resizable: false });
  if (!win) return;
  win.body.innerHTML = `<div class="app-col"><div class="app-toolbar"><span class="bo-hud">Lives: 3</span></div>
    <canvas class="bo" width="380" height="260" style="background:#000"></canvas></div>`;
  const cv = $('.bo', win.body), g = cv.getContext('2d');
  let px = 160, bx, by, vx, vy, lives, bricks, timer;
  const COLS = 10, ROWS = 5;
  const reset = (full) => {
    if (full) { lives = 3; bricks = Array.from({ length: COLS * ROWS }, () => true); }
    bx = cv.width / 2; by = 170; vx = 2.4 * (Math.random() < 0.5 ? 1 : -1); vy = -3;
  };
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect();
    px = Math.max(0, Math.min(cv.width - 60, (e.clientX - r.left) * cv.width / r.width - 30));
  });
  const step = () => {
    bx += vx; by += vy;
    if (bx < 4 || bx > cv.width - 4) vx *= -1;
    if (by < 4) vy = Math.abs(vy);
    if (by > cv.height - 14 && bx > px && bx < px + 60) { vy = -Math.abs(vy); vx += (bx - px - 30) * 0.05; sfx.click(); }
    else if (by > cv.height) { lives--; sfx.error(); if (lives <= 0) reset(true); else reset(false); }
    const c = Math.floor(bx / (cv.width / COLS)), r0 = Math.floor((by - 20) / 14);
    if (r0 >= 0 && r0 < ROWS && c >= 0 && c < COLS && bricks[r0 * COLS + c]) {
      bricks[r0 * COLS + c] = false; vy *= -1; sfx.menu();
      if (bricks.every(b => !b)) { sfx.ding(); reset(true); }
    }
    $('.bo-hud', win.body).textContent = `Lives: ${lives} · Bricks: ${bricks.filter(Boolean).length}`;
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    bricks.forEach((b, i) => {
      if (!b) return;
      const row = Math.floor(i / COLS);
      g.fillStyle = `hsl(${row * 34} 85% 55%)`;
      g.fillRect((i % COLS) * (cv.width / COLS) + 2, 20 + row * 14, cv.width / COLS - 4, 11);
    });
    g.fillStyle = '#fff';
    g.fillRect(px, cv.height - 10, 60, 6);
    g.fillRect(bx - 4, by - 4, 8, 8);
  };
  reset(true);
  timer = setInterval(step, 1000 / 60);
  win.onClose = () => clearInterval(timer);
}

// ============================================================ MEMORY MATCH
function openMemory() {
  const win = shell('memory', 'Memory Match', '🃏', { x: 220, y: 80, w: 330, h: 400, resizable: false });
  if (!win) return;
  const EMOJI = ['🦴', '🌵', '🚀', '🎈', '🐟', '⚙️', '🌙', '🍕'];
  let first = null, lock = false, moves = 0, matched = 0;
  const deck = [...EMOJI, ...EMOJI].sort(() => Math.random() - 0.5);
  win.body.innerHTML = `<div class="app-col" style="align-items:center">
    <div class="mem-hud muted">Moves: 0</div>
    <div class="mem-grid">${deck.map((e, i) => `<button class="mem-c" data-i="${i}" data-e="${e}">?</button>`).join('')}</div></div>`;
  const hud = $('.mem-hud', win.body);
  win.body.querySelectorAll('.mem-c').forEach(c => c.addEventListener('click', () => {
    if (lock || c.classList.contains('done') || c === first) return;
    c.textContent = c.dataset.e; sfx.click();
    if (!first) { first = c; return; }
    moves++; hud.textContent = `Moves: ${moves}`;
    if (first.dataset.e === c.dataset.e) {
      first.classList.add('done'); c.classList.add('done');
      matched++; first = null; sfx.ding();
      if (matched === EMOJI.length) hud.textContent = `Cleared in ${moves} moves! 🎉`;
    } else {
      lock = true;
      const a = first; first = null;
      setTimeout(() => { a.textContent = '?'; c.textContent = '?'; lock = false; }, 700);
    }
  }));
}

// ============================================================ WINVER
function openWinver() {
  const win = shell('winver', `About ${CONFIG.appName}`, '🪟', { x: 270, y: 150, w: 380, h: 260, resizable: false });
  if (!win) return;
  win.body.classList.add('sunken');
  win.body.innerHTML = `
    <h2 style="margin:4px 0">🪟 ${CONFIG.appName}</h2>
    <p><b>Version 5.1</b> (Build 2600.bowman_sp3)<br>© ${new Date().getFullYear()} ${CONFIG.brandName}, Inc.</p>
    <p>This product is licensed to:<br><b>A distinguished visitor</b><br>and their ${PROJECTS.length} favorite exhibits</p>
    <p class="muted" style="font-size:11px">Physical memory available to the desktop: yes.</p>`;
}

// ============================================================ DEFRAG
function openDefrag() {
  const win = shell('defrag', 'Disk Defragmenter', '🧩', { x: 190, y: 70, w: 440, h: 330 });
  if (!win) return;
  const N = 640;
  win.body.innerHTML = `<div class="app-col">
    <div class="dfg-grid sunken">${Array.from({ length: N }, () => '<i></i>').join('')}</div>
    <div class="app-toolbar"><button class="btn dfg-go">Defragment C:</button><span class="dfg-status muted">Analysis: your files are an absolute mess.</span></div></div>`;
  const cells = [...win.body.querySelectorAll('.dfg-grid i')];
  const status = $('.dfg-status', win.body);
  cells.forEach(c => { c.className = Math.random() < 0.55 ? 'frag' : Math.random() < 0.5 ? 'used' : ''; });
  let timer;
  $('.dfg-go', win.body).addEventListener('click', () => {
    clearInterval(timer);
    sfx.click();
    let i = 0;
    const frags = cells.map((c, idx) => [c, idx]).filter(([c]) => c.className === 'frag');
    timer = setInterval(() => {
      for (let k = 0; k < 6 && i < frags.length; k++, i++) {
        frags[i][0].className = 'used';
        cells[i % cells.length].classList.add('scan');
        setTimeout(((el2) => () => el2.classList.remove('scan'))(cells[i % cells.length]), 120);
      }
      status.textContent = `Defragmenting… ${Math.round(i / frags.length * 100)}%`;
      if (i >= frags.length) {
        clearInterval(timer);
        status.textContent = 'Defragmentation complete. The files feel much better now.';
        sfx.ding();
      }
    }, 60);
  });
  win.onClose = () => clearInterval(timer);
}

// ============================================================ DIAL-UP
function openDialup() {
  const win = shell('dialup', 'Dial-Up Networking', '☎️', { x: 300, y: 170, w: 340, h: 240, resizable: false });
  if (!win) return;
  win.body.innerHTML = `<div class="app-col" style="align-items:center;justify-content:center;gap:10px">
    <p>📞 Connect to: <b>BOWMANNET (56k)</b></p>
    <div class="progress" style="width:85%"><i></i></div>
    <p class="du-status muted">Ready to dial. Headphones advised.</p>
    <button class="btn du-dial">☎️ Dial</button></div>`;
  const status = $('.du-status', win.body);
  const bar = win.body.querySelector('.progress i');
  let timer;
  $('.du-dial', win.body).addEventListener('click', (e) => {
    e.target.disabled = true;
    const dur = modemDial() || 5.4;
    const t0 = performance.now();
    const MSGS = ['Dialing…', 'Handshaking…', 'Negotiating protocols…', 'Screaming at the phone line…', 'Verifying username and password…'];
    timer = setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / (dur * 1000));
      bar.style.width = `${p * 100}%`;
      status.textContent = MSGS[Math.min(MSGS.length - 1, Math.floor(p * MSGS.length))];
      if (p >= 1) {
        clearInterval(timer);
        status.textContent = '✅ Connected at 56,000 bps. The Datalink is hot.';
        e.target.disabled = false;
        sfx.ding();
      }
    }, 120);
  });
  win.onClose = () => clearInterval(timer);
}

// ============================================================ WEATHER
function openWeather() {
  const win = shell('weather', 'Weather', '⛅', { x: 320, y: 100, w: 340, h: 320 });
  if (!win) return;
  win.body.classList.add('sunken');
  const render = async (lat, lon, label) => {
    win.body.innerHTML = `<p class="muted">📡 Contacting the sky over ${label}…</p>`;
    try {
      const d = await weatherAt(lat, lon);
      const cur = d.current_weather;
      const desc = WMO_CODES[cur.weathercode] ?? `code ${cur.weathercode}`;
      win.body.innerHTML = `
        <h3 style="margin-top:0">${label}</h3>
        <p style="font-size:30px;margin:4px 0">${desc.split(' ')[0]} ${Math.round(cur.temperature)}°C</p>
        <p>${desc.slice(desc.indexOf(' ') + 1)} · wind ${Math.round(cur.windspeed)} km/h</p>
        <p class="muted">Next days: ${d.daily.temperature_2m_min.slice(0, 4).map((mn, i) =>
          `${Math.round(mn)}–${Math.round(d.daily.temperature_2m_max[i])}°`).join(' · ')}</p>
        <p class="muted" style="font-size:11px">Live from open-meteo via Datalink.</p>`;
    } catch (e) {
      win.body.innerHTML = `<p>Datalink error: ${String(e.message).replace(/</g, '&lt;')}</p>`;
    }
  };
  win.body.innerHTML = '<p class="muted">Where are you?</p>';
  navigator.geolocation?.getCurrentPosition(
    (pos) => render(pos.coords.latitude, pos.coords.longitude, 'Your location'),
    () => render(52.52, 13.4, 'Berlin (location denied — showing a classic)'),
    { timeout: 6000 });
  setTimeout(() => { if (win.body.textContent === 'Where are you?') render(52.52, 13.4, 'Berlin (no answer — showing a classic)'); }, 7000);
}

// ============================================================ STOPWATCH
function openStopwatch() {
  const win = shell('stopwatch', 'Stopwatch', '⏱️', { x: 350, y: 190, w: 260, h: 240, resizable: false });
  if (!win) return;
  win.body.innerHTML = `<div class="app-col" style="align-items:center;gap:8px">
    <div class="sw-display">00:00.0</div>
    <div class="app-toolbar"><button class="btn sw-start">Start</button><button class="btn sw-lap">Lap</button><button class="btn sw-reset">Reset</button></div>
    <div class="sw-laps muted"></div></div>`;
  const disp = $('.sw-display', win.body), laps = $('.sw-laps', win.body);
  let t0 = 0, acc = 0, timer = null;
  const fmt = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${Math.floor(ms / 100) % 10}`;
  const tick = () => { disp.textContent = fmt(acc + (timer ? performance.now() - t0 : 0)); };
  $('.sw-start', win.body).addEventListener('click', (e) => {
    if (timer) { acc += performance.now() - t0; clearInterval(timer); timer = null; e.target.textContent = 'Start'; }
    else { t0 = performance.now(); timer = setInterval(tick, 100); e.target.textContent = 'Stop'; }
    sfx.click();
  });
  $('.sw-lap', win.body).addEventListener('click', () => { laps.prepend(el(`<div>◦ ${disp.textContent}</div>`)); sfx.menu(); });
  $('.sw-reset', win.body).addEventListener('click', () => { acc = 0; t0 = performance.now(); laps.innerHTML = ''; tick(); sfx.click(); });
  win.onClose = () => clearInterval(timer);
}

// ============================================================ STICKY NOTES
function spawnSticky(data, persistAll) {
  const s = el(`<div class="sticky" style="left:${data.x}px;top:${data.y}px">
    <div class="sticky-bar"><span class="sticky-x" title="Delete">×</span></div>
    <div class="sticky-text" contenteditable="true" spellcheck="false"></div></div>`);
  s.querySelector('.sticky-text').textContent = data.text;
  document.getElementById('desktop').appendChild(s);
  const save = () => { data.text = s.querySelector('.sticky-text').textContent; data.x = parseFloat(s.style.left); data.y = parseFloat(s.style.top); persistAll(); };
  s.querySelector('.sticky-text').addEventListener('input', save);
  s.querySelector('.sticky-x').addEventListener('click', () => { data.dead = true; s.remove(); persistAll(); sfx.close(); });
  const bar = s.querySelector('.sticky-bar');
  let sx, sy, ox, oy, drag = false;
  bar.addEventListener('pointerdown', (e) => { drag = true; sx = e.clientX; sy = e.clientY; ox = parseFloat(s.style.left); oy = parseFloat(s.style.top); try { bar.setPointerCapture(e.pointerId); } catch {} });
  bar.addEventListener('pointermove', (e) => { if (drag) { s.style.left = ox + e.clientX - sx + 'px'; s.style.top = oy + e.clientY - sy + 'px'; } });
  bar.addEventListener('pointerup', () => { drag = false; save(); });
  return s;
}

function openStickies() {
  const all = store.get('stickies', []);
  const persistAll = () => store.set('stickies', all.filter(d => !d.dead));
  const fresh = { x: 120 + Math.random() * 200, y: 90 + Math.random() * 160, text: 'new note' };
  all.push(fresh);
  spawnSticky(fresh, persistAll);
  persistAll();
  sfx.open();
}

export function restoreStickies() {
  const all = store.get('stickies', []);
  const persistAll = () => store.set('stickies', all.filter(d => !d.dead));
  all.forEach(d => spawnSticky(d, persistAll));
}

// ============================================================ FILE EXPLORER
function openExplorer(ctx) {
  const win = shell('explorer', 'C:\\ - File Explorer', '📂', { x: 130, y: 90, w: 460, h: 360 });
  if (!win) return;
  const TREE = {
    'C:\\BOWMAN\\EXHIBITS': PROJECTS.map(p => ({ ico: p.icon, name: p.name + '.exhibit', act: () => { ctx.openViewer?.(); window.BOWMAN?.showroom?.setProject(PROJECTS.indexOf(p)); } })),
    'C:\\BOWMAN\\CHARACTERS': [
      { ico: '🐕', name: 'AWD.fbx (4.9 MB)' },
      { ico: '🎖️', name: 'FORCOMMANDER17.fbx (36 MB)' },
      { ico: '😎', name: 'weekend21.fbx (36 MB)' },
    ],
    'C:\\BOWMAN\\MUSIC': [{ ico: '🎵', name: 'ode-to-sadness.mid', act: () => { beat.start(); } }],
    'C:\\WINDOWS\\SYSTEM32': [
      { ico: '⚠️', name: 'do_not_delete.dll' },
      { ico: '🫥', name: 'definitely_important.vxd' },
      { ico: '🧠', name: 'brain.exe', act: () => ctx.allApps().find(a => a.id === 'chat')?.open() },
    ],
  };
  win.body.innerHTML = `<div class="exp-split">
    <div class="exp-tree">${Object.keys(TREE).map(k => `<div class="exp-dir" data-k="${k}">📁 ${k}</div>`).join('')}</div>
    <div class="exp-files sunken"><p class="muted" style="padding:8px">Pick a folder.</p></div></div>`;
  const files = $('.exp-files', win.body);
  win.body.querySelectorAll('.exp-dir').forEach(d => d.addEventListener('click', () => {
    win.body.querySelectorAll('.exp-dir').forEach(x => x.classList.remove('sel'));
    d.classList.add('sel');
    files.innerHTML = '';
    for (const f of TREE[d.dataset.k]) {
      const row = el(`<div class="s-row"><span class="s-ico">${f.ico}</span><span>${f.name}</span></div>`);
      if (f.act) row.addEventListener('click', () => { f.act(); sfx.open(); });
      files.appendChild(row);
    }
    sfx.click();
  }));
}

// ============================================================ VOLUME MIXER
function openMixer() {
  const win = shell('mixer', 'Volume Mixer', '🔊', { x: 340, y: 140, w: 300, h: 260, resizable: false });
  if (!win) return;
  const m = { ...getMixer(), ...store.get('mixer', {}) };
  setMixer(m);
  win.body.innerHTML = `<div class="app-col" style="gap:10px;padding:12px">${[
    ['sfx', '🔔 Effects'], ['vox', '🗣️ Guide voice'], ['music', '🎵 Music'],
  ].map(([k, label]) => `
    <label class="mix-row">${label}
      <input type="range" class="mix" data-k="${k}" min="0" max="100" value="${Math.round((m[k] ?? 0.8) * 100)}">
    </label>`).join('')}
    <p class="muted" style="font-size:11px">Levels persist between visits.</p></div>`;
  win.body.querySelectorAll('.mix').forEach(r => r.addEventListener('input', () => {
    setMixer({ [r.dataset.k]: r.value / 100 });
    if (r.dataset.k === 'sfx') sfx.click();
  }));
}

// ============================================================ TYPING TEST
function openTyping() {
  const win = shell('typing', 'Typing Test', '⌨️', { x: 150, y: 130, w: 470, h: 300 });
  if (!win) return;
  const LINES = [
    'The quick African wild dog jumps over the lazy firewall.',
    'Bowman megatrends synergize vertically integrated nostalgia.',
    'It is now safe to turn off your computer, but why would you?',
    'Painted wolves hunt in packs of retro operating systems.',
  ];
  let target = '', t0 = 0;
  win.body.innerHTML = `<div class="app-col" style="gap:8px;padding:8px">
    <div class="type-target sunken"></div>
    <input class="field type-in" placeholder="type the line above, then Enter" spellcheck="false" autocomplete="off">
    <div class="type-result muted"></div>
    <button class="btn type-new">New line</button></div>`;
  const targetEl = $('.type-target', win.body), input = $('.type-in', win.body), result = $('.type-result', win.body);
  const newLine = () => {
    target = LINES[Math.floor(Math.random() * LINES.length)];
    targetEl.textContent = target;
    input.value = ''; t0 = 0;
    input.focus();
  };
  input.addEventListener('input', () => { if (!t0) t0 = performance.now(); });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !t0) return;
    const mins = (performance.now() - t0) / 60000;
    const typed = input.value;
    const wpm = Math.round((typed.length / 5) / mins);
    let ok = 0;
    for (let i = 0; i < Math.min(typed.length, target.length); i++) if (typed[i] === target[i]) ok++;
    const acc = Math.round(ok / target.length * 100);
    result.textContent = `${wpm} WPM at ${acc}% accuracy — ${acc > 95 && wpm > 60 ? 'certified keyboard athlete 🏆' : acc > 90 ? 'solid!' : 'the keys fought back.'}`;
    (acc > 90 ? sfx.ding : sfx.error)();
    newLine();
  });
  $('.type-new', win.body).addEventListener('click', () => { newLine(); sfx.click(); });
  newLine();
}

// ============================================================ registry
export function buildApps(ctx) {
  const apps = [
    { id: 'search', icon: '🔍', label: 'Search', menu: 'right', open: () => openSearch(ctx) },
    { id: 'iexplore', icon: '🌐', label: 'Internet Explorer', menu: 'left', open: () => openIE(ctx) },
    { id: 'notepad', icon: '📝', label: 'Notepad', menu: 'left', open: openNotepad },
    { id: 'paint', icon: '🎨', label: 'Paint', menu: 'left', open: openPaint },
    { id: 'mines', icon: '💣', label: 'Minesweeper', menu: 'left', open: openMines },
    { id: 'snake', icon: '🐍', label: 'Snake', menu: 'left', open: openSnake },
    { id: 'ttt', icon: '⭕', label: 'Tic-Tac-Toe', menu: 'left', open: openTicTacToe },
    { id: 'calc', icon: '🧮', label: 'Calculator', menu: 'left', open: openCalc },
    { id: 'cmd', icon: '⌨️', label: 'Command Prompt', menu: 'left', open: () => openCmd(ctx) },
    { id: 'mycomputer', icon: '💻', label: 'My Computer', menu: 'right', open: openMyComputer },
    { id: 'recycle', icon: '🗑️', label: 'Recycle Bin', menu: 'right', open: openRecycle },
    { id: 'clock', icon: '🕒', label: 'Date & Time', menu: 'right', open: openClock },
    { id: 'taskman', icon: '📊', label: 'Task Manager', menu: 'right', open: openTaskman },
    { id: 'display', icon: '🖥️', label: 'Display Properties', menu: 'right', open: () => openDisplay(ctx) },
    { id: 'saver', icon: '🌌', label: 'Screensaver', menu: 'left', open: openScreensaver },
    // ---- wave 2 ----
    { id: 'visualizer', icon: '🎚️', label: 'Visualizer', menu: 'left', open: openVisualizer },
    { id: 'charmap', icon: '🔣', label: 'Character Map', menu: 'right', open: openCharmap },
    { id: 'piano', icon: '🎹', label: 'Piano', menu: 'left', open: openPiano },
    { id: 'pong', icon: '🏓', label: 'Pong', menu: 'left', open: openPong },
    { id: 'breakout', icon: '🧱', label: 'Breakout', menu: 'left', open: openBreakout },
    { id: 'memory', icon: '🃏', label: 'Memory Match', menu: 'left', open: openMemory },
    { id: 'winver', icon: '🪟', label: 'About Windows', menu: 'right', open: openWinver },
    { id: 'defrag', icon: '🧩', label: 'Disk Defragmenter', menu: 'right', open: openDefrag },
    { id: 'dialup', icon: '☎️', label: 'Dial-Up Networking', menu: 'right', open: openDialup },
    { id: 'weather', icon: '⛅', label: 'Weather', menu: 'right', open: openWeather },
    { id: 'stopwatch', icon: '⏱️', label: 'Stopwatch', menu: 'right', open: openStopwatch },
    { id: 'stickies', icon: '🟨', label: 'Sticky Notes', menu: 'left', open: openStickies },
    { id: 'explorer', icon: '📂', label: 'File Explorer', menu: 'right', open: () => openExplorer(ctx) },
    { id: 'mixer', icon: '🔊', label: 'Volume Mixer', menu: 'right', open: openMixer },
    { id: 'typing', icon: '⌨️', label: 'Typing Test', menu: 'left', open: openTyping },
  ];
  return apps;
}
