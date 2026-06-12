// Portfolio projects: data the guide "explains".
//
// Each entry can showcase a REAL model: set `modelFBX` to a .fbx URL (same
// origin or CORS-enabled) and it's loaded onto the pedestal, normalized, and
// measured — triangle/vertex/bone/blendshape counts land in `liveStats`,
// which both chat brains read out. `buildModel()` stays as the instant
// procedural fallback while the FBX streams in (or if it fails).
//
// Per-project fields the brains use:
//   specs        — technical bullet points
//   forEmployers — what a hiring manager should take away
//   eli5         — the plain-language version for non-technical visitors
//   how          — how it works under the hood
import * as THREE from 'three';

function mat(color, { metal = 0.2, rough = 0.55, emissive = 0x000000, ei = 1 } = {}) {
  return new THREE.MeshStandardMaterial({
    color, metalness: metal, roughness: rough,
    emissive, emissiveIntensity: ei,
  });
}

function box(w, h, d, m) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); }
function cyl(rt, rb, h, m, seg = 14) { return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); }

export const PROJECTS = [
  {
    id: 'Bowman Wolf Hyena',
    icon: '🐺',
    name: 'WOLF HYENA',
    sub: 'Game-ready rigged character · 2026',
    modelFBX: 'src/FORCOMMANDER17.fbx',
    blurb: 'A fully rigged, game-ready character avatar — Bowman.',
    specs: [
      'FBX 7.4 binary, single skinned mesh, real-time ready',
      '75-bone armature: full finger articulation, ears, tail, eye bones',
       '64,000 Vertices: In modern game limits',
      'Facial blendshapes ("Facial tracking too, ARKIT") for lip-sync and expression',
      'Humanoid-standard naming — retargets to Unity/Unreal/VRChat rigs',
      'Authored end-to-end: sculpt → retopo → UV → texture → skin weights',
    ],
    forEmployers: [
      'Demonstrates complete character pipeline ownership, from high-poly sculpt to engine-ready export',
      'Clean retopology and weight painting — deforms correctly under animation without manual fixes',
      'Rig follows humanoid conventions, so studios can drop it into existing animation systems',
      'Optimized for real-time use: budget-conscious geometry, minimal draw calls',
    ],
    eli5: 'Think of it as a digital puppet. Inside the visible "skin" there is a skeleton of 75 invisible joints; pulling a joint moves the surface naturally, like tendons. The face has pre-sculpted shapes (mouth open, eyes shut) that blend smoothly — that is how it talks and blinks. Making one well means a game studio can animate it without fixing anything. 64,000 vertices are made to accomplish this',
    how: 'The mesh is bound to the skeleton with per-vertex weights, so each triangle follows a blend of nearby bones. Facial motion uses blendshapes — stored offsets of the same vertices — mixed at runtime. Because bones use standard humanoid names, any engine can map its animations onto it automatically; that is exactly what this site does to make it walk, talk and dance.',
    keywords: ['wolf', 'hyena', 'avatar', 'character', 'rig', 'wade', 'model', 'skinned', 'puppet', 'guide'],
    buildModel() {
      // simple mannequin placeholder while the real FBX streams in
      const g = new THREE.Group();
      const m = mat(0x8d93a8, { rough: 0.5 });
      const torso = box(0.34, 0.45, 0.2, m); torso.position.y = 0.25; g.add(torso);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), m);
      head.position.y = 0.62; g.add(head);
      for (const s of [-1, 1]) {
        const arm = cyl(0.045, 0.05, 0.4, m); arm.position.set(s * 0.24, 0.27, 0); g.add(arm);
        const leg = cyl(0.055, 0.06, 0.45, m); leg.position.set(s * 0.09, -0.2, 0); g.add(leg);
      }
      return g;
    },
  },
  {
    id: 'synthwave9000',
    icon: '🎹',
    name: 'SYNTHWAVE-9000',
    sub: 'Wavetable synthesizer · 2024',
    modelFBX: '',          // ← drop a .fbx URL here to showcase a real model
    blurb: 'A browser-based wavetable synthesizer with a 64-voice polyphonic engine.',
    forEmployers: [
      'Deep Web Audio / DSP expertise: real-time constraints met on the UI-hostile web platform',
      'Performance engineering: 64 simultaneous voices with zero garbage-collector hitches',
      'Shipped product thinking: shareable 2 KB patch URLs drove organic adoption',
    ],
    eli5: 'It is a musical keyboard that lives in a web page. Press keys, get rich synthesizer sound instantly — no install. The hard part is that browsers are bad at doing things at exact times, and music falls apart if timing slips even a few milliseconds. This solves that.',
    specs: [
      '64-voice polyphony on a single AudioWorklet thread',
      '4 morphable wavetable oscillators, 256 frames each',
      'Zero-delay-feedback ladder filter (24 dB/oct)',
      'WebMIDI in/out, < 6 ms round-trip latency',
      'Patch format: 2 KB JSON, shareable by URL',
    ],
    how: 'The whole voice engine runs inside one AudioWorklet so the UI thread never touches a sample. Wavetables are pre-interpolated into a flat Float32Array and voices scan it with cubic interpolation. The filter is a zero-delay-feedback ladder solved per-sample, which is why the resonance stays stable when you sweep it.',
    keywords: ['synth', 'synthesizer', 'audio', 'music', 'wavetable', '9000'],
    buildModel() {
      const g = new THREE.Group();
      const body = box(1.5, 0.16, 0.6, mat(0x2a2a35, { rough: 0.4 }));
      g.add(body);
      // keys
      for (let i = 0; i < 14; i++) {
        const k = box(0.09, 0.04, 0.34, mat(0xf2efe4, { rough: 0.3 }));
        k.position.set(-0.66 + i * 0.102, 0.1, 0.1);
        g.add(k);
        if (![2, 6, 9, 13].includes(i)) {
          const bk = box(0.055, 0.05, 0.2, mat(0x111118));
          bk.position.set(-0.61 + i * 0.102, 0.125, 0.02);
          g.add(bk);
        }
      }
      // knobs + screen
      for (let i = 0; i < 5; i++) {
        const kn = cyl(0.045, 0.05, 0.05, mat(0xff5a36, { emissive: 0x551100, rough: 0.35 }));
        kn.position.set(-0.55 + i * 0.16, 0.115, -0.2);
        g.add(kn);
      }
      const screen = box(0.42, 0.02, 0.2, mat(0x06140a, { emissive: 0x2bd42b, ei: 0.9 }));
      screen.position.set(0.42, 0.1, -0.18);
      g.add(screen);
      return g;
    },
  },
  {
    id: 'pixelforge',
    icon: '🕹️',
    name: 'PIXELFORGE ENGINE',
    sub: 'Retro game engine · 2023',
    modelFBX: '',
    blurb: 'A fantasy-console game engine that ships entire games as 32 KB cartridges.',
    forEmployers: [
      'Systems-level engineering: data-oriented ECS design, cache-aware memory layout',
      'Deterministic simulation — the foundation skill behind reliable multiplayer netcode',
      'Extreme constraint budgeting: complete playable games in 32 KB',
    ],
    eli5: 'A tiny game console that exists only in software. Whole games fit in 32 kilobytes — smaller than one photo on your phone. Because the math is exact on every device, two players see identical games while sending almost nothing over the network.',
    specs: [
      'ECS core: 10,000 entities at 60 fps on a 2015 phone',
      'Fixed-point (16.16) deterministic physics for lockstep netplay',
      '128×128 → 480×270 virtual displays, palette of 32',
      'Cartridge = code + assets in one 32 KB binary blob',
      'Built-in tracker: 8 channels, 4-op FM',
    ],
    how: 'Everything is data-oriented: components live in flat typed arrays and systems iterate them linearly, so the cache never stalls. Physics uses 16.16 fixed-point math — identical results on every device — which is what makes deterministic lockstep multiplayer possible without sending state, only inputs.',
    keywords: ['game', 'engine', 'pixel', 'cartridge', 'forge', 'ecs'],
    buildModel() {
      const g = new THREE.Group();
      const cart = box(0.8, 0.9, 0.16, mat(0x8d8d99, { rough: 0.6 }));
      g.add(cart);
      const label = box(0.62, 0.5, 0.02, mat(0xe8b13c, { emissive: 0x402800, rough: 0.5 }));
      label.position.set(0, 0.12, 0.09);
      g.add(label);
      const labelArt = box(0.5, 0.3, 0.012, mat(0x16323e, { emissive: 0x0a4a6e, ei: 1.4 }));
      labelArt.position.set(0, 0.16, 0.1);
      g.add(labelArt);
      const notch = box(0.55, 0.1, 0.17, mat(0x6f6f7c));
      notch.position.set(0, -0.42, 0);
      g.add(notch);
      for (let i = 0; i < 9; i++) {
        const pin = box(0.04, 0.07, 0.02, mat(0xd9b23c, { metal: 0.9, rough: 0.25 }));
        pin.position.set(-0.24 + i * 0.06, -0.43, 0.085);
        g.add(pin);
      }
      const ridge = box(0.8, 0.06, 0.18, mat(0x77778a));
      ridge.position.y = 0.47;
      g.add(ridge);
      return g;
    },
  },
  {
    id: 'skycrawler',
    icon: '🚁',
    name: 'SKYCRAWLER MK-II',
    sub: 'Autonomous drone · 2025',
    modelFBX: '',
    blurb: 'A self-navigating quadcopter that maps interiors without GPS.',
    forEmployers: [
      'Full-stack robotics: sensor fusion, motion planning, and embedded Rust firmware in one project',
      'Hard real-time control: 1 kHz loops on resource-constrained hardware',
      'Safety-critical mindset — graceful degradation when sensors disagree',
    ],
    eli5: 'A small flying robot that finds its way around inside buildings, where GPS does not reach. It watches the world through a camera, feels its own motion like your inner ear does, and combines the two to know where it is — then draws a 3D map as it flies.',
    specs: [
      'Visual-inertial SLAM at 200 Hz on an embedded NPU',
      'Time-of-flight depth grid: 64×48 @ 30 fps',
      'Flight controller: 1 kHz PID loops, custom Rust firmware',
      '22 min endurance, 380 g all-up weight',
      'Mesh maps stream over WebRTC to the ground station',
    ],
    how: 'Indoors there is no GPS, so it fuses camera features with the IMU — visual-inertial odometry — to know where it is. The depth sensor fills a rolling voxel grid, an A* planner replans twenty times a second, and the Rust flight controller runs its PID loops at a full kilohertz so gusts get corrected before you can see them.',
    keywords: ['drone', 'quad', 'copter', 'slam', 'fly', 'crawler', 'robot'],
    buildModel() {
      const g = new THREE.Group();
      const hull = box(0.5, 0.16, 0.5, mat(0x2d3640, { rough: 0.45 }));
      g.add(hull);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), mat(0x101418, { rough: 0.15, metal: 0.6 }));
      dome.position.y = 0.13;
      g.add(dome);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), mat(0x000000, { emissive: 0xff2222, ei: 2 }));
      eye.position.set(0, 0.1, 0.24);
      g.add(eye);
      const armM = mat(0x596673);
      const props = [];
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const arm = box(0.34, 0.05, 0.08, armM);
        arm.position.set(sx * 0.38, 0.02, sz * 0.38);
        arm.rotation.y = Math.atan2(sz, sx);
        g.add(arm);
        const motor = cyl(0.05, 0.06, 0.08, mat(0x1d242b));
        motor.position.set(sx * 0.52, 0.07, sz * 0.52);
        g.add(motor);
        const prop = box(0.42, 0.012, 0.045, mat(0xcfd6dd, { rough: 0.3 }));
        prop.position.set(sx * 0.52, 0.125, sz * 0.52);
        g.add(prop);
        props.push(prop);
      }
      g.userData.animate = (t) => props.forEach((p, i) => { p.rotation.y = t * (18 + i) * (i % 2 ? 1 : -1); });
      return g;
    },
  },
  {
    id: 'turbotable',
    icon: '💿',
    name: 'TURBOTABLE',
    sub: 'Robotic DJ turntable · 2022',
    modelFBX: '',
    blurb: 'A motorized turntable robot that beat-matches real vinyl by listening to it.',
    forEmployers: [
      'Mechatronics + DSP integration: audio analysis directly closing a motor control loop',
      'Precision control engineering: ±0.001% speed stability on consumer-grade hardware',
      'Built, not just designed — PCB, firmware and enclosure all original work',
    ],
    eli5: 'A record player that DJs with itself. It listens to the music coming off the vinyl, finds the drum beat, and nudges the motor speed until the beat lines up with other music — the trick human DJs do by touch, done by a chip a thousand times per second.',
    specs: [
      'Direct-drive BLDC, ±0.001% wow & flutter under PID',
      'Onset detection DSP on a Cortex-M7 @ 480 MHz',
      'Beat-matching converges in < 4 bars',
      'Tonearm servo: 12-bit magnetic encoder feedback',
      'MIDI clock out for syncing the rest of the rig',
    ],
    how: 'A microphone on the tonearm feeds an onset detector that finds the kick drum in real time. A phase-locked loop compares those onsets to the master MIDI clock and nudges the BLDC motor torque through a PID controller — the same trick a human DJ does with their finger, but a thousand times a second.',
    keywords: ['turntable', 'dj', 'vinyl', 'record', 'turbo', 'music robot'],
    buildModel() {
      const g = new THREE.Group();
      const plinth = box(1.2, 0.12, 0.95, mat(0x3a3026, { rough: 0.5 }));
      g.add(plinth);
      const platter = cyl(0.42, 0.42, 0.04, mat(0x18181c, { rough: 0.3 }), 32);
      platter.position.set(-0.12, 0.1, 0);
      g.add(platter);
      const record = cyl(0.4, 0.4, 0.012, mat(0x0a0a0c, { rough: 0.25 }), 32);
      record.position.set(-0.12, 0.13, 0);
      g.add(record);
      const labelC = cyl(0.13, 0.13, 0.016, mat(0xe85d9e, { emissive: 0x401028 }), 24);
      labelC.position.set(-0.12, 0.135, 0);
      g.add(labelC);
      const armBase = cyl(0.07, 0.08, 0.1, mat(0xb9bec4, { metal: 0.8, rough: 0.3 }));
      armBase.position.set(0.42, 0.12, -0.28);
      g.add(armBase);
      const arm = box(0.5, 0.025, 0.03, mat(0xd7dce1, { metal: 0.85, rough: 0.25 }));
      arm.position.set(0.2, 0.19, -0.12);
      arm.rotation.y = 0.6;
      g.add(arm);
      g.userData.animate = (t) => { record.rotation.y = t * 3.49; labelC.rotation.y = t * 3.49; };
      return g;
    },
  },
  {
    id: 'netscapegarden',
    icon: '🌱',
    name: 'NETSCAPE GARDEN',
    sub: 'WebGPU generative art · 2026',
    modelFBX: '',
    blurb: 'An infinite procedural garden grown entirely in WebGPU compute shaders.',
    forEmployers: [
      'Early WebGPU adoption: compute-shader pipelines (WGSL) before most teams touched the API',
      'GPU-first architecture: a million animated elements with near-idle CPU',
      'Generative-systems craft: deterministic, art-directable procedural growth',
    ],
    eli5: 'A digital garden that grows itself. Instead of an artist placing every leaf, simple growth rules run a million times in parallel on the graphics chip, so each visitor gets a unique garden that sways in the wind — and even a modest laptop never breaks a sweat.',
    specs: [
      'L-system growth solved in WGSL compute, 1M segments',
      'Single indirect draw call for the whole garden',
      'Wind: curl-noise field evaluated on-GPU per vertex',
      'Deterministic seeds — every visitor URL is a unique garden',
      'Runs at 120 fps on integrated graphics',
    ],
    how: 'Each plant is an L-system rewritten in a compute shader: a buffer of turtle-graphics instructions expands generation by generation entirely on the GPU. The vertex shader then bends every stem through a curl-noise wind field, and one indirect draw renders the lot — the CPU basically goes to sleep.',
    keywords: ['garden', 'plant', 'webgpu', 'shader', 'art', 'generative', 'netscape'],
    buildModel() {
      const g = new THREE.Group();
      const pot = cyl(0.3, 0.22, 0.3, mat(0xb5562e, { rough: 0.7 }));
      pot.position.y = 0.15;
      g.add(pot);
      const soil = cyl(0.27, 0.27, 0.03, mat(0x2b1d12));
      soil.position.y = 0.3;
      g.add(soil);
      const stems = [];
      const leafM = mat(0x2f9e44, { emissive: 0x062f10, rough: 0.5 });
      for (let i = 0; i < 7; i++) {
        const h = 0.45 + Math.random() * 0.5;
        const stem = cyl(0.012, 0.02, h, mat(0x37b24d), 6);
        const a = (i / 7) * Math.PI * 2;
        stem.position.set(Math.cos(a) * 0.12, 0.3 + h / 2, Math.sin(a) * 0.12);
        stem.rotation.z = Math.cos(a) * 0.35;
        stem.rotation.x = -Math.sin(a) * 0.35;
        g.add(stem);
        stems.push(stem);
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.07 + Math.random() * 0.05, 8, 6), leafM);
        leaf.scale.y = 1.6;
        leaf.position.set(stem.position.x * 1.8, 0.32 + h, stem.position.z * 1.8);
        g.add(leaf);
      }
      const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), mat(0xffd43b, { emissive: 0x664f00, ei: 1.5 }));
      bloom.position.set(0, 1.18, 0);
      g.add(bloom);
      g.userData.animate = (t) => {
        stems.forEach((s, i) => { s.rotation.y = Math.sin(t * 1.2 + i) * 0.08; });
        bloom.rotation.y = t * 0.8;
      };
      return g;
    },
  },
];

export function findProject(query) {
  const q = query.toLowerCase();
  return PROJECTS.find(p =>
    q.includes(p.id) ||
    q.includes(p.name.toLowerCase()) ||
    p.keywords.some(k => q.includes(k)) ||
    p.name.toLowerCase().split(/[\s-]+/).some(w => w.length > 3 && q.includes(w)));
}
