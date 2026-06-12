// Minimal real-time physics tailored to the showroom: a verlet spring chain
// (the character's antenna) and a bouncing rigid body with spring-return for
// the showcase model. Fixed-step integration keeps it stable on mobile.
import * as THREE from 'three';

const GRAVITY = -9.81;

// ------------------------------------------------------------ verlet chain
export class SpringChain {
  /** A rope of points pinned at one end; sample with points[i]. */
  constructor(origin, segments = 4, segLen = 0.07, stiffness = 26) {
    this.segLen = segLen;
    this.stiffness = stiffness;
    this.points = [];
    this.prev = [];
    for (let i = 0; i <= segments; i++) {
      const p = origin.clone().add(new THREE.Vector3(0, i * segLen, 0));
      this.points.push(p);
      this.prev.push(p.clone());
    }
    this._tmp = new THREE.Vector3();
  }

  /** Pin the root to an anchor (world space) and integrate. */
  step(dt, anchor) {
    const pts = this.points, prev = this.prev;
    pts[0].copy(anchor);
    prev[0].copy(anchor);
    const damp = 0.985;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i], pp = prev[i];
      const vx = (p.x - pp.x) * damp, vy = (p.y - pp.y) * damp, vz = (p.z - pp.z) * damp;
      pp.copy(p);
      p.x += vx; p.z += vz;
      // antenna wants to stand up: weak anti-gravity spring + real gravity blend
      p.y += vy + (GRAVITY * 0.12 + this.stiffness * 0.012) * dt * dt * 60;
    }
    // distance constraints
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const d = this._tmp.subVectors(b, a);
        const len = d.length() || 1e-6;
        const diff = (len - this.segLen) / len;
        const w = i === 1 ? 1 : 0.5;
        b.addScaledVector(d, -diff * w);
        if (i > 1) a.addScaledVector(d, diff * (1 - w));
      }
    }
  }
}

// ------------------------------------------------------------ rigid bouncer
export class Bouncer {
  /**
   * Gravity + floor bounce + spring-return-home for a display object.
   * Grab/fling via setVelocity; call step(dt) each frame.
   */
  constructor(object, { home = new THREE.Vector3(), floorY = 0, restitution = 0.55 } = {}) {
    this.obj = object;
    this.home = home.clone();
    this.floorY = floorY;
    this.restitution = restitution;
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3(0, 0.4, 0);
    this.held = false;
    this.dormant = true;          // showcase mode: hover at home, no gravity
    this.settledFor = 0;
    this.onBounce = null;
    object.position.copy(home);
  }

  setVelocity(v) { this.vel.copy(v); this.dormant = false; this.settledFor = 0; }
  kick(strength = 2.4) {
    this.vel.set((Math.random() - 0.5) * strength, strength * (0.8 + Math.random() * 0.5), (Math.random() - 0.5) * strength);
    this.angVel.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 7);
    this.dormant = false;
    this.settledFor = 0;
  }
  reset() {
    this.obj.position.copy(this.home);
    this.obj.rotation.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0.4, 0);
    this.dormant = true;
    this.settledFor = 0;
  }

  step(dt) {
    if (this.held) return;
    const p = this.obj.position;

    if (this.dormant) {
      // ease the last drift out and stay parked at home (no gravity)
      p.lerp(this.home, Math.min(1, dt * 4));
      this.obj.rotation.x *= 1 - Math.min(1, dt * 5);
      this.obj.rotation.z *= 1 - Math.min(1, dt * 5);
      return;
    }

    this.vel.y += GRAVITY * dt;
    p.addScaledVector(this.vel, dt);

    // floor contact
    if (p.y < this.floorY) {
      p.y = this.floorY;
      if (this.vel.y < -0.4) {
        this.vel.y = -this.vel.y * this.restitution;
        this.vel.x *= 0.8; this.vel.z *= 0.8;
        this.angVel.multiplyScalar(0.75);
        this.onBounce?.(Math.min(1, -this.vel.y / 4));
      } else {
        this.vel.y = 0;
        this.vel.x *= 0.92; this.vel.z *= 0.92;
        this.angVel.y *= 0.97; this.angVel.x *= 0.85; this.angVel.z *= 0.85;
      }
    }

    // keep it inside the showroom
    const R = 3.2;
    for (const ax of ['x', 'z']) {
      if (Math.abs(p[ax]) > R) { p[ax] = Math.sign(p[ax]) * R; this.vel[ax] *= -0.6; }
    }

    this.obj.rotation.x += this.angVel.x * dt;
    this.obj.rotation.y += this.angVel.y * dt;
    this.obj.rotation.z += this.angVel.z * dt;

    // once it has come to rest, hand back to dormant mode, which glides it
    // home kinematically (gravity-free) at the top of step()
    const speed = this.vel.length();
    this.settledFor = speed < 0.25 ? this.settledFor + dt : 0;
    if (this.settledFor > 0.9) {
      this.dormant = true;
      this.vel.set(0, 0, 0);
      this.angVel.set(0, 0.4, 0);
      this.settledFor = 0;
    }
  }
}

// ------------------------------------------------------------ world
export class PhysicsWorld {
  constructor() { this.chains = []; this.bouncers = []; this._acc = 0; }
  add(item) {
    (item instanceof SpringChain ? this.chains : this.bouncers).push(item);
    return item;
  }
  remove(item) {
    for (const arr of [this.chains, this.bouncers]) {
      const i = arr.indexOf(item);
      if (i >= 0) arr.splice(i, 1);
    }
  }
  /** Fixed 120 Hz substeps for stability regardless of display refresh. */
  step(dt, anchors = new Map()) {
    this._acc = Math.min(this._acc + dt, 0.1);
    const h = 1 / 120;
    while (this._acc >= h) {
      for (const c of this.chains) c.step(h, anchors.get(c) ?? c.points[0]);
      for (const b of this.bouncers) b.step(h);
      this._acc -= h;
    }
  }
}
