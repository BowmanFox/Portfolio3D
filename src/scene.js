// The 3D showroom: WebGPU-first renderer (transparent WebGL2 fallback for
// devices without it), real-time key/fill/orbiting accent lights with
// shadows, the guide character, and a physics-enabled pedestal where the
// current project model can be grabbed and flung around.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Character } from './character.js';
import { PhysicsWorld, Bouncer } from './physics.js';
import { PROJECTS } from './projects.js';
import { loadFBXSafe, computeModelStats, pruneMorphs } from './fbxload.js';
import { sfx } from './audio.js';
import { store } from './store.js';

/** Extended color naming: r,g,b (0-255) → a human color word. */
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
  if (l > 0.93) return 'white';
  if (l < 0.08) return 'black';
  if (s < 0.13) return l > 0.6 ? 'light gray' : 'dark gray';
  if (h >= 18 && h < 48) {
    if (l < 0.35) return 'brown';
    if (l < 0.62 && s < 0.6) return 'tan';
    return 'orange';
  }
  if (h < 15 || h >= 345) return l > 0.72 ? 'pink' : 'red';
  if (h < 68) return l < 0.42 ? 'olive' : 'yellow';
  if (h < 95) return l < 0.4 ? 'olive' : 'lime green';
  if (h < 160) return 'green';
  if (h < 190) return 'teal';
  if (h < 210) return l > 0.6 ? 'sky blue' : 'cyan';
  if (h < 258) return l > 0.68 ? 'sky blue' : 'blue';
  if (h < 295) return 'purple';
  return l > 0.7 ? 'pink' : 'magenta';
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

    let renderer;
    try {
      renderer = new THREE.WebGPURenderer({ antialias: !this.low, alpha: false });
      await renderer.init();
    } catch (err) {
      console.warn('WebGPU init failed, forcing WebGL backend', err);
      renderer = new THREE.WebGPURenderer({ antialias: !this.low, forceWebGL: true });
      await renderer.init();
    }
    this.renderer = renderer;
    this.backendName = renderer.backend?.isWebGPUBackend ? 'WEBGPU' : 'WEBGL2';
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

  /**
   * COLORVISION: sample the actually-rendered frame and histogram it into
   * named colors. Unlike guessing from material tints, this sees textures,
   * lighting and everything else a visitor sees. Returns e.g.
   * "34% sky blue, 22% white, 15% dark gray, 9% tan".
   */
  analyzeColors() {
    try {
      this.renderer.render(this.scene, this.camera);
      const src = this.renderer.domElement;
      const c = document.createElement('canvas');
      c.width = 64; c.height = 48;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(src, 0, 0, 64, 48);
      const px = g.getImageData(0, 0, 64, 48).data;
      const counts = new Map();
      for (let i = 0; i < px.length; i += 4) {
        const name = nameColor(px[i], px[i + 1], px[i + 2]);
        counts.set(name, (counts.get(name) || 0) + 1);
      }
      const total = px.length / 4;
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .filter(([, n]) => n / total > 0.03)
        .map(([name, n]) => `${Math.round(n / total * 100)}% ${name}`)
        .join(', ');
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
    return `${pedestal} ${guide}${screen ? ` Dominant colors on screen right now (measured from rendered pixels): ${screen}.` : ''}`;
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
