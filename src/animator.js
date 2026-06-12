// Pose-transition animation system. States are pose targets (Euler offsets on
// canonical bones, relative to the captured rest pose); every frame each bone
// slerps toward its target with critically-damped smoothing, then procedural
// layers (breathing, head look-at, talk sway, idle micro-glances) stack on
// top. Because everything is rest-pose-relative it works unchanged on the
// procedural robot and on retargeted FBX imports.
import * as THREE from 'three';

const D = Math.PI / 180;
const E = (x = 0, y = 0, z = 0) => [x * D, y * D, z * D];

// Pose library: canonical bone → euler offset (degrees via E()).
// Conventions (procedural rig): arms rest pointing down; +Z on the left arm
// swings it out/up, mirrored on the right; +X pitches forward.
export const POSES = {
  idle: {
    Spine: E(2), Chest: E(1.5),
    LeftArm: E(-3, 0, 5), RightArm: E(-3, 0, -5),
    LeftForeArm: E(-14, 0, 4), RightForeArm: E(-14, 0, -4),
    LeftHand: E(-6), RightHand: E(-6),
  },
  // weight-shift variants — idle cycles through these so standing never
  // reads as a static mannequin
  idle_b: {
    Hips: E(0, 3, 4), Spine: E(2, -2, -3), Chest: E(1, 0, -1), Head: E(0, 2, 2),
    LeftArm: E(-3, 0, 5), RightArm: E(-3, 0, -7),
    LeftForeArm: E(-12, 0, 4), RightForeArm: E(-18, 0, -5),
    LeftLeg: E(0), RightLeg: E(-7), RightUpLeg: E(3),
  },
  idle_c: {
    Hips: E(0, -3, -4), Spine: E(2, 2, 3), Chest: E(1, 0, 1), Head: E(0, -2, -2),
    LeftArm: E(-3, 0, 7), RightArm: E(-3, 0, -5),
    LeftForeArm: E(-18, 0, 5), RightForeArm: E(-12, 0, -4),
    LeftLeg: E(-7), LeftUpLeg: E(3), RightLeg: E(0),
  },
  // base stance for the procedural walk gait (the leg/arm swings layer on top)
  walk: {
    Spine: E(5), Chest: E(2), Head: E(-2),
    LeftArm: E(0, 0, 4), RightArm: E(0, 0, -4),
    LeftForeArm: E(-20, 0, 3), RightForeArm: E(-20, 0, -3),
  },
  talk: {
    Spine: E(3), Chest: E(2), Head: E(-4),
    LeftArm: E(-18, 0, 14), RightArm: E(-26, 0, -18),
    LeftForeArm: E(-55, 0, 8), RightForeArm: E(-70, 0, -10),
  },
  explain: {
    Spine: E(2, -8), Chest: E(2, -6), Head: E(-6, 14),
    RightArm: E(-72, -18, -38), RightForeArm: E(-18, 0, -14), RightHand: E(0, 0, -16),
    LeftArm: E(-12, 0, 10), LeftForeArm: E(-40, 0, 6),
  },
  point_left: {
    Spine: E(0, 14), Chest: E(0, 10), Head: E(0, 24),
    LeftArm: E(-4, 0, 86), LeftForeArm: E(0, 0, 4), LeftHand: E(0, 0, 8),
    RightArm: E(0, 0, -8),
  },
  point_right: {
    Spine: E(0, -14), Chest: E(0, -10), Head: E(0, -24),
    RightArm: E(-4, 0, -86), RightForeArm: E(0, 0, -4), RightHand: E(0, 0, -8),
    LeftArm: E(0, 0, 8),
  },
  think: {
    Spine: E(4, 6), Head: E(10, -12, 8),
    RightArm: E(-58, 22, -20), RightForeArm: E(-118, 0, -10), RightHand: E(-20),
    LeftArm: E(-8, 0, 8), LeftForeArm: E(-30),
  },
  excited: {
    Spine: E(-6), Chest: E(-4), Head: E(-10),
    LeftArm: E(-150, 0, 28), RightArm: E(-150, 0, -28),
    LeftForeArm: E(-18, 0, 12), RightForeArm: E(-18, 0, -12),
  },
  wave: {
    Spine: E(0, -6), Head: E(-4, -8),
    RightArm: E(-148, 0, -34), RightForeArm: E(-24, 0, -20),
    LeftArm: E(0, 0, 8),
  },
  sleep: {
    Spine: E(14), Chest: E(10), Neck: E(16), Head: E(24, 10),
    LeftArm: E(4, 0, 2), RightArm: E(4, 0, -2),
    LeftForeArm: E(-6), RightForeArm: E(-6),
  },

  // --- keyframes used by SEQUENCES ---
  dance_a: {
    Hips: E(0, 0, 7), Spine: E(-4, 10), Head: E(-6, -12),
    LeftArm: E(-158, 0, 22), LeftForeArm: E(-26, 0, 10),
    RightArm: E(-22, 0, -30), RightForeArm: E(-86, 0, -12),
  },
  dance_b: {
    Hips: E(0, 0, -7), Spine: E(-4, -10), Head: E(-6, 12),
    RightArm: E(-158, 0, -22), RightForeArm: E(-26, 0, -10),
    LeftArm: E(-22, 0, 30), LeftForeArm: E(-86, 0, 12),
  },
  dance_c: {
    Hips: E(5), Spine: E(7), Head: E(6),
    LeftArm: E(-92, 0, 55), RightArm: E(-92, 0, -55),
    LeftForeArm: E(-95, 0, 8), RightForeArm: E(-95, 0, -8),
  },
  bow_down: {
    Spine: E(40), Chest: E(24), Neck: E(10), Head: E(8),
    LeftArm: E(10, 0, 6), RightArm: E(10, 0, -6),
    LeftUpLeg: E(-4), RightUpLeg: E(-4),
  },
  shrug_up: {
    LeftShoulder: E(0, 0, 16), RightShoulder: E(0, 0, -16),
    LeftArm: E(-30, 0, 26), RightArm: E(-30, 0, -26),
    LeftForeArm: E(-78, 0, 38), RightForeArm: E(-78, 0, -38),
    LeftHand: E(0, 0, 24), RightHand: E(0, 0, -24),
    Head: E(4, 0, 9),
  },
  stretch_up: {
    Spine: E(-9), Chest: E(-7), Head: E(-14),
    LeftArm: E(-168, 0, 12), RightArm: E(-168, 0, -12),
    LeftForeArm: E(-10), RightForeArm: E(-10),
  },
  stretch_side: {
    Spine: E(0, 0, 15), Chest: E(0, 0, 11), Head: E(0, 0, 6),
    LeftArm: E(-168, 0, 10), RightArm: E(0, 0, -12),
  },
  nod_down: { Neck: E(9), Head: E(20) },
  nod_up: { Head: E(-9) },
  shake_l: { Head: E(0, 30) },
  shake_r: { Head: E(0, -30) },
  facepalm: {
    Spine: E(7), Head: E(16, 0, 5),
    RightArm: E(-128, -32, -22), RightForeArm: E(-122, 0, -16), RightHand: E(-32),
    LeftArm: E(2, 0, 8),
  },
};

// Multi-keyframe animations: arrays of [poseName, seconds]. The per-bone
// slerp smoothing turns the keyframe hops into fluid motion.
export const SEQUENCES = {
  dance:     { loop: true, steps: [['dance_a', .62], ['dance_c', .55], ['dance_b', .62], ['dance_c', .55]] },
  bow:       { steps: [['idle', .25], ['bow_down', 1.2], ['idle', .6]] },
  shrug:     { steps: [['shrug_up', 1.3], ['idle', .5]] },
  stretch:   { steps: [['stretch_up', 1.2], ['stretch_side', 1.0], ['idle', .5]] },
  nod:       { steps: [['nod_down', .3], ['nod_up', .26], ['nod_down', .3], ['idle', .35]] },
  headshake: { steps: [['shake_l', .32], ['shake_r', .32], ['shake_l', .32], ['idle', .35]] },
  facepalm:  { steps: [['facepalm', 1.7], ['idle', .5]] },
};

const ACTIVE_STATES = new Set([
  'talk', 'explain', 'point_left', 'point_right', 'think', 'excited', 'wave', 'walk',
  ...Object.keys(SEQUENCES),
]);

const IDLE_VARIANTS = ['idle', 'idle_b', 'idle_c', 'idle'];

// How much twist (rotation about the limb's own axis) each bone keeps when a
// pose is retargeted onto an imported rig. Shoulders/upper arms candy-wrap
// horribly when twisted; forearms twist naturally (pronation), spine/head
// twist IS yaw and must pass through untouched (default 1).
const TWIST_KEEP = {
  LeftShoulder: 0.1, RightShoulder: 0.1,
  LeftArm: 0.3, RightArm: 0.3,
  LeftForeArm: 0.65, RightForeArm: 0.65,
};

export class Animator {
  /** @param rig {canon: {bone, rest}} from retarget.bindRestPose() */
  constructor(rig) {
    this.setRig(rig);
    this.state = 'idle';
    this.seq = null;
    this.holdUntil = 0;
    this.gaitPhase = 0;
    this._idleVar = 'idle';
    this.t = 0;
    this._glance = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, next: 3 + Math.random() * 5 };
    this._q = new THREE.Quaternion();
    this._qp = new THREE.Quaternion();
    this._qq = new THREE.Quaternion();
    this._qo = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this.onStateChange = null;
  }

  setRig(rig) {
    this.rig = rig;
    this.current = {};                       // canon → live offset quaternion
    for (const canon of Object.keys(rig)) this.current[canon] = new THREE.Quaternion();
  }

  /** Transition to a state (single pose or sequence); active states auto-relax back to idle. */
  set(state, { hold = 0 } = {}) {
    if (!POSES[state] && !SEQUENCES[state]) state = 'idle';
    if (this.state !== state) this.onStateChange?.(state, this.state);
    this.state = state;
    const seqDef = SEQUENCES[state];
    if (seqDef) {
      this.seq = { def: seqDef, i: 0, until: this.t + seqDef.steps[0][1] };
      const total = seqDef.steps.reduce((s, [, d]) => s + d, 0);
      this.holdUntil = hold > 0 ? this.t + hold
        : this.t + (seqDef.loop ? Math.max(7, total * 2) : total + 0.1);
    } else {
      this.seq = null;
      this.holdUntil = hold > 0 ? this.t + hold : (ACTIVE_STATES.has(state) ? this.t + 3.5 : Infinity);
    }
  }

  get isActive() { return ACTIVE_STATES.has(this.state); }

  update(dt, ctx = {}) {
    dt = Math.min(dt, 0.05);          // a lag spike must never teleport a pose
    this.t += dt;
    const { lookYaw = 0, lookPitch = 0, talking = false } = ctx;

    if (this.t > this.holdUntil && this.state !== 'idle' && this.state !== 'sleep') this.set('idle');

    // advance multi-keyframe sequences
    if (this.seq) {
      const steps = this.seq.def.steps;
      while (this.seq && this.t > this.seq.until) {
        this.seq.i++;
        if (this.seq.i >= steps.length) {
          if (this.seq.def.loop) this.seq.i = 0;
          else { this.set('idle'); break; }
        }
        if (this.seq) this.seq.until += steps[this.seq.i][1];
      }
    }

    // idle micro-behaviour: eased glances + slow weight shifts between
    // stance variants, so standing still has life — never a frozen A-pose
    if (this.state === 'idle' && this.t > this._glance.next) {
      this._glance.tYaw = (Math.random() - 0.5) * 0.9;
      this._glance.tPitch = (Math.random() - 0.4) * 0.3;
      if (Math.random() < 0.55) {
        this._idleVar = IDLE_VARIANTS[Math.floor(Math.random() * IDLE_VARIANTS.length)];
      }
      this._glance.next = this.t + 3 + Math.random() * 6;
    }
    if (this.state !== 'idle') { this._glance.tYaw *= 0.92; this._glance.tPitch *= 0.92; }

    // walk gait clock (cadence ~1 step/sec per leg)
    if (this.state === 'walk') this.gaitPhase += dt * 6.2;
    // glance targets are eased, not jumped to — no head snaps
    const gk = Math.min(1, dt * 2.2);
    this._glance.yaw += (this._glance.tYaw - this._glance.yaw) * gk;
    this._glance.pitch += (this._glance.tPitch - this._glance.pitch) * gk;

    const pose = this.seq ? POSES[this.seq.def.steps[this.seq.i][0]]
      : this.state === 'idle' ? POSES[this._idleVar]
      : POSES[this.state];
    const k = 1 - Math.exp(-dt * (this.isActive ? 6.5 : 3.2));   // transition speed

    for (const [canon, { bone, rest, frame, frameInv }] of Object.entries(this.rig)) {
      const off = pose[canon] || [0, 0, 0];
      let [x, y, z] = off;

      // ---- procedural layers --------------------------------------------
      const breathe = Math.sin(this.t * 1.6) * 0.025;
      if (canon === 'Spine') x += breathe;
      if (canon === 'Chest') x += breathe * 1.4;

      if (canon === 'Head' || canon === 'Neck') {
        const w = canon === 'Head' ? 0.65 : 0.35;
        x += THREE.MathUtils.clamp(lookPitch + this._glance.pitch, -0.5, 0.5) * w;
        y += THREE.MathUtils.clamp(lookYaw + this._glance.yaw, -0.85, 0.85) * w;
        if (talking) x += Math.sin(this.t * 4.6) * 0.02;       // nodding while babbling
      }

      if (talking && (canon === 'LeftForeArm' || canon === 'RightForeArm')) {
        const s = canon[0] === 'L' ? 1 : -1;
        x += Math.sin(this.t * 3.6 + s) * 0.08;
        z += Math.cos(this.t * 3.1) * 0.04 * s;
      }
      if (this.state === 'wave' && canon === 'RightForeArm') {
        z += Math.sin(this.t * 6.5) * 0.32;                    // the actual wave
      }
      if (this.state === 'excited') {
        if (canon === 'LeftArm') z += Math.sin(this.t * 6) * 0.09;
        if (canon === 'RightArm') z -= Math.sin(this.t * 6) * 0.09;
      }
      if (this.state === 'dance') {                            // groove bounce
        if (canon === 'Hips') x += Math.sin(this.t * 5.2) * 0.04;
        if (canon === 'Spine') y += Math.sin(this.t * 2.6) * 0.06;
        if (canon === 'Head') x += Math.sin(this.t * 5.2 + 1) * 0.07;
      }
      if (this.state === 'walk') {                             // procedural gait
        const ph = this.gaitPhase;
        const L = Math.sin(ph), R = Math.sin(ph + Math.PI);
        const flexL = Math.max(0, Math.sin(ph - 0.7));
        const flexR = Math.max(0, Math.sin(ph + Math.PI - 0.7));
        switch (canon) {
          case 'LeftUpLeg': x += -L * 0.42; break;             // thigh swing
          case 'RightUpLeg': x += -R * 0.42; break;
          case 'LeftLeg': x += flexL * 0.75; break;            // knee flexion
          case 'RightLeg': x += flexR * 0.75; break;
          case 'LeftFoot': x += -flexL * 0.4 + L * 0.18; break; // keep feet level-ish
          case 'RightFoot': x += -flexR * 0.4 + R * 0.18; break;
          case 'LeftArm': x += -R * 0.2; break;                // counter-swing
          case 'RightArm': x += -L * 0.2; break;
          case 'LeftForeArm': x += -Math.max(0, -R) * 0.25; break;
          case 'RightForeArm': x += -Math.max(0, -L) * 0.25; break;
          case 'Hips': y += L * 0.07; z += Math.cos(ph) * 0.045; break;
          case 'Spine': y += -L * 0.05; break;                 // counter-rotate
          case 'Chest': y += -L * 0.03; break;
          case 'Head': y += L * 0.025; break;                  // stabilize gaze
        }
      }
      if (this.state === 'sleep' && canon === 'Chest') x += Math.sin(this.t * 0.9) * 0.05;

      if (canon === 'Hips') y += Math.sin(this.t * 0.7) * 0.02;  // weight shift

      // ---- blend & apply -------------------------------------------------
      this._q.setFromEuler(this._e.set(x, y, z, 'XYZ'));
      this.current[canon].slerp(this._q, k);

      if (frame) {
        // Imported rigs have arbitrary bone axes, so a local-space offset
        // bends them unpredictably. The pose library is authored in
        // character space (the procedural rig's axes ARE character space);
        // map it through the bind-pose frame captured at import:
        // bone = (Q0⁻¹·O·Q0)·rest. Static frames — smooth, no feedback.
        this._qo.copy(frameInv).multiply(this.current[canon]).multiply(frame);

        // swing/twist split about the limb axis; damp the twist on arm bones
        const tk = TWIST_KEEP[canon] ?? 1;
        const ax = this.rig[canon].twistAxis;
        if (ax && tk < 1) {
          const d = this._qo.x * ax.x + this._qo.y * ax.y + this._qo.z * ax.z;
          this._qp.set(ax.x * d, ax.y * d, ax.z * d, this._qo.w);
          if (this._qp.lengthSq() > 1e-8) {
            this._qp.normalize();                                  // twist
            this._qq.copy(this._qp).invert().premultiply(this._qo); // swing
            this._q.identity().slerp(this._qp, tk);                 // damped twist
            this._qo.copy(this._qq).multiply(this._q);
          }
        }
        bone.quaternion.copy(rest).premultiply(this._qo);
      } else {
        bone.quaternion.copy(rest).multiply(this.current[canon]);
      }
    }
  }
}
