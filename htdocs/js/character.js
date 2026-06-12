// Spotty — the resident guide. Ships as a procedural robot built on a real
// THREE.Bone armature (canonical names), so the same Animator + bone-mapping
// path used for imported FBX characters drives it. Drop a .fbx on the viewer
// (set CONFIG.characterFBX, or pass ?character=URL) and the rig is
// bone-mapped (Mixamo or MMD naming), scaled, grounded and retargeted in
// place of the robot — including facial blendshapes ("aa", "blink", smile).
import * as THREE from 'three';
import { loadFBXSafe } from './fbxload.js';
import { buildBoneMap, bindRestPose, mapReport, relaxTPose, CANONICAL } from './retarget.js';
import { Animator } from './animator.js';
import { SpringChain } from './physics.js';
import { babble, stopBabble } from './audio.js';
import { CONFIG } from './config.js';

// blendshape name patterns → expression channels (English / VRChat / MMD)
const MORPH_PATTERNS = {
  aa:    [/^(aa|ah?|mouth_?(a+|open)|vrc\.v_aa|jawopen)$/i, /^あ$/],
  oh:    [/^(oh?|ou|mouth_?o+|vrc\.v_oh)$/i, /^お$/],
  blink: [/^(blink(_?both)?|eyes?_?closed?|eyeblink)$/i, /^(まばたき|まばたき両目)$/],
  smile: [/^(smile|happy|joy|fun|mouthsmile)$/i, /^(笑い|にこり|にっこり)$/],
};

const PLASTIC = 0xd8d2c0, JOINT = 0x5a5a64, ACCENT = 0x2bd42b;
const UP = new THREE.Vector3(0, 1, 0);

function std(color, opt = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, ...opt });
}
const meshBox = (w, h, d, m, x = 0, y = 0, z = 0) => {
  const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  me.position.set(x, y, z);
  me.castShadow = true;
  return me;
};
const meshCyl = (r1, r2, h, m, x = 0, y = 0, z = 0) => {
  const me = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 12), m);
  me.position.set(x, y, z);
  me.castShadow = true;
  return me;
};

// ---------------------------------------------------------------- face
class Face {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256; this.canvas.height = 192;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.magFilter = THREE.NearestFilter;
    this.expression = 'neutral';
    this.mouth = 0;            // 0..1 open (eased envelope, drives "aa")
    this.blink = 0;            // 0..1 closed (enveloped, drives "blink")
    this._mouthTarget = 0;
    this._blinkPhase = 'idle'; // idle → closing → hold → opening
    this._holdT = 0;
    this._doubleNext = false;
    this._nextBlink = 1.5 + Math.random() * 2.5;
    this._t = 0;
    this._lastDraw = -1;
    this.draw();
  }
  /** One syllable worth of mouth opening (lip-sync attack). */
  speak(intensity = 0.8) { this._mouthTarget = Math.min(1, intensity); }
  /** Request a natural blink at the next opportunity. */
  triggerBlink() { if (this._blinkPhase === 'idle') this._nextBlink = this._t; }
  update(dt) {
    this._t += dt;

    // lip-sync: the target collapses quickly, the lips chase it with a fast
    // attack and a slower release — rounded flaps instead of square pulses
    this._mouthTarget = Math.max(0, this._mouthTarget - dt * 10);
    const rate = this._mouthTarget > this.mouth ? 26 : 8;
    this.mouth += (this._mouthTarget - this.mouth) * Math.min(1, dt * rate);

    // blink: ~55 ms close, ~45 ms hold, ~130 ms open, occasional double-blink
    switch (this._blinkPhase) {
      case 'idle':
        if (this._t >= this._nextBlink) this._blinkPhase = 'closing';
        break;
      case 'closing':
        this.blink += dt / 0.055;
        if (this.blink >= 1) { this.blink = 1; this._holdT = 0.045; this._blinkPhase = 'hold'; }
        break;
      case 'hold':
        this._holdT -= dt;
        if (this._holdT <= 0) this._blinkPhase = 'opening';
        break;
      case 'opening':
        this.blink -= dt / 0.13;
        if (this.blink <= 0) {
          this.blink = 0;
          this._blinkPhase = 'idle';
          if (this._doubleNext) { this._doubleNext = false; this._nextBlink = this._t + 0.15; }
          else { this._doubleNext = Math.random() < 0.14; this._nextBlink = this._t + 2.2 + Math.random() * 3.8; }
        }
        break;
    }

    if (this._t - this._lastDraw > 1 / 20) { this.draw(); this._lastDraw = this._t; }
  }
  draw() {
    const c = this.canvas.getContext('2d');
    const W = 256, H = 192;
    c.fillStyle = '#04140a';
    c.fillRect(0, 0, W, H);
    // phosphor scanlines
    c.fillStyle = 'rgba(43,212,43,.06)';
    for (let y = 0; y < H; y += 4) c.fillRect(0, y, W, 2);
    c.fillStyle = '#2bd42b';
    const ex = this.expression;
    const blinkH = 1 - this.blink * 0.92;
    // eyes
    for (const sx of [-1, 1]) {
      const cx = 128 + sx * 52;
      const cy = 72;
      c.save();
      c.translate(cx, cy);
      if (ex === 'happy') {                      // ∪ shaped happy eyes
        c.beginPath();
        c.arc(0, 8, 22, Math.PI * 1.15, Math.PI * 1.85);
        c.lineWidth = 9; c.strokeStyle = '#2bd42b'; c.stroke();
      } else if (ex === 'sleep') {
        c.fillRect(-20, -3, 40, 6);
      } else {
        const h = 36 * blinkH * (ex === 'thinking' ? 0.55 : 1);
        c.fillRect(-13, -h / 2, 26, Math.max(4, h));
        if (ex === 'thinking' && sx === 1) c.fillRect(-13, -h / 2 - 14, 26, 5); // raised brow
      }
      c.restore();
    }
    // mouth
    const mw = 64, mh = 6 + this.mouth * 34;
    if (ex === 'sleep') {
      c.fillRect(128 - 14, 138, 28, 6);
    } else if (ex === 'happy' && this.mouth < 0.2) {
      c.beginPath();
      c.arc(128, 128, 32, Math.PI * 0.15, Math.PI * 0.85);
      c.lineWidth = 9; c.strokeStyle = '#2bd42b'; c.stroke();
    } else {
      c.fillRect(128 - mw / 2, 142 - mh / 2, mw, mh);
      c.fillStyle = '#04140a';
      if (this.mouth > 0.15) c.fillRect(128 - mw / 2 + 8, 142 - mh / 2 + 5, mw - 16, Math.max(2, mh - 10));
    }
    this.tex.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- character
export class Character {
  constructor() {
    this.root = new THREE.Group();
    this.face = new Face();
    this.talking = false;
    this.usingFBX = false;
    this.report = null;
    this._buildProcedural();

    this.rig = bindRestPose(this.boneMap);
    this.animator = new Animator(this.rig);
    this.animator.onStateChange = (s) => {
      this.face.expression =
        s === 'think' ? 'thinking' :
        (s === 'excited' || s === 'wave') ? 'happy' :
        s === 'sleep' ? 'sleep' : 'neutral';
    };

    // physics antenna: verlet chain pinned to the head top
    this.antenna = new SpringChain(new THREE.Vector3(0, 1.8, 0), 4, 0.065);
    this.antennaGroup = new THREE.Group();
    this._antennaBalls = [];
    const am = std(JOINT, { metalness: 0.6, roughness: 0.3 });
    for (let i = 0; i < this.antenna.points.length; i++) {
      const r = i === this.antenna.points.length - 1 ? 0.045 : 0.018;
      const b = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8),
        i === this.antenna.points.length - 1
          ? std(0xff4242, { emissive: 0x661111, emissiveIntensity: 1.2 })
          : am);
      this.antennaGroup.add(b);
      this._antennaBalls.push(b);
    }

    this._v = new THREE.Vector3();
    this._headWorld = new THREE.Vector3();
    this._qa = new THREE.Quaternion();
    this._qp = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
    this._wagPhase = 0;
    this._wagAmp = 0.1;
    this._wagSpeed = 2.6;
  }

  _bone(name, parent, x, y, z) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    this.boneMap[name] = b;
    return b;
  }

  _buildProcedural() {
    this.boneMap = {};
    const g = new THREE.Group();
    this.proceduralGroup = g;
    this.root.add(g);

    const plastic = std(PLASTIC);
    const joint = std(JOINT);

    const hips = this._bone('Hips', g, 0, 0.88, 0);
    hips.add(meshBox(0.3, 0.14, 0.2, plastic, 0, 0.0, 0));

    // legs
    for (const side of ['Left', 'Right']) {
      const s = side === 'Left' ? 1 : -1;
      const up = this._bone(side + 'UpLeg', hips, s * 0.1, -0.06, 0);
      up.add(meshCyl(0.055, 0.065, 0.32, plastic, 0, -0.17, 0));
      const lo = this._bone(side + 'Leg', up, 0, -0.36, 0);
      lo.add(meshCyl(0.05, 0.055, 0.3, joint, 0, -0.16, 0));
      lo.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), joint));
      const ft = this._bone(side + 'Foot', lo, 0, -0.34, 0.02);
      ft.add(meshBox(0.12, 0.07, 0.24, std(0x46464e), 0, -0.03, 0.05));
    }

    // torso
    const spine = this._bone('Spine', hips, 0, 0.1, 0);
    spine.add(meshBox(0.32, 0.18, 0.2, plastic, 0, 0.06, 0));
    const chest = this._bone('Chest', spine, 0, 0.18, 0);
    chest.add(meshBox(0.38, 0.24, 0.24, plastic, 0, 0.08, 0));
    // chest panel + LED
    chest.add(meshBox(0.2, 0.13, 0.02, std(0x9aa0a8), 0, 0.07, 0.13));
    chest.add(meshBox(0.05, 0.05, 0.02, std(ACCENT, { emissive: ACCENT, emissiveIntensity: 1.6 }), -0.04, 0.07, 0.14));
    chest.add(meshBox(0.05, 0.05, 0.02, std(0xffb000, { emissive: 0xffb000, emissiveIntensity: 1.1 }), 0.04, 0.07, 0.14));

    // arms
    for (const side of ['Left', 'Right']) {
      const s = side === 'Left' ? 1 : -1;
      const sh = this._bone(side + 'Shoulder', chest, s * 0.17, 0.15, 0);
      sh.add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), joint));
      const arm = this._bone(side + 'Arm', sh, s * 0.09, -0.02, 0);
      arm.add(meshCyl(0.045, 0.05, 0.24, plastic, 0, -0.13, 0));
      const fore = this._bone(side + 'ForeArm', arm, 0, -0.27, 0);
      fore.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), joint));
      fore.add(meshCyl(0.04, 0.045, 0.22, joint, 0, -0.12, 0));
      const hand = this._bone(side + 'Hand', fore, 0, -0.25, 0);
      const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), std(0xe8e2d0));
      mitt.scale.set(1, 1.2, 0.8);
      mitt.castShadow = true;
      hand.add(mitt);
    }

    // head: a tiny CRT monitor
    const neck = this._bone('Neck', chest, 0, 0.22, 0);
    neck.add(meshCyl(0.05, 0.06, 0.08, joint, 0, 0.02, 0));
    const head = this._bone('Head', neck, 0, 0.08, 0);
    head.add(meshBox(0.36, 0.3, 0.3, plastic, 0, 0.15, 0));
    head.add(meshBox(0.3, 0.24, 0.02, std(0x3a3a40), 0, 0.15, 0.15)); // bezel
    // the namesake spot on the side of the head
    const spot = meshCyl(0.055, 0.055, 0.012, std(0x46464e));
    spot.rotation.z = Math.PI / 2;
    spot.position.set(0.181, 0.19, 0.04);
    head.add(spot);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.2),
      new THREE.MeshBasicMaterial({ map: this.face.tex, toneMapped: false }));
    screen.position.set(0, 0.15, 0.162);
    head.add(screen);
    head.add(meshBox(0.1, 0.03, 0.02, std(0x9aa0a8), 0.1, 0.02, 0.15)); // "power button"
    this.headBone = head;

    g.traverse(n => { if (n.isMesh) n.castShadow = true; });
  }

  // ------------------------------------------------------------ FBX import
  async loadFBX(source, { onProgress = null, onTexturesSettled = null } = {}) {
    const obj = await loadFBXSafe(source, { onProgress, onTexturesSettled });
    this.lastSource = source;          // kept so dropped textures can re-apply

    // normalize height, feet on the floor, facing +Z
    const bbox = new THREE.Box3().setFromObject(obj);
    const size = bbox.getSize(new THREE.Vector3());
    const scale = CONFIG.characterHeight / Math.max(size.y, 1e-4);
    obj.scale.setScalar(scale);
    bbox.setFromObject(obj);
    obj.position.y -= bbox.min.y;
    obj.userData.baseY = obj.position.y;

    // bone-map the rig onto the canonical armature
    const map = buildBoneMap(obj);
    const report = mapReport(map);

    if (this.fbxGroup) this.root.remove(this.fbxGroup);
    this._drivenSet = null;
    this.fbxGroup = obj;
    this.root.add(obj);
    this.proceduralGroup.visible = false;
    this.antennaGroup.visible = false;
    this.usingFBX = true;
    this.report = report;

    if (report.found.length >= 6) {
      this.staticFBX = false;
      this.boneMapFBX = map;
      this.rig = bindRestPose(map);
      relaxTPose(this.rig, obj);               // T-pose rigs → natural stance

      // Freeze each bone's pose-conversion frame in the (relaxed) bind pose:
      // Q0 = root⁻¹ · parentWorld. The animator uses these static frames to
      // map character-space pose offsets onto this rig's arbitrary bone axes
      // — stable, no per-frame feedback through moving parents.
      for (const e of Object.values(this.rig)) e.bone.quaternion.copy(e.rest);
      obj.updateMatrixWorld(true);
      const rootInv = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
      for (const e of Object.values(this.rig)) {
        const pq = e.bone.parent.getWorldQuaternion(new THREE.Quaternion());
        e.frame = pq.premultiply(rootInv);
        e.frameInv = e.frame.clone().invert();
      }

      // limb axes (bone → child direction, in parent space at bind) for the
      // animator's swing/twist split on the arm chain
      const CHAIN = {
        LeftShoulder: 'LeftArm', LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand',
        RightShoulder: 'RightArm', RightArm: 'RightForeArm', RightForeArm: 'RightHand',
      };
      for (const [canon, childName] of Object.entries(CHAIN)) {
        const e = this.rig[canon], c = this.rig[childName];
        if (!e || !c) continue;
        const bp = e.bone.getWorldPosition(new THREE.Vector3());
        const cp = c.bone.getWorldPosition(new THREE.Vector3());
        const pqInv = e.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
        e.twistAxis = cp.sub(bp).normalize().applyQuaternion(pqInv);
      }

      // Some exporters bind each mesh to its OWN copy of the armature. We
      // animate the copy holding the mapped bones; rebind every skinned mesh
      // onto that copy by bone name (keeping each mesh's own bind inverses),
      // so all meshes deform from one skeleton — exact, no per-frame cost.
      let top = map.Hips;
      while (top.parent?.isBone) top = top.parent;
      const driven = new Map();
      top.traverse((b) => { if (b.isBone && !driven.has(b.name)) driven.set(b.name, b); });
      obj.traverse((n) => {
        if (!n.isSkinnedMesh || !n.skeleton) return;
        const bones = n.skeleton.bones.map((b) => driven.get(b.name) || b);
        if (bones.some((b, i) => b !== n.skeleton.bones[i])) {
          n.skeleton = new THREE.Skeleton(bones, n.skeleton.boneInverses);
        }
      });

      this._drivenSet = new Set(driven.values());
      this._collectExtras(obj, rootInv, this._drivenSet);

      this.animator.setRig(this.rig);
      this.headBone = map.Head || map.Neck || map.Chest || obj;
    } else {
      // unmappable rig: keep the model as a (gently bobbing) static guide
      // instead of rejecting it — blendshapes and babble still work
      this.staticFBX = true;
      this.headBone = map.Head || obj;
      report.rigged = false;
    }

    // tail bones (Tail1, Tail2…, 尻尾) get a procedural mood-driven wag
    this.tailBones = [];
    obj.traverse((n) => {
      if (!n.isBone || !/tail|尻尾|しっぽ/i.test(n.name)) return;
      if (this._drivenSet && !this._drivenSet.has(n)) return;
      let depth = 0, p = n.parent;
      while (p && /tail|尻尾|しっぽ/i.test(p.name)) { depth++; p = p.parent; }
      this.tailBones.push({ bone: n, rest: n.quaternion.clone(), depth });
    });

    // facial blendshapes: scan morph targets ("aa", "blink", あ, まばたき…)
    this.morphs = this._scanMorphs(obj);
    report.morphs = this.morphs
      ? Object.entries(this.morphs).filter(([, v]) => v.length).map(([k]) => k)
      : [];
    return report;
  }

  /**
   * Recruit non-canonical bones: eye bones get gaze tracking, ear chains get
   * sway + flicks, finger chains get a baked relaxed curl (no more stiff
   * splayed robot hands). Frames follow the same Q0 = root⁻¹·parentWorld
   * scheme as the main rig.
   */
  _collectExtras(obj, rootInv, drivenSet) {
    this.extras = { eyes: [], ears: [], fingers: [] };
    const canonical = new Set(Object.values(this.boneMapFBX || {}));
    obj.traverse((n) => {
      if (!n.isBone || canonical.has(n)) return;
      // only the driven skeleton copy — followers mirror it for the others
      if (drivenSet && !drivenSet.has(n)) return;
      const nm = n.name.toLowerCase();
      let kind = null;
      if (/(^|[\s_.:])eye/.test(nm) && !/brow|lid|lash/.test(nm)) kind = 'eyes';
      else if (/(^|[\s_.:])ear/.test(nm)) kind = 'ears';
      else if (/thumb|index|middle|ring|little|pinky|finger/.test(nm)) kind = 'fingers';
      if (!kind) return;
      const pq = n.parent.getWorldQuaternion(new THREE.Quaternion());
      const frame = pq.premultiply(rootInv);
      const e = { bone: n, rest: n.quaternion.clone(), frame, frameInv: frame.clone().invert() };
      if (kind === 'ears') {
        let d = 0, p = n.parent;
        while (p && /ear/i.test(p.name)) { d++; p = p.parent; }
        e.depth = d;
        e.side = /(^|[\s_.:])r|right/.test(nm.replace(/ear/g, '')) ? 1 : -1;
        e.phase = Math.random() * 6;
      }
      if (kind === 'fingers') {
        let d = 0, p = n.parent;
        while (p && /thumb|index|middle|ring|little|pinky|finger/i.test(p.name)) { d++; p = p.parent; }
        e.depth = d;
        e.thumb = /thumb/.test(nm);
      }
      this.extras[kind].push(e);
    });

    // bake a relaxed curl into the fingers (static — they ride the hand bone).
    // With arms relaxed at the sides the palms face the thighs, so a natural
    // curl is a roll about the character's forward axis, toward the body:
    // negative Z for the left hand, positive Z for the right.
    const off = new THREE.Quaternion(), eul = new THREE.Euler(), app = new THREE.Quaternion();
    const v = new THREE.Vector3();
    for (const f of this.extras.fingers) {
      f.bone.getWorldPosition(v);
      this.root.worldToLocal(v);
      const side = v.x >= 0 ? 1 : -1;                  // +X = character's left
      const deg = (f.thumb ? 9 + f.depth * 6 : 18 + f.depth * 11) * Math.PI / 180;
      off.setFromEuler(eul.set(f.thumb ? -deg * 0.4 : 0, 0, -side * deg));
      app.copy(f.frameInv).multiply(off).multiply(f.frame);
      f.bone.quaternion.copy(f.rest).premultiply(app);
    }
    this._earFlick = { next: 3 + Math.random() * 4, env: 0, side: 1 };
  }

  _scanMorphs(root) {
    const found = { aa: [], oh: [], blink: [], smile: [] };
    let n = 0;
    root.traverse((m) => {
      if (!m.isMesh || !m.morphTargetDictionary) return;
      for (const [name, idx] of Object.entries(m.morphTargetDictionary)) {
        for (const [key, pats] of Object.entries(MORPH_PATTERNS)) {
          if (pats.some(p => p.test(name.trim()))) {
            found[key].push({ mesh: m, idx });
            n++;
            break;
          }
        }
      }
    });
    return n ? found : null;
  }

  _setMorph(key, v) {
    for (const { mesh, idx } of this.morphs[key]) mesh.morphTargetInfluences[idx] = v;
  }

  useProcedural() {
    if (this.fbxGroup) { this.root.remove(this.fbxGroup); this.fbxGroup = null; }
    this.proceduralGroup.visible = true;
    this.antennaGroup.visible = true;
    this.usingFBX = false;
    this.staticFBX = false;
    this.report = null;
    this.morphs = null;
    this.tailBones = null;
    this.extras = null;
    this._drivenSet = null;
    this.rig = bindRestPose(this.boneMap);
    this.animator.setRig(this.rig);
    this.headBone = this.boneMap.Head;
  }

  // ------------------------------------------------------------ behaviour
  /** Speak: babble audio + mouth flaps + gesture state, returns duration (s). */
  talk(text, state = 'talk') {
    this.stopTalking();
    this.talking = true;
    this.animator.set(state, { hold: 600 });   // released in onDone
    const handle = babble(text, {
      pitch: this.usingFBX ? 0.85 : 1,
      onSyllable: () => { this.face.speak(0.55 + Math.random() * 0.45); },
      onDone: () => {
        this.talking = false;
        this.animator.set('idle');
        this.face.triggerBlink();      // a natural blink ends the sentence
      },
    });
    return handle.duration;
  }

  stopTalking() {
    stopBabble();
    this.talking = false;
  }

  setState(s, opt) { this.animator.set(s, opt); }

  /** Per-frame update. lookTarget in world space (usually the camera). */
  update(dt, lookTarget) {
    // look angles in character-local space
    let lookYaw = 0, lookPitch = 0;
    if (lookTarget && this.headBone) {
      this.headBone.getWorldPosition(this._headWorld);
      this._v.copy(lookTarget).sub(this._headWorld);
      const rootYaw = this.root.rotation.y;
      lookYaw = Math.atan2(this._v.x, this._v.z) - rootYaw;
      lookYaw = Math.atan2(Math.sin(lookYaw), Math.cos(lookYaw));   // wrap
      lookPitch = -Math.atan2(this._v.y, Math.hypot(this._v.x, this._v.z));
    }

    this.animator.update(dt, { lookYaw, lookPitch, talking: this.talking });
    this.face.update(dt);

    // eye-bone gaze (leads the head) + ear sway/flicks
    if (this.usingFBX && this.extras) {
      const eul = this._euler ??= new THREE.Euler();
      if (this.extras.eyes.length) {
        const ey = THREE.MathUtils.clamp(lookYaw * 0.55, -0.38, 0.38);
        const ep = THREE.MathUtils.clamp(lookPitch * 0.55, -0.26, 0.26);
        this._qa.setFromEuler(eul.set(ep, ey, 0));
        for (const e of this.extras.eyes) {
          this._qb.copy(e.frameInv).multiply(this._qa).multiply(e.frame);
          e.bone.quaternion.copy(e.rest).premultiply(this._qb);
        }
      }
      if (this.extras.ears.length) {
        const t = this.animator.t;
        const ef = this._earFlick;
        if (t > ef.next) { ef.env = 1; ef.side = Math.random() < 0.5 ? -1 : 1; ef.next = t + 3.5 + Math.random() * 7; }
        ef.env = Math.max(0, ef.env - dt * 5);
        for (const e of this.extras.ears) {
          const sway = Math.sin(t * 1.1 + e.phase) * 0.028;
          const fl = (e.side === ef.side ? ef.env : ef.env * 0.12) * Math.sin(ef.env * 13) * 0.2 * (1 + e.depth * 0.25);
          this._qa.setFromEuler(eul.set(fl * 0.5, 0, sway + fl * e.side * 0.5));
          this._qb.copy(e.frameInv).multiply(this._qa).multiply(e.frame);
          e.bone.quaternion.copy(e.rest).premultiply(this._qb);
        }
      }
    }

    // unrigged static guide: sway the whole model so it still feels alive
    if (this.staticFBX && this.fbxGroup) {
      const t = this.animator.t;
      this.fbxGroup.rotation.y = Math.sin(t * 0.8) * 0.12 + (this.talking ? Math.sin(t * 6) * 0.03 : 0);
      this.fbxGroup.position.y = this.fbxGroup.userData.baseY + Math.sin(t * 1.6) * 0.012;
    }

    // tail wag: side-to-side swing around the world up-axis, phase-delayed
    // along the chain so it whips naturally; mood sets speed and amplitude
    if (this.usingFBX && this.tailBones?.length) {
      const excited = this.face.expression === 'happy' ||
                      ['dance', 'excited', 'wave'].includes(this.animator.state);
      const ampT = excited ? 0.3 : this.talking ? 0.18 : 0.09;
      const spdT = excited ? 8.5 : this.talking ? 5.5 : 2.6;
      const k = Math.min(1, dt * 3);
      this._wagAmp += (ampT - this._wagAmp) * k;
      this._wagSpeed += (spdT - this._wagSpeed) * k;
      this._wagPhase += dt * this._wagSpeed;
      for (const t of this.tailBones) {
        const a = Math.sin(this._wagPhase - t.depth * 0.55) * this._wagAmp * (0.45 + t.depth * 0.28);
        this._qa.setFromAxisAngle(UP, a);            // swing, in world space
        t.bone.parent.getWorldQuaternion(this._qp);  // parent world orientation
        // world-space swing → bone-local: qp⁻¹ · swing · qp
        this._qb.copy(this._qp).invert().multiply(this._qa).multiply(this._qp);
        t.bone.quaternion.copy(t.rest).premultiply(this._qb);
      }
    }

    // drive blendshapes from the same expression state as the canvas face
    if (this.usingFBX && this.morphs) {
      const happy = this.face.expression === 'happy' ? 0.9 : 0;
      this._smile = (this._smile ?? 0) + (happy - (this._smile ?? 0)) * Math.min(1, dt * 6);
      this._setMorph('aa', Math.min(1, this.face.mouth));
      this._setMorph('oh', Math.max(0, this.face.mouth - 0.55) * 0.8);
      this._setMorph('blink', Math.min(1, this.face.blink * 1.15));
      this._setMorph('smile', this._smile);
    }


    // antenna physics: pin to head top, mirror chain into the ball meshes
    if (this.antennaGroup.visible && this.headBone) {
      this.headBone.getWorldPosition(this._headWorld);
      this._headWorld.y += 0.31;
      this.antenna.step(Math.min(dt, 0.05), this._headWorld);
      this.antenna.points.forEach((p, i) => this._antennaBalls[i].position.copy(p));
    }
  }
}
