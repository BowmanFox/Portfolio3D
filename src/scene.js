// The 3D showroom: WebGPU-first renderer (transparent WebGL2 fallback for
// devices without it), real-time key/fill/orbiting accent lights with
// shadows, the guide character, and a physics-enabled pedestal where the
// current project model can be grabbed and flung around.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Character } from './character.js';
import { PhysicsWorld, Bouncer } from './physics.js';
import { PROJECTS } from './projects.js';
import { loadFBXSafe, computeModelStats, pruneMorphs, prepareLods, applyLod, crunchTextures, restoreTextures } from './fbxload.js';
import { sfx } from './audio.js';
import { store } from './store.js';

/**
 * Fine-grained color naming: r,g,b (0-255) → one of ~26 human color words.
 * Ordered checks: achromatics first, then hue bands with lightness/
 * saturation carve-outs for the earthy and pastel names people actually use.
 */
function nameColor(r, g, b) {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
  const l = (mx + mn) / 2;
  const d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d > 0) {
    const R = r / 255, G = g / 255, B = b / 255;
    if (mx === R) h = ((G - B) / d) % 6;
    else if (mx === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  // achromatics & near-achromatics
  if (l > 0.93) return 'white';
  if (l < 0.07) return 'black';
  if (s < 0.14) {
    if (l > 0.82) return 'off-white';
    if (l > 0.62) return 'silver';
    if (l > 0.38) return 'gray';
    if (l > 0.16) return 'dark gray';
    return 'charcoal';
  }
  // warm earth tones get priority carve-outs
  if (h >= 15 && h < 50) {
    if (l > 0.84 && s < 0.6) return 'cream';
    if (l > 0.7) return 'peach';
    if (l < 0.24) return 'dark brown';
    if (l < 0.38) return 'brown';
    if (s > 0.55 && l < 0.52 && h < 32) return 'rust';
    if (s > 0.55 && h >= 42) return 'gold';
    if (s < 0.55) return l > 0.55 ? 'beige' : 'tan';
    return 'orange';
  }
  if (h < 12 || h >= 348) {
    if (l < 0.26) return 'maroon';
    return l > 0.72 ? 'pink' : 'red';
  }
  if (h < 15 || (h >= 335 && h < 348)) return l > 0.6 ? 'pink' : 'crimson';
  if (h < 66) return l < 0.4 ? 'olive' : 'yellow';
  if (h < 96) return l < 0.38 ? 'olive' : 'lime green';
  if (h < 165) {
    if (l > 0.78) return 'mint';
    if (l < 0.26) return 'forest green';
    return 'green';
  }
  if (h < 196) return l > 0.58 ? 'turquoise' : 'teal';
  if (h < 212) return l > 0.6 ? 'sky blue' : 'cyan';
  if (h < 260) {
    if (l < 0.24) return 'navy';
    return l > 0.7 ? 'sky blue' : 'blue';
  }
  if (h < 298) return l > 0.74 ? 'lavender' : 'purple';
  return l > 0.68 ? 'pink' : 'magenta';
}

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#9aa0a8'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#7d838c'; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(18, 18);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

export class Showroom {
  constructor(container) {
    this.container = container;
    this.active = true;
    this.ready = false;
    this.projIdx = 0;
    this.onProjectChange = null;
    this.onFps = null;
    this._fpsAcc = 0; this._fpsN = 0;
  }

  async init() {
    const quality = store.get('quality', 'auto');
    const isMobile = window.innerWidth < 700 || /Mobi|Android/i.test(navigator.userAgent);
    this.low = quality === 'low' || (quality === 'auto' && isMobile);

    let renderer, softGPU = false;
    try {
      // Chrome exposes navigator.gpu even when the real GPU is blocklisted
      // and "WebGPU" runs on SwiftShader (CPU emulation). Probe the adapter
      // first: if WebGPU would be software but WebGL has real hardware,
      // take the WebGL path — it's dramatically faster in that situation.
      const adapter = await navigator.gpu?.requestAdapter?.();
      if (!adapter) throw new Error('WebGPU unavailable');
      const info = adapter.info ?? {};
      softGPU = adapter.isFallbackAdapter === true ||
        /swiftshader|software|llvmpipe|basic render/i
          .test(`${info.vendor} ${info.architecture} ${info.description}`);
      if (softGPU && this._webglIsHardware())
        throw new Error('software WebGPU adapter — hardware WebGL is faster');
      renderer = new THREE.WebGPURenderer({ antialias: !this.low, alpha: false });
      await renderer.init();
    } catch (err) {
      console.warn('using WebGL backend:', err?.message ?? err);
      renderer = new THREE.WebGPURenderer({ antialias: !this.low, forceWebGL: true });
      await renderer.init();
    }
    this.renderer = renderer;
    // Label from the backend three ACTUALLY created — never assume the try
    // path landed on WebGPU (three silently falls back to WebGL on its own).
    this.backendName = renderer.backend?.isWebGPUBackend
      ? (softGPU ? 'WEBGPU (SOFTWARE)' : 'WEBGPU')
      : this._describeWebGL(renderer);
    this.preferWebGL = !renderer.backend?.isWebGPUBackend;   // mini stages follow suit
    this._basePixelRatio = Math.min(devicePixelRatio || 1, this.low ? 1.25 : 2);
    this._perf = { level: 0, cool: 0 };
    renderer.setPixelRatio(this._basePixelRatio);
    renderer.shadowMap.enabled = !this.low;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.container.appendChild(renderer.domElement);

    // ---- scene ----------------------------------------------------------
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10141f);
    scene.fog = new THREE.Fog(0x10141f, 9, 18);

    const camera = this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 60);
    camera.position.set(0.4, 1.7, 4.6);

    const controls = this.controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.0, 0);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1.8;
    controls.maxDistance = 9;
    controls.maxPolarAngle = 1.48;

    // ---- floor & set dressing ------------------------------------------
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(9, 48),
      new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.7, 0.9, 24),
      new THREE.MeshStandardMaterial({ color: 0xc0c0c0, roughness: 0.35, metalness: 0.3 }));
    pedestal.position.set(1.15, 0.45, 0);
    pedestal.castShadow = pedestal.receiveShadow = true;
    scene.add(pedestal);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.56, 0.025, 10, 32),
      new THREE.MeshStandardMaterial({ color: 0x2bd42b, emissive: 0x2bd42b, emissiveIntensity: 1.4 }));
    rim.position.set(1.15, 0.91, 0);
    rim.rotation.x = Math.PI / 2;
    scene.add(rim);

    // ---- lighting rig ---------------------------------------------------
    scene.add(new THREE.HemisphereLight(0xccd5e8, 0x445544, 1.5));
    const key = new THREE.DirectionalLight(0xfff6e8, 3.4);
    this.keyLight = key;
    key.position.set(3, 5, 3);
    if (!this.low) {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = key.shadow.camera.bottom = -5;
      key.shadow.camera.right = key.shadow.camera.top = 5;
    }
    scene.add(key);
    // accents stay for mood but must not tint white fur into blue/pink
    this.accentA = new THREE.PointLight(0x66dcff, this.low ? 5 : 8, 9, 1.8);
    this.accentB = new THREE.PointLight(0xff9ad9, this.low ? 4 : 6, 9, 1.8);
    scene.add(this.accentA, this.accentB);
    const spot = new THREE.SpotLight(0xffffff, 35, 10, 0.45, 0.4, 1.6);
    spot.position.set(1.15, 4.2, 0.6);
    spot.target = pedestal;
    scene.add(spot);

    // ---- character ------------------------------------------------------
    this.character = new Character();
    this.character.root.position.set(-1.15, 0, 0.1);
    this.character.root.rotation.y = 0.45;          // angled toward visitor + pedestal
    scene.add(this.character.root, this.character.antennaGroup);
    this.wander = { target: null, next: 12 };       // first stroll after the greeting

    // ---- physics + first model -----------------------------------------
    this.physics = new PhysicsWorld();
    this.modelGroup = new THREE.Group();
    scene.add(this.modelGroup);
    this.bouncer = this.physics.add(new Bouncer(this.modelGroup, {
      home: new THREE.Vector3(1.15, 1.45, 0),
      floorY: 0.32,
    }));
    this.bouncer.onBounce = (v) => sfx.bounce(v);
    this.setProject(store.get('project', 0), { silent: true });

    this._wireGrab();
    this._wireResize();

    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this._tick());
    this.ready = true;
  }

  // ------------------------------------------------------------ projects
  get project() { return PROJECTS[this.projIdx]; }

  setProject(i, { silent = false } = {}) {
    this.projIdx = ((i % PROJECTS.length) + PROJECTS.length) % PROJECTS.length;
    const proj = this.project;
    const token = (this._modelToken = (this._modelToken || 0) + 1);

    // procedural fallback shows immediately (and stays if there's no FBX)
    this.modelGroup.clear();
    const built = proj.buildModel();
    this.modelGroup.add(built);
    this._animatedModel = built.userData.animate || null;

    if (proj.modelFBX) {
      this._loadProjectFBX(proj).then((entry) => {
        if (token !== this._modelToken || !entry) return;   // user switched away
        this.modelGroup.clear();
        this.modelGroup.add(entry.object);
        this._animatedModel = null;
        proj.liveStats = entry.stats;
        if (this._perf.level >= 2) this._applyPerf();   // arrive pre-crunched under load
        this._fitFloor();
        this.onProjectChange?.(proj, this.projIdx);          // refresh HUD/labels
      });
    }

    this.bouncer.reset();
    this._fitFloor();
    store.set('project', this.projIdx);
    if (!silent) sfx.open();
    this.onProjectChange?.(proj, this.projIdx);
  }

  /** Project an object's bounding box into pixel space of a W×H sample. */
  _screenRect(object, W, H) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return null;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      v.project(this.camera);
      const sx = (v.x + 1) / 2, sy = (1 - v.y) / 2;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy);
      x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    const rx0 = Math.max(0, Math.floor(x0 * W)), ry0 = Math.max(0, Math.floor(y0 * H));
    const rx1 = Math.min(W, Math.ceil(x1 * W)), ry1 = Math.min(H, Math.ceil(y1 * H));
    if (rx1 - rx0 < 2 || ry1 - ry0 < 2) return null;    // off-screen or sliver
    return [rx0, ry0, rx1, ry1];
  }

  /**
   * COLORVISION, advanced: renders once, reads the frame back, and analyzes
   * it REGIONALLY — the exhibit and the guide are located by projecting
   * their bounding boxes to screen space, so each gets its own histogram in
   * a ~26-name palette, plus scene brightness/contrast and a pattern
   * complexity verdict. This sees exactly what the visitor sees: textures,
   * lighting, everything.
   */
  analyzeColors() {
    try {
      const W = 128, H = 96;
      this.renderer.render(this.scene, this.camera);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(this.renderer.domElement, 0, 0, W, H);
      const px = g.getImageData(0, 0, W, H).data;

      const histogram = (rect) => {
        const [rx0, ry0, rx1, ry1] = rect;
        const counts = new Map();
        let n = 0, lumaSum = 0, lumaSq = 0;
        for (let y = ry0; y < ry1; y++) {
          for (let x = rx0; x < rx1; x++) {
            const i = (y * W + x) * 4;
            const name = nameColor(px[i], px[i + 1], px[i + 2]);
            counts.set(name, (counts.get(name) || 0) + 1);
            const luma = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
            lumaSum += luma; lumaSq += luma * luma; n++;
          }
        }
        const mean = lumaSum / n;
        const std = Math.sqrt(Math.max(0, lumaSq / n - mean * mean));
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1])
          .filter(([, k]) => k / n > 0.04).slice(0, 5)
          .map(([name, k]) => `${Math.round(k / n * 100)}% ${name}`);
        const distinct = [...counts.values()].filter(k => k / n > 0.06).length;
        return { top, mean, std, distinct };
      };

      const overall = histogram([0, 0, W, H]);
      // degenerate readback (hidden tab, first frame, context loss) comes
      // back all-black — better to say nothing than to hallucinate darkness
      if (overall.mean < 0.02 && overall.std < 0.02) return '';
      const exRect = this._screenRect(this.modelGroup, W, H);
      const guideRoot = this.character?.usingFBX ? this.character.fbxGroup : this.character?.proceduralGroup;
      const gdRect = guideRoot && this.character ? this._screenRect(this.character.root, W, H) : null;
      const exhibit = exRect ? histogram(exRect) : null;
      const guide = gdRect ? histogram(gdRect) : null;

      const brightness = overall.mean > 0.62 ? 'bright' : overall.mean > 0.38 ? 'balanced' : overall.mean > 0.18 ? 'dim' : 'dark';
      const contrast = overall.std > 0.26 ? 'high-contrast' : overall.std > 0.13 ? 'moderate-contrast' : 'soft/flat';
      const pattern = (hst) => !hst ? '' : hst.distinct >= 4 ? 'richly patterned/multicolored' : hst.distinct >= 2 ? 'two-tone' : 'uniform';

      const parts = [];
      if (exhibit) parts.push(`the exhibit reads ${exhibit.top.join(', ')} (${pattern(exhibit)})`);
      if (guide) parts.push(`the guide character reads ${guide.top.join(', ')} (${pattern(guide)})`);
      parts.push(`whole frame: ${overall.top.join(', ')}; lighting is ${brightness}, ${contrast}`);
      return parts.join('. ');
    } catch { return ''; }
  }

  /**
   * Plain-text summary of what is visibly in the scene right now — measured
   * from geometry, materials AND rendered pixels, so even a text-only LLM
   * can "see" truthfully.
   */
  describeVisible() {
    const tally = (root) => {
      const counts = new Map();
      root?.traverse?.((n) => {
        if (!n.isMesh || !n.visible) return;
        for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
          if (!m) continue;
          const key = m.map?.image ? 'textured/painted'
            : m.color ? nameColor(m.color.r * 255, m.color.g * 255, m.color.b * 255) : 'unknown';
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      });
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k).join(', ');
    };
    const s = this.project?.liveStats;
    const pedestal = `On the pedestal: ${this.project?.name ?? 'nothing'}` +
      (s ? ` (~${s.triangles.toLocaleString('en-US')} triangles, ${s.meshes} mesh${s.meshes === 1 ? '' : 'es'})` : '') +
      `; surface finish: ${tally(this.modelGroup) || 'unknown'}.`;
    const guide = `The guide character stands nearby (surfaces: ${tally(this.character?.usingFBX ? this.character.fbxGroup : this.character?.proceduralGroup) || 'unknown'}).`;
    const screen = this.analyzeColors();
    return `${pedestal} ${guide}${screen ? ` COLORVISION (measured per-region from the rendered frame): ${screen}.` : ''}`;
  }

  /** Re-resolve the current showcase FBX (e.g. after textures were dropped). */
  refreshProjectModel() {
    if (!this.project.modelFBX) return;
    this._fbxCache?.delete(this.project.id);
    this.setProject(this.projIdx, { silent: true });
  }

  /** Floor height = distance from the group origin to the model's bottom. */
  _fitFloor() {
    const bbox = new THREE.Box3().setFromObject(this.modelGroup);
    if (bbox.isEmpty()) return;
    this.bouncer.floorY = Math.max(0.05, this.modelGroup.position.y - bbox.min.y + 0.01);
  }

  /** Load + normalize a project's showcase FBX (cached per project). */
  async _loadProjectFBX(proj) {
    this._fbxCache ??= new Map();
    if (this._fbxCache.has(proj.id)) return this._fbxCache.get(proj.id);
    try {
      const obj = await loadFBXSafe(proj.modelFBX);
      const stats = computeModelStats(obj);     // count morphs BEFORE pruning
      pruneMorphs(obj, []);                     // showcase pieces are static
      // fit into a ~1.15 m display volume, centered on the group origin
      const bbox = new THREE.Box3().setFromObject(obj);
      const size = bbox.getSize(new THREE.Vector3());
      const scale = 1.15 / Math.max(size.x, size.y, size.z, 1e-4);
      obj.scale.setScalar(scale);
      bbox.setFromObject(obj);
      obj.position.sub(bbox.getCenter(new THREE.Vector3()));
      const entry = { object: obj, stats };
      this._fbxCache.set(proj.id, entry);
      return entry;
    } catch (err) {
      console.warn(`showcase FBX failed for ${proj.id}:`, err);
      this._fbxCache.set(proj.id, null);                     // don't retry forever
      return null;
    }
  }
  nextProject() { this.setProject(this.projIdx + 1); }
  prevProject() { this.setProject(this.projIdx - 1); }

  /** Character gestures at the pedestal (it stands to its left). */
  presentPose() { this.character.setState('point_left', { hold: 5 }); }

  kickModel() { this.bouncer.kick(); sfx.click(); }
  resetModel() { this.bouncer.reset(); sfx.click(); }

  // ------------------------------------------------------------ grab/fling
  _wireGrab() {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane();
    const hit = new THREE.Vector3();
    const grabOff = new THREE.Vector3();
    let history = [];

    const toNdc = (e) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      toNdc(e);
      ray.setFromCamera(ndc, this.camera);
      const hits = ray.intersectObject(this.modelGroup, true);
      if (!hits.length) return;
      this.bouncer.held = true;
      this.controls.enabled = false;
      this.camera.getWorldDirection(hit);
      plane.setFromNormalAndCoplanarPoint(hit, hits[0].point);
      grabOff.subVectors(this.modelGroup.position, hits[0].point);
      history = [[performance.now(), this.modelGroup.position.clone()]];
      try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch {}
      sfx.click();
    });

    this.renderer.domElement.addEventListener('pointermove', (e) => {
      if (!this.bouncer.held) return;
      toNdc(e);
      ray.setFromCamera(ndc, this.camera);
      if (ray.ray.intersectPlane(plane, hit)) {
        this.modelGroup.position.copy(hit).add(grabOff);
        this.modelGroup.position.y = Math.max(0.32, this.modelGroup.position.y);
        history.push([performance.now(), this.modelGroup.position.clone()]);
        if (history.length > 6) history.shift();
      }
    });

    const release = (e) => {
      if (!this.bouncer.held) return;
      this.bouncer.held = false;
      this.controls.enabled = true;
      try { this.renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
      if (history.length >= 2) {
        const [t0, p0] = history[0];
        const [t1, p1] = history[history.length - 1];
        const dt = Math.max((t1 - t0) / 1000, 0.016);
        const v = p1.clone().sub(p0).divideScalar(dt);
        v.clampLength(0, 7);
        this.bouncer.setVelocity(v);
      }
    };
    this.renderer.domElement.addEventListener('pointerup', release);
    this.renderer.domElement.addEventListener('pointercancel', release);
  }

  // ------------------------------------------------------------ frame loop
  _tick() {
    if (!this.active || document.hidden) return;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;

    // orbiting accent lights — the "real-time lighting" mood
    this.accentA.position.set(Math.cos(t * 0.6) * 3.2, 2.4 + Math.sin(t * 0.9) * 0.6, Math.sin(t * 0.6) * 3.2);
    this.accentB.position.set(Math.cos(t * 0.6 + Math.PI) * 3.0, 1.6, Math.sin(t * 0.6 + Math.PI) * 3.0);

    this.physics.step(dt);
    if (this.bouncer.dormant && !this.bouncer.held) {
      // showcase hover: gentle bob + slow turntable spin
      this.modelGroup.position.y = this.bouncer.home.y + Math.sin(t * 1.4) * 0.04;
      this.modelGroup.rotation.y += dt * 0.35;
    }
    this._animatedModel?.(t);

    this.character.update(dt, this.camera.position);
    this._tickWander(dt, t);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc >= 0.5) {
      const fps = Math.round(this._fpsN / this._fpsAcc);
      this._govern(fps);
      this.onFps?.(fps);
      this._fpsAcc = 0; this._fpsN = 0;
    }
  }

  /** True when a throwaway WebGL2 context reports a real GPU (not SwiftShader). */
  _webglIsHardware() {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return false;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return !!name && !/swiftshader|software|llvmpipe|basic render/i.test(name);
    } catch { return false; }
  }

  /** Honest label for a WebGL backend, calling out software rasterizers. */
  _describeWebGL(renderer) {
    try {
      const gl = renderer.backend?.gl;
      const ext = gl?.getExtension?.('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      return /swiftshader|software|llvmpipe|basic render/i.test(name) ? 'WEBGL2 (SOFTWARE)' : 'WEBGL2';
    } catch { return 'WEBGL2'; }
  }

  /**
   * Adaptive performance governor: heavy models tank the frame rate, so step
   * the render resolution down (and eventually shadows off) until it holds,
   * then climb back when there's headroom. Hysteresis prevents flip-flopping.
   */
  _govern(fps) {
    const P = this._perf;
    if (!P || P.cool-- > 0) return;
    if (fps < 28 && P.level < 3) { P.level++; P.cool = 4; this._applyPerf(); }
    else if (fps > 56 && P.level > 0) { P.level--; P.cool = 10; this._applyPerf(); }
  }

  _applyPerf() {
    const P = this._perf;
    const scale = [1, 0.8, 0.62, 0.5][P.level];
    this.renderer.setPixelRatio(Math.max(0.5, this._basePixelRatio * scale));
    if (this.keyLight) this.keyLight.castShadow = !this.low && P.level < 2;

    // Deeper measures, applied progressively and fully undone on recovery:
    //   L2 — on-the-fly decimation of the showcase model + all textures
    //        crunched to 1024px
    //   L3 — the guide decimates too, blendshapes freeze, accent lights off
    const roots = [this.modelGroup, this.character?.root].filter(Boolean);
    if (P.level >= 2) {                      // idempotent: helpers skip done work
      this._crunched = true;
      for (const r of roots) { prepareLods(r); crunchTextures(r, 1024); }
    } else if (this._crunched) {
      this._crunched = false;
      for (const r of roots) restoreTextures(r);
    }
    applyLod(this.modelGroup, P.level >= 2);
    if (this.character?.root) applyLod(this.character.root, P.level >= 3);
    if (this.accentA) this.accentA.visible = P.level < 3;
    if (this.accentB) this.accentB.visible = P.level < 3;

    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w && h) this.renderer.setSize(w, h, false);   // rebuild the drawing buffer
  }

  /**
   * Spotty wanders the showroom between conversations: pick a spot, turn,
   * walk there (procedural gait + bob), settle back to idle facing the
   * visitor. Gestures and talking always take priority.
   */
  _tickWander(dt, t) {
    const ch = this.character;
    const w = this.wander;
    if (!w || ch.staticFBX) return;
    const root = ch.root;

    const busy = ch.talking || (ch.animator.isActive && ch.animator.state !== 'walk');
    if (busy) {
      if (w.target) { w.target = null; w.next = t + 4 + Math.random() * 6; }
      root.position.y *= 1 - Math.min(1, dt * 6);
      return;
    }

    if (!w.target) {
      root.position.y *= 1 - Math.min(1, dt * 6);     // bob settles out
      // drift to face the visitor while standing around
      const toCam = Math.atan2(this.camera.position.x - root.position.x,
                               this.camera.position.z - root.position.z);
      let dy = Math.atan2(Math.sin(toCam - root.rotation.y), Math.cos(toCam - root.rotation.y));
      root.rotation.y += dy * Math.min(1, dt * 0.7);

      if (t > w.next) {
        for (let i = 0; i < 12; i++) {                // find a clear destination
          const a = Math.random() * Math.PI * 2;
          const r = 0.7 + Math.random() * 1.6;
          const x = -1.15 + Math.cos(a) * r;
          const z = 0.1 + Math.sin(a) * r * 0.8;
          if (Math.hypot(x - 1.15, z) < 1.2) continue;   // keep off the pedestal
          if (Math.hypot(x, z) > 2.6) continue;          // stay in the room
          w.target = { x, z };
          ch.setState('walk', { hold: 9999 });
          break;
        }
        if (!w.target) w.next = t + 5;
      }
      return;
    }

    // steer toward the target, slow down for sharp turns
    const dx = w.target.x - root.position.x;
    const dz = w.target.z - root.position.z;
    const dist = Math.hypot(dx, dz);
    const desired = Math.atan2(dx, dz);
    let dy = Math.atan2(Math.sin(desired - root.rotation.y), Math.cos(desired - root.rotation.y));
    root.rotation.y += dy * Math.min(1, dt * 3.5);
    const speed = Math.abs(dy) > 0.7 ? 0.1 : 0.48;
    root.position.x += Math.sin(root.rotation.y) * speed * dt;
    root.position.z += Math.cos(root.rotation.y) * speed * dt;
    root.position.y = Math.abs(Math.sin(ch.animator.gaitPhase)) * 0.028;   // step bob

    if (dist < 0.12) {
      w.target = null;
      w.next = t + 6 + Math.random() * 12;
      ch.setState('idle');
    }
  }

  setActive(on) {
    this.active = on;
    if (on) this.clock.getDelta();   // swallow the pause so physics doesn't jump
  }

  _wireResize() {
    const ro = new ResizeObserver(() => {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    });
    ro.observe(this.container);
  }
}
