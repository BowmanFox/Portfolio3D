// The application suite — 15 desktop apps in the XP spirit, built on the
// window manager. Each app is { id, icon, label, menu, open }. `menu` hints
// where the start menu places it ('left' = programs column, 'right' = places
// column). buildApps(ctx) wires apps that need desktop/theme/brain access.
import { Win, wm } from './wm.js';
import { sfx, beat } from './audio.js';
import { store } from './store.js';
import { PROJECTS } from './projects.js';
import { WALLPAPERS } from './desktop.js';
import { CONFIG } from './config.js';

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
      ${PROJECTS.map(p => `<p>▸ <a href="#" data-u="bowman://project/${p.id}">${p.icon} ${p.name}</a> — ${p.blurb}</p>`).join('')}
      <hr><p class="muted">You are visitor № ${Math.floor(Math.random() * 90000 + 10000)}. This page is under construction. 🚧</p>`;
    page.querySelectorAll('a[data-u]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); nav(a.dataset.u); sfx.click(); }));
  };
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
// The XP search sidekick, reborn: three interactive characters take turns
// helping you dig through apps, projects and help topics.
const COMPANIONS = [
  {
    name: 'Rusty', kind: 'dog',
    lines: { idle: 'What are we sniffing for today?', search: '*sniff sniff sniff*', found: 'Dug something up! Woof!', none: 'No bones in this yard…', pet: '*happy tail thumping*' },
  },
  {
    name: 'Pix', kind: 'bot',
    lines: { idle: 'QUERY INPUT AWAITED.', search: 'SCANNING DATABANKS…', found: 'MATCHES LOCATED. BEEP.', none: 'ZERO RESULTS. SAD BEEP.', pet: 'AFFECTION.EXE RUNNING' },
  },
  {
    name: 'Ember', kind: 'fox',
    lines: { idle: 'Whatcha lookin\' for?', search: '*rustles through papers*', found: 'Ta-daa! Found it!', none: 'Hmm, nothing. Typo maybe?', pet: '*delighted fox chirp*' },
  },
];

function drawCompanion(g, kind, t, state, blink) {
  g.clearRect(0, 0, 120, 120);
  g.save();
  g.translate(60, 66);
  const bob = state === 'found' ? -Math.abs(Math.sin(t * 9)) * 10 : Math.sin(t * 2.2) * 2;
  const sad = state === 'none';
  g.translate(0, bob + (sad ? 4 : 0));
  const wag = Math.sin(t * (state === 'pet' || state === 'found' ? 16 : 5)) * (sad ? 0.08 : 0.5);
  const eyeH = blink ? 1.2 : 4;

  if (kind === 'dog') {
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
  const win = shell('search', 'Search', '🔍', { x: 110, y: 60, w: 520, h: 420 });
  if (!win) return;
  win.body.innerHTML = `
    <div class="search-split">
      <div class="search-side">
        <canvas class="comp-cv" width="120" height="120" title="Click to pet!"></canvas>
        <div class="comp-bubble"></div>
        <div class="comp-name muted"></div>
        <button class="btn comp-swap">Change character</button>
      </div>
      <div class="search-main">
        <div class="app-toolbar">
          <input class="field s-in" placeholder="Search apps, projects, help…" spellcheck="false">
        </div>
        <div class="s-results sunken"></div>
      </div>
    </div>`;
  const cv = $('.comp-cv', win.body), g = cv.getContext('2d');
  const bubble = $('.comp-bubble', win.body);
  const nameEl = $('.comp-name', win.body);
  const input = $('.s-in', win.body);
  const results = $('.s-results', win.body);

  let compIdx = store.get('search.companion', 0) % COMPANIONS.length;
  let state = 'idle', stateUntil = 0, blink = false, t = 0, raf;
  const comp = () => COMPANIONS[compIdx];
  const say = (which) => { bubble.textContent = comp().lines[which]; nameEl.textContent = `${comp().name} the search ${comp().kind}`; };
  const setState = (s, holdMs = 1600) => { state = s; stateUntil = performance.now() + holdMs; say(s); };
  const loop = () => {
    t += 1 / 60;
    if (state !== 'idle' && performance.now() > stateUntil) { state = 'idle'; say('idle'); }
    if (Math.random() < 0.008) { blink = true; setTimeout(() => { blink = false; }, 130); }
    drawCompanion(g, comp().kind, t, state, blink);
    raf = requestAnimationFrame(loop);
  };
  cv.addEventListener('pointerdown', () => { setState('pet', 1500); sfx.ding(); });
  $('.comp-swap', win.body).addEventListener('click', () => {
    compIdx = (compIdx + 1) % COMPANIONS.length;
    store.set('search.companion', compIdx);
    setState('idle', 0); say('idle'); sfx.click();
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
  let debounce;
  const run = () => {
    const q = input.value.trim().toLowerCase();
    results.innerHTML = '';
    if (!q) { setState('idle', 0); results.innerHTML = '<p class="muted" style="padding:8px">Type to search. Or pet the assistant. Both are productive.</p>'; return; }
    const hits = corpus().filter(r =>
      r.title.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q) || (r.keys || '').toLowerCase().includes(q));
    if (hits.length) {
      setState('found');
      for (const h of hits.slice(0, 12)) {
        const row = el(`<div class="s-row"><span class="s-ico">${h.icon}</span><span><b>${h.title}</b><br><span class="muted">${h.sub}</span></span></div>`);
        row.addEventListener('click', () => { h.act(); sfx.open(); });
        results.appendChild(row);
      }
    } else {
      setState('none', 2600);
      results.innerHTML = `<p class="muted" style="padding:8px">Nothing matched “${input.value.replace(/</g, '&lt;')}”.</p>`;
    }
  };
  input.addEventListener('input', () => {
    setState('search', 900);
    clearTimeout(debounce);
    debounce = setTimeout(run, 350);
  });
  say('idle');
  run();
  loop();
  win.onClose = () => cancelAnimationFrame(raf);
  setTimeout(() => input.focus(), 120);
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
  ];
  return apps;
}
