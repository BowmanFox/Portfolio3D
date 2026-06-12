# BOWMAN.EXE

A **Windows 95**-flavored **WebGPU portfolio operating system** from
BOWMAN MEGATRENDS, INC. — built as a single static page with no build step,
no bundler, and no binary assets, designed to be embedded in a
[carrd.co](https://carrd.co) iframe.

**Spotty** — by default the rigged AWD avatar shipped in `js/AWD.fbx` — guides
visitors through your projects in a 3D showroom with real-time lighting and
physics, explains their technical specs (and what they mean in plain English)
in a chat terminal, dances on request, and can optionally think with a
**fully local LLM** running in the visitor's browser.

## Features

- **WebGPU renderer** (three.js `WebGPURenderer`) with automatic **WebGL2
  fallback** — runs on phones too. The HUD shows which backend you got.
- **FBX character pipeline** — set a permanent character in
  [js/config.js](js/config.js) (`characterFBX`), load one per-visit via
  `?character=URL`, or just drop a `.fbx` onto the viewer. Bone names are
  normalized and **mapped onto a canonical 19-joint armature, then
  retargeted** — both **Mixamo-style** (`mixamorig:LeftForeArm`, `arm_L.R`,
  Biped…) and **MMD-style Japanese** names (左腕, 右ひじ, 上半身, 下半身…)
  are supported, with T-pose auto-relaxation. Ships with a procedural
  CRT-headed robot so the page works with zero downloads.
- **Blendshape expressions** — morph targets like `aa`, `oh`, `blink`,
  `smile` (or MMD あ / お / まばたき / 笑い) are auto-detected and driven by
  the character's expression engine: lip-sync flaps while babbling, timed
  blinks, smiles when happy.
- **Pose-transition + sequence animation system** — single poses (talk,
  explain, point, think, excited, wave, sleep) plus **multi-keyframe
  sequences** (dance, bow, shrug, stretch, nod, headshake, facepalm) with
  per-bone slerp smoothing and procedural layers: breathing, head look-at,
  talk gesticulation, idle micro-glances, and occasional idle stretches.
- **FBX showcase models with live stats** — each portfolio project can point
  `modelFBX` at a real .fbx; it loads onto the pedestal (procedural fallback
  while it streams), gets normalized, and is **measured at runtime**:
  triangles, vertices, meshes, materials, bones, blendshapes. Those numbers
  feed the HUD and both chat brains, and each project carries
  `forEmployers` (hiring-manager takeaways) and `eli5` (plain-language)
  copy the guide can recite. Textures referenced by absolute OS paths are
  re-resolved next to the .fbx, and dead texture links degrade to plain
  colors instead of black.
- **Physics** — verlet spring-chain antenna, and a grab-and-throw rigid body
  on the pedestal (gravity, restitution, spring-return). Try **Toss**.
- **Local LLM brain** — opt-in [WebLLM](https://github.com/mlc-ai/web-llm)
  (model configurable in config.js, default Qwen2.5-0.5B) via WebGPU, entirely
  on-device (~400 MB, cached). Replies carry `[anim:…][focus:…]` control tags
  that **dynamically drive Spotty's animation state** — including the dance —
  and steer the showroom. A rule-based **ROM brain** answers instantly
  everywhere else.
- **All-synthesized audio** — lo-fi UI sfx, Animal-Crossing-style babble with
  question intonation, and a generative 84 BPM lo-fi beat (swung drums, jazz
  chords, vinyl crackle). The media player can also stream any audio URL.
- **Win95 desktop shell** — BIOS boot with Energy Star logo + CRT scanline
  flicker, chunky beveled chrome, navy title bars, gray taskbar,
  draggable icons & windows with **persisted positions** (localStorage with
  in-memory fallback for storage-blocking embeds), right-click context menu
  (Refresh Desktop / Auto-Arrange Icons / Minimize All / Change Wallpaper),
  long-press menu on touch.
- **Keyboard shortcuts** — press `F1` in the app (highlights: `G` = dance,
  `Space` = present, `T` = toss, `←/→` = switch project).

## Run locally

```sh
python serve.py
# → http://localhost:8123  and  https://localhost:8443 (+ your LAN IP)
```

One process serves both protocols; the HTTPS side (self-signed cert,
auto-generated) is what gives other devices on your network a secure
context for WebGPU + the local LLM. Any plain static server works too
(`python -m http.server`) — modules + import maps just need http(s)://,
not file://.

## Deploy + embed in carrd.co

1. Host this folder anywhere static: GitHub Pages, Netlify, Cloudflare Pages…
   No headers or server config needed (no COOP/COEP requirement).
2. In carrd, add an **Embed** element → *Code*, and paste:

```html
<iframe src="https://YOUR-HOST/index.html"
        style="width:100%;height:100vh;border:0"
        allow="autoplay; fullscreen"
        loading="lazy"
        title="BOWMAN.EXE portfolio"></iframe>
```

Tips:
- Audio starts after the visitor's first tap (the BIOS "press any key" screen
  is that tap — by design).
- `?noboot=1` skips the BIOS; `?character=URL` overrides the configured FBX
  (the host must allow CORS).
- **Local LLM from another device / LAN IP:** browsers only expose WebGPU to
  secure contexts, so on `http://192.168.x.x:8123` the LLM (and the WebGPU
  renderer path) is blocked — the chat shows an "LLM needs HTTPS — how?"
  button with fixes. Quickest: `serve.py` already listens on
  `https://<your-ip>:8443` — open that and accept the self-signed cert once.
  Real deployments (GitHub Pages/Netlify/carrd embed) are HTTPS already, so
  visitors are never affected. The site itself still runs fine over plain
  HTTP via the WebGL2 fallback.

## Make it yours

- **Config**: [js/config.js](js/config.js) — brand/app/guide names, preset
  `characterFBX` URL, character height, local-LLM model id.
- **Projects**: edit [js/projects.js](js/projects.js) — name, blurb,
  `modelFBX` (your real .fbx), `specs`, `forEmployers`, `eli5`, `how`,
  keywords, and a small procedural fallback `buildModel()`.
- **Poses & sequences**: [js/animator.js](js/animator.js) (`POSES`,
  `SEQUENCES`), referenced from brain replies in [js/brain.js](js/brain.js).
- **Bone aliases / morph patterns**: [js/retarget.js](js/retarget.js) and the
  `MORPH_PATTERNS` table in [js/character.js](js/character.js).
- **Wallpapers / theme**: [js/desktop.js](js/desktop.js) and
  [css/win9x.css](css/win9x.css).

## Architecture

```
index.html      shell, import map (three.js WebGPU build via CDN)
css/            win9x.css (Win95 theme) · BIOS/CRT effects · desktop apps
js/
  config.js     site config: names, preset FBX, LLM model
  main.js       orchestrator: boots BIOS → desktop → windows
  boot.js       POST sequence, Energy Star fade-in, CRT on/off
  wm.js         window manager (drag/resize/persist/taskbar)
  desktop.js    icons, wallpapers, context + start menus, tray
  scene.js      WebGPU showroom: lights, pedestal, grab physics
  character.js  procedural Bone armature + FBX import, face, blendshapes
  retarget.js   bone normalization (Mixamo + MMD), mapping, T-pose relax
  animator.js   pose library + sequences + idle/active transitions
  physics.js    verlet chains + bouncing rigid body (120 Hz substeps)
  brain.js      ROM rule brain + WebLLM local LLM with anim control tags
  audio.js      synthesized sfx, babble, lo-fi beat sequencer
  projects.js   portfolio data + procedural showcase models
  shortcuts.js  global keyboard map
  store.js      namespaced localStorage with in-memory fallback
```
