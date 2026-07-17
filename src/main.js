// BOWMAN.EXE — entry point. Boots the BIOS, raises the desktop, and wires
// every subsystem together: window manager, 3D showroom, character brain,
// audio, shortcuts.
import { CONFIG } from './config.js';
import { runBoot } from './boot.js';
import { Desktop, toast, WALLPAPERS } from './desktop.js';
import { Win, wm } from './wm.js';
import { Showroom } from './scene.js';
import { Brain } from './brain.js';
import { PROJECTS } from './projects.js';
import { SHORTCUT_HELP, initShortcuts } from './shortcuts.js';
import { sfx, beat, setMuted, isMuted, setMusicVolume } from './audio.js';
import { store } from './store.js';
import { registerTextureOverrides } from './fbxload.js';
import { memory } from './memory.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

let showroom = null;
let brain = null;
let desktop = null;
let extAudio = null;          // user-supplied music (media player "Open URL")

// ============================================================ VIEWER
function openViewer() {
  const existing = wm.get('viewer');
  if (existing) { existing.focus(); return existing; }

  const win = new Win({
    id: 'viewer', title: 'Character Viewer 3D', icon: '🖥️',
    x: 40, y: 30, w: Math.min(640, innerWidth - 60), h: Math.min(480, innerHeight - 110),
  });
  win.body.innerHTML = `
    <div class="viewer-body">
      <div class="viewer-canvas-wrap">
        <div class="viewer-hud">BOOTING RENDERER…</div>
        <div class="viewer-drop" hidden>DROP .FBX (CHARACTER) OR IMAGE FILES (TEXTURES)</div>
      </div>
      <div class="viewer-toolbar">
        <button class="btn b-prev" title="Previous project (←)">◀</button>
        <button class="btn b-next" title="Next project (→)">▶</button>
        <span class="proj-name"></span>
        <span class="spacer"></span>
        <button class="btn b-talk" title="${CONFIG.guideName} presents this project (Space)">📢 Present</button>
        <button class="btn b-dance" title="${CONFIG.guideName} dances (G)">🕺 Dance</button>
        <button class="btn b-toss" title="Throw the model (T)">🎲 Toss</button>
        <button class="btn b-reset" title="Back on the pedestal">↺ Reset</button>
      </div>
    </div>`;

  const hud = $('.viewer-hud', win.body);
  const nameEl = $('.proj-name', win.body);
  const wrap = $('.viewer-canvas-wrap', win.body);

  showroom = new Showroom(wrap);
  showroom.onProjectChange = (p) => { nameEl.textContent = p.name; drawHud(); };
  let fps = 0;
  showroom.onFps = (f) => { fps = f; drawHud(); };
  const drawHud = () => {
    const ch = showroom.character;
    const rig = ch?.usingFBX
      ? (ch.staticFBX ? 'FBX (static — no humanoid rig)' : `FBX (${ch.report.found.length}/19 bones mapped)`)
      : 'PROCEDURAL (19/19 bones)';
    const ls = showroom.project?.liveStats;
    const model = ls ? `\nMODEL: ${ls.triangles.toLocaleString('en-US')} tris · ${ls.bones} bones · ${ls.morphs} morphs` : '';
    const P = showroom._perf;
    const perf = P?.level ? `\nPERF: auto ${[100, 80, 62, 50][P.level]}% res${P.level >= 2 ? ' · shadows off' : ''}` : '';
    hud.textContent = `RENDERER: ${showroom.backendName}\nFPS: ${fps}\nRIG: ${rig}${model}${perf}`;
  };

  showroom.init().then(() => {
    drawHud();
    nameEl.textContent = showroom.project.name;
    // ?character=URL overrides the preset from config.js
    const url = new URLSearchParams(location.search).get('character') || CONFIG.characterFBX;
    if (url) loadCharacter(url);
  }).catch(err => {
    hud.textContent = `RENDERER FAILED:\n${err.message}\n(this device may lack WebGPU/WebGL2)`;
    console.error(err);
  });

  $('.b-prev', win.body).addEventListener('click', () => showroom.prevProject());
  $('.b-next', win.body).addEventListener('click', () => showroom.nextProject());
  $('.b-talk', win.body).addEventListener('click', () => presentCurrent());
  $('.b-dance', win.body).addEventListener('click', () => { showroom.character.setState('dance'); sfx.click(); });
  $('.b-toss', win.body).addEventListener('click', () => showroom.kickModel());
  $('.b-reset', win.body).addEventListener('click', () => showroom.resetModel());

  // FBX drag & drop → bone-map + retarget
  const dropHint = $('.viewer-drop', win.body);
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); dropHint.hidden = false; });
  wrap.addEventListener('dragleave', () => { dropHint.hidden = true; });
  wrap.addEventListener('drop', (e) => {
    e.preventDefault();
    dropHint.hidden = true;
    const files = [...(e.dataTransfer?.files || [])];
    const fbx = files.find(f => /\.fbx$/i.test(f.name));
    const imgs = files.filter(f => /\.(png|jpe?g|webp|bmp|gif|tga|dds)$/i.test(f.name));
    if (imgs.length) {
      const n = registerTextureOverrides(imgs);
      toast(`${n} texture${n === 1 ? '' : 's'} registered — re-applying…`);
    }
    if (fbx) {
      loadCharacter(fbx);
    } else if (imgs.length) {
      // re-resolve textures on the current character + pedestal model
      const ch = showroom.character;
      if (ch.usingFBX && ch.lastSource) loadCharacter(ch.lastSource, { quiet: true });
      showroom.refreshProjectModel();
    } else {
      toast('Drop an .fbx rig, or image files to fix its textures. *helpful beep*');
    }
  });

  async function loadCharacter(src, { quiet = false } = {}) {
    if (!quiet) toast('Importing FBX… mapping skeleton…');
    try {
      const report = await showroom.character.loadFBX(src, {
        onTexturesSettled: (missing) => {
          if (missing.length) {
            toast(`Missing textures: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''} — drop the image files onto the viewer to apply them.`, 5200);
          }
        },
      });
      drawHud();
      if (!quiet) {
        toast(`Retargeted! ${report.found.length}/19 bones mapped` +
              (report.morphs?.length ? `, blendshapes: ${report.morphs.join('/')}` : '') +
              (report.missing.length ? ` (missing: ${report.missing.slice(0, 4).join(', ')}…)` : ''));
        sfx.ding();
        showroom.character.talk('New chassis acquired! Recalibrating servos… all systems nominal!', 'excited');
      }
    } catch (err) {
      sfx.error();
      toast(`FBX import failed: ${err.message}`, 3500);
    }
  }

  // pause rendering while hidden — important for mobile battery
  win.onShow = () => showroom?.setActive(true);
  win.onHide = () => showroom?.setActive(false);
  win.onClose = () => showroom?.setActive(false);
  const realClose = win.close.bind(win);
  win.close = () => { win.minimize(); };      // keep the GPU context alive
  win.destroy = realClose;
  return win;
}

function presentCurrent() {
  if (!showroom?.ready) return;
  const p = showroom.project;
  const line = `${p.name}! ${p.blurb} Key spec: ${p.specs[0]}.`;
  chatPrint('bot', line);
  showroom.character.talk(line, 'point_left');
}

// ============================================================ CHAT
let chatLogEl = null;
const chatHistory = [];

const BOT = CONFIG.guideName.toUpperCase();

function chatPrint(kind, text) {
  chatHistory.push([kind, text]);
  if (chatHistory.length > 200) chatHistory.shift();
  if (!chatLogEl) return;
  const who = kind === 'bot' ? BOT : kind === 'me' ? 'YOU' : '';
  const m = el(`<p class="msg ${kind}">${who ? `<b>${who}:</b> ` : ''}${text}</p>`);
  chatLogEl.appendChild(m);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function openChat() {
  const existing = wm.get('chat');
  if (existing) { existing.focus(); return existing; }

  const win = new Win({
    id: 'chat', title: `${CONFIG.guideName} Terminal`, icon: '🐶',
    x: Math.max(20, innerWidth - 420), y: 60, w: 380, h: 440,
  });
  win.body.innerHTML = `
    <div class="chat-body">
      <div class="chat-log"></div>
      <div class="chat-quick"></div>
      <div class="chat-input-row">
        <input type="text" class="field chat-in" placeholder="Ask about a project…" aria-label="Message ${CONFIG.guideName}">
        <button class="btn b-send">Send</button>
      </div>
      <div class="chat-consent" hidden>
        🔒 Should ${CONFIG.guideName} remember you &amp; your last chats?
        Stored <b>only on this device</b>, encrypted, anonymous — no tracking,
        nothing transmitted.
        <span class="consent-btns">
          <button class="btn c-yes">Yes, remember me</button>
          <button class="btn c-no">No thanks</button>
        </span>
      </div>
      <div class="chat-brain">
        <span class="led amber"></span>
        <span class="brain-label">BRAIN: ROM (rule-based)</span>
        <button class="btn b-llm" style="min-height:22px;font-size:11px;padding:2px 8px">Install local LLM</button>
        <div class="progress" hidden><i></i></div>
      </div>
    </div>`;

  // memory consent (ePrivacy: ask before storing anything on the device)
  const consentBar = $('.chat-consent', win.body);
  if (memory.consent === null && memory.supported) consentBar.hidden = false;
  $('.c-yes', win.body).addEventListener('click', async () => {
    consentBar.hidden = true;
    await memory.grant();
    chatPrint('sys', `Memory ON — encrypted on this device as ${memory.visitorLabel}. Say "forget me" anytime to erase it.`);
    sfx.ding();
  });
  $('.c-no', win.body).addEventListener('click', () => {
    consentBar.hidden = true;
    memory.deny();
    chatPrint('sys', 'Memory stays OFF — nothing about you is stored. Change your mind in Settings.');
    sfx.click();
  });

  chatLogEl = $('.chat-log', win.body);
  for (const [k, t] of chatHistory) {
    const who = k === 'bot' ? BOT : k === 'me' ? 'YOU' : '';
    chatLogEl.appendChild(el(`<p class="msg ${k}">${who ? `<b>${who}:</b> ` : ''}${t}</p>`));
  }
  chatLogEl.scrollTop = chatLogEl.scrollHeight;

  const input = $('.chat-in', win.body);
  const quick = $('.chat-quick', win.body);
  for (const q of ['What is the SYNTHWAVE-9000?', 'How does the drone work?', 'Specs please', 'Dance!', 'List all projects']) {
    const b = el(`<button class="btn">${q}</button>`);
    b.addEventListener('click', () => send(q));
    quick.appendChild(b);
  }

  let busy = false;
  async function send(text) {
    text = (text ?? input.value).trim();
    if (!text || busy) return;
    input.value = '';
    busy = true;
    chatPrint('me', text);
    sfx.click();
    if (brain.mode === 'llm') {
      chatPrint('sys', `${CONFIG.guideName} is thinking…`);
      showroom?.character.setState('think', { hold: 30 });
    }
    try {
      const reply = await brain.ask(text, showroom?.project, {
        // computer vision: the LLM can request a live snapshot of the scene
        getSnapshot: () => showroom?.captureSnapshot(),
        sceneNote: showroom?.ready ? showroom.describeVisible() : '',
      });
      if (chatLogEl?.lastElementChild?.classList.contains('sys')) chatLogEl.lastElementChild.remove();
      chatPrint('bot', reply.text);
      if (reply.projectId && showroom?.ready) {
        const idx = PROJECTS.findIndex(p => p.id === reply.projectId);
        if (idx >= 0 && idx !== showroom.projIdx) showroom.setProject(idx);
      }
      // the reply drives the animation state machine
      showroom?.character.talk(reply.text, reply.anim);
      memory.recordExchange(text, reply.text, reply.projectId);
    } catch (err) {
      chatPrint('sys', `error: ${err.message}`);
      sfx.error();
    }
    busy = false;
  }
  $('.b-send', win.body).addEventListener('click', () => send());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  // local LLM installer
  const llmBtn = $('.b-llm', win.body);
  const label = $('.brain-label', win.body);
  const led = $('.led', win.body);
  const prog = $('.progress', win.body);
  const llmBlocked = brain.llmBlockedReason;
  if (brain.mode === 'llm') {
    label.textContent = 'BRAIN: LOCAL LLM ONLINE';
    led.classList.remove('amber');
    llmBtn.hidden = true;
  } else if (llmBlocked === 'insecure-context') {
    // WebGPU exists but the browser hides it on plain http:// from a
    // non-localhost address — fixable, so explain instead of greying out
    llmBtn.textContent = 'LLM needs HTTPS — how?';
    label.textContent = 'BRAIN: ROM (LLM blocked by http:// origin)';
  } else if (llmBlocked === 'no-webgpu') {
    llmBtn.disabled = true;
    llmBtn.textContent = 'LLM needs WebGPU';
  }
  llmBtn.addEventListener('click', async () => {
    if (llmBlocked === 'insecure-context') { openSecureContextHelp(); return; }
    llmBtn.hidden = true;
    prog.hidden = false;
    label.textContent = 'Downloading model (~1 GB, cached after first run)…';
    try {
      await brain.installLLM((p, t) => {
        prog.firstElementChild.style.width = Math.round(p * 100) + '%';
        if (t) label.textContent = t.slice(0, 60);
      });
      label.textContent = 'BRAIN: LOCAL LLM ONLINE';
      led.classList.remove('amber');
      prog.hidden = true;
      sfx.ding();
      chatPrint('sys', `Local LLM loaded — ${CONFIG.guideName} now thinks on YOUR hardware. No cloud involved.`);
      showroom?.character.talk('Neural co-processor online! My vocabulary just grew considerably. *excited beeping*', 'excited');
    } catch (err) {
      prog.hidden = true;
      llmBtn.hidden = false;
      label.textContent = `LLM failed: ${err.message}`.slice(0, 70);
      sfx.error();
    }
  });

  win.onClose = () => { chatLogEl = null; };
  return win;
}

function openSecureContextHelp() {
  const existing = wm.get('llmhelp');
  if (existing) { existing.focus(); return existing; }
  const win = new Win({
    id: 'llmhelp', title: 'Enable the local LLM', icon: '🔒',
    x: 110, y: 80, w: 440, h: 380,
  });
  win.body.classList.add('sunken');
  win.body.innerHTML = `
    <p style="margin-top:0"><b>Why it's blocked:</b> browsers only expose WebGPU
    (which the local LLM runs on) to <i>secure contexts</i>. <code>localhost</code>
    counts, but this page came from <code>${location.origin}</code> over plain
    HTTP, so WebGPU is hidden. The fix is HTTPS — any of these works:</p>
    <p><b>1. Deploy it (the real fix).</b> GitHub Pages, Netlify, Cloudflare
    Pages etc. all serve HTTPS automatically — visitors get the LLM with zero
    setup. The carrd.co embed works the same way.</p>
    <p><b>2. LAN testing: use the HTTPS side.</b> The dev server
    (<code>python serve.py</code>) serves HTTPS alongside HTTP — just open
    <a href="https://${location.hostname}${location.pathname}${location.search}">
    https://${location.hostname}</a> and accept the self-signed-certificate
    warning once. (If port 443 was busy when the server started, it falls
    back to <code>https://${location.hostname}:8443</code>.)</p>
    <p><b>3. Chrome flag (this device only).</b> Open
    <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>,
    add <code>${location.origin}</code> to the list, set it to Enabled and
    relaunch the browser.</p>
    <p style="font-size:11px;color:#666">Everything else — the 3D showroom
    (via WebGL2 fallback), Spotty's ROM brain, audio, physics — already works
    fine on this origin. Only WebGPU features need the secure context.</p>`;
  sfx.open();
  return win;
}

// ============================================================ PROJECTS
function openProjects() {
  const existing = wm.get('projects');
  if (existing) { existing.focus(); return existing; }
  const win = new Win({ id: 'projects', title: 'My Projects', icon: '📁', x: 120, y: 90, w: 420, h: 380 });
  const list = el('<div class="proj-list"></div>');
  for (const p of PROJECTS) {
    const item = el(`
      <div class="proj-item" role="button" tabindex="0">
        <span class="pi-ico">${p.icon}</span>
        <span><div class="pi-name">${p.name}</div><div class="pi-sub">${p.sub} — ${p.blurb}</div></span>
      </div>`);
    const activate = () => {
      openViewer();
      const idx = PROJECTS.indexOf(p);
      if (showroom?.ready) {
        showroom.setProject(idx);
        presentCurrent();
      }
    };
    item.addEventListener('click', activate);
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter') activate(); });
    list.appendChild(item);
  }
  win.body.appendChild(list);
  return win;
}

// ============================================================ MEDIA PLAYER
function openPlayer() {
  const existing = wm.get('player');
  if (existing) { existing.focus(); return existing; }
  const win = new Win({ id: 'player', title: 'RobAmp Media Player', icon: '🎵', x: 160, y: 140, w: 340, h: 250, resizable: false });
  win.body.innerHTML = `
    <div class="player-body">
      <div class="player-display">
        <span class="scrolltxt">★ ODE TO SADNESS ★ piano MIDI performed live in your browser ★ looped &amp; extended with variation passes ★</span>
        <div class="player-vis">${'<i></i>'.repeat(16)}</div>
      </div>
      <div class="player-row">
        <button class="btn b-play">▶ Play</button>
        <button class="btn b-stop">■ Stop</button>
        <button class="btn b-url">Open URL…</button>
      </div>
      <div class="player-row">
        <label>VOL</label>
        <input type="range" class="vol" min="0" max="100" value="55" style="flex:1">
      </div>
    </div>`;

  const bars = [...win.body.querySelectorAll('.player-vis i')];
  let visTimer = setInterval(() => {
    const on = beat.playing || (extAudio && !extAudio.paused);
    bars.forEach((b, i) => {
      b.style.height = on ? (12 + Math.abs(Math.sin(Date.now() / 130 + i * 0.9)) * 82 * Math.random()) + '%' : '8%';
    });
  }, 110);

  $('.b-play', win.body).addEventListener('click', () => { beat.start(); desktop.syncTray(); sfx.click(); });
  $('.b-stop', win.body).addEventListener('click', () => {
    beat.stop();
    extAudio?.pause();
    desktop.syncTray();
    sfx.click();
  });
  $('.b-url', win.body).addEventListener('click', () => {
    const url = prompt('Stream a track (direct audio URL — mp3/ogg):');
    if (!url) return;
    beat.stop();
    extAudio?.pause();
    extAudio = new Audio(url);
    extAudio.crossOrigin = 'anonymous';
    extAudio.volume = $('.vol', win.body).value / 100;
    extAudio.play().then(() => toast('Streaming external track'), () => { sfx.error(); toast('Could not play that URL'); });
  });
  $('.vol', win.body).addEventListener('input', (e) => {
    const v = e.target.value / 100;
    setMusicVolume(v);
    if (extAudio) extAudio.volume = v;
  });

  win.onClose = () => clearInterval(visTimer);
  return win;
}

// ============================================================ HELP / SETTINGS / ABOUT
function openHelp() {
  const existing = wm.get('help');
  if (existing) { existing.focus(); return existing; }
  const win = new Win({ id: 'help', title: 'Help', icon: '❓', x: 90, y: 70, w: 430, h: 420 });
  win.body.classList.add('sunken');
  win.body.innerHTML = `
    <h3 style="margin-top:0">${CONFIG.appName} — visitor's manual</h3>
    <p>${CONFIG.guideName} (the robot) guards a collection of projects. Open the
    <b>Character Viewer</b>, browse exhibits with ◀ ▶, grab the model with your
    pointer and <i>throw it</i> — physics will catch it. Ask anything in the
    <b>${CONFIG.guideName} Terminal</b> (try "dance!"); install the local LLM
    for free-form conversation that never leaves your device.</p>
    <p>Drop any <b>.fbx</b> rig onto the viewer to replace ${CONFIG.guideName} —
    bones are auto-mapped and retargeted (Mixamo <i>and</i> MMD naming, e.g.
    左腕/右ひじ, both work), and blendshapes like <code>aa</code>/<code>blink</code>
    (or あ/まばたき) animate the face. If the model's textures are missing
    (the toast will name them), <b>drop the image files onto the viewer</b> and
    they're matched by filename and applied live — or copy them next to the
    .fbx for a permanent fix. Set a permanent character in
    <code>src/config.js</code> or load one via <code>?character=URL</code>.</p>
    <h4>Keyboard shortcuts</h4>
    <table class="kbd-table">${SHORTCUT_HELP.map(([k, d]) =>
      `<tr><td><kbd>${k}</kbd></td><td>${d}</td></tr>`).join('')}
    </table>`;
  return win;
}

function openSettings() {
  const existing = wm.get('settings');
  if (existing) { existing.focus(); return existing; }
  const win = new Win({ id: 'settings', title: 'Settings', icon: '⚙️', x: 200, y: 110, w: 360, h: 360 });
  win.body.classList.add('settings-body');
  win.body.innerHTML = `
    <fieldset><legend>Display</legend>
      <label>Render quality:
        <select class="q-sel field">
          <option value="auto">Auto (detect device)</option>
          <option value="high">High — shadows on</option>
          <option value="low">Low — mobile friendly</option>
        </select>
      </label>
      <p style="font-size:11px;color:#666">Applied after reload.</p>
    </fieldset>
    <fieldset><legend>Wallpaper</legend><div class="wall-swatches"></div></fieldset>
    <fieldset><legend>Privacy — ${CONFIG.guideName}'s memory</legend>
      <p class="mem-status" style="font-size:12px"></p>
      <button class="btn b-mem-toggle"></button>
      <button class="btn b-mem-forget">Forget everything</button>
      <p style="font-size:11px;color:#666">Stored only in this browser
      (AES-256 encrypted, random local id — no fingerprinting, no telemetry,
      nothing transmitted). "Forget" destroys the key and all data instantly.</p>
    </fieldset>
    <fieldset><legend>System</legend>
      <button class="btn b-reset-layout">Reset window &amp; icon layout</button>
      <p style="font-size:11px;color:#666">Storage: ${store.persistent ? 'persistent (localStorage)' : 'session only — this embed blocks storage'}</p>
    </fieldset>`;

  // privacy controls
  const memStatus = $('.mem-status', win.body);
  const memToggle = $('.b-mem-toggle', win.body);
  const memForget = $('.b-mem-forget', win.body);
  const syncMem = () => {
    const on = memory.consent === 'granted';
    memStatus.textContent = !memory.supported
      ? 'Unavailable (needs a secure context).'
      : on ? `ON — remembering as ${memory.visitorLabel ?? '…'}` : 'OFF — nothing about you is stored.';
    memToggle.textContent = on ? 'Turn memory off' : 'Turn memory on';
    memToggle.disabled = !memory.supported;
    memForget.disabled = !on;
  };
  memToggle.addEventListener('click', async () => {
    if (memory.consent === 'granted') memory.deny();
    else await memory.grant();
    syncMem();
    sfx.click();
  });
  memForget.addEventListener('click', () => {
    memory.forget();
    syncMem();
    toast('Memory wiped — key destroyed.');
    sfx.ding();
  });
  syncMem();

  const sel = $('.q-sel', win.body);
  sel.value = store.get('quality', 'auto');
  sel.addEventListener('change', () => { store.set('quality', sel.value); toast('Quality saved — reload to apply'); });

  const sw = $('.wall-swatches', win.body);
  WALLPAPERS.forEach((w, i) => {
    const s = el(`<div class="wall-swatch" title="${w.name}"></div>`);
    s.style.background = w.css;
    if (i === desktop.wallIdx) s.classList.add('current');
    s.addEventListener('click', () => {
      desktop.applyWallpaper(i);
      sw.querySelectorAll('.wall-swatch').forEach(x => x.classList.remove('current'));
      s.classList.add('current');
      sfx.ding();
    });
    sw.appendChild(s);
  });

  $('.b-reset-layout', win.body).addEventListener('click', () => {
    store.clearAll();
    location.reload();
  });
  return win;
}

function openAbout() {
  const existing = wm.get('about');
  if (existing) { existing.focus(); return existing; }
  const win = new Win({ id: 'about', title: `About ${CONFIG.appName}`, icon: 'ℹ️', x: innerWidth / 2 - 160, y: 120, w: 330, h: 240, resizable: false });
  win.body.classList.add('sunken');
  win.body.innerHTML = `
    <p style="margin-top:0"><b>${CONFIG.appName}</b> v5.1 — ${CONFIG.brandName.toUpperCase()}, INC.</p>
    <p>A WebGPU portfolio operating system. Skeletal retargeting (Mixamo +
    MMD), blendshape expressions, verlet physics, synthesized lo-fi audio, and
    an optional in-browser local LLM — all in a single static page,
    embed-ready for carrd.co.</p>
    <p style="font-size:11px;color:#666">Renderer: ${showroom?.backendName ?? 'not started'} ·
    Built with three.js + WebLLM</p>`;
  return win;
}

// ============================================================ BOOT IT ALL
async function start() {
  brain = new Brain();
  await memory.init();        // decrypts visitor memory if consent was given

  await runBoot();
  document.getElementById('os').hidden = false;

  desktop = new Desktop({
    onAbout: openAbout,
    icons: [
      { id: 'viewer', icon: '🖥️', label: 'Character Viewer', open: openViewer },
      { id: 'chat', icon: '🐶', label: `${CONFIG.guideName} Terminal`, open: openChat },
      { id: 'projects', icon: '📁', label: 'My Projects', open: openProjects },
      { id: 'player', icon: '🎵', label: 'RobAmp', open: openPlayer },
      { id: 'help', icon: '❓', label: 'Help', open: openHelp },
      { id: 'settings', icon: '⚙️', label: 'Settings', open: openSettings },
    ],
  });

  initShortcuts({
    help: openHelp,
    openViewer, openChat, openProjects, openPlayer, openSettings,
    prevProject: () => showroom?.prevProject(),
    nextProject: () => showroom?.nextProject(),
    present: presentCurrent,
    toss: () => showroom?.kickModel(),
    dance: () => showroom?.character.setState('dance'),
    music: () => { beat.toggle(); desktop.syncTray(); },
    mute: () => { setMuted(!isMuted()); desktop.syncTray(); },
    wallpaper: () => desktop.nextWallpaper(),
    refresh: () => desktop.refresh(),
    arrange: () => desktop.autoArrange(),
    minimizeAll: () => wm.minimizeAll(),
    cycleWindows: () => wm.cycle(),
  });

  // default workspace
  openViewer();
  if (innerWidth >= 700) openChat();

  // greeting once the renderer is up — returning visitors get remembered
  const greet = () => {
    if (!showroom?.ready) { setTimeout(greet, 400); return; }
    const back = memory.greetingInfo();
    let msg;
    if (back) {
      const proj = back.lastTopic ? PROJECTS.find(p => p.id === back.lastTopic) : null;
      msg = `Welcome back${back.name ? ', ' + back.name : ''}! *happy tail wag* Visit #${back.visits}.` +
            (proj ? ` Last time we talked about ${proj.name} — want to pick up where we left off, or see something new?`
                  : ' What shall we look at today?');
    } else {
      msg = `Welcome to ${CONFIG.appName}! *Wags* I am ${CONFIG.guideName}. Browse my creator's projects with ◀ ▶, toss the exhibits around, ask me how they work — or tell me to dance!`;
    }
    chatPrint('bot', msg);
    showroom.character.talk(msg, back ? 'excited' : 'wave');
  };
  setTimeout(greet, 900);
}

// debug handle (also handy for tinkering from the console)
window.BOWMAN = {
  get showroom() { return showroom; },
  get brain() { return brain; },
  get desktop() { return desktop; },
};

start().catch(err => {
  console.error(err);
  document.body.innerHTML =
    `<pre style="color:#fff;font-family:monospace;padding:2em">FATAL: ${err.message}\n\nA fatal exception 0E has occurred at 0028:${Math.random().toString(16).slice(2, 10).toUpperCase()}.\nReload to restart your computer.</pre>`;
});
