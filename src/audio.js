// Web Audio engine: lo-fi UI sfx, character babble, and the soundtrack —
// "Ode to Sadness" (src/ode-to-sadness.mid) parsed and performed live on a
// synthesized piano, looped with evolving variation passes. SFX and babble
// remain fully procedural.
import { store } from './store.js';

let ctx = null;
let master, sfxBus, voxBus, musicBus, crusher;
let muted = store.get('audio.muted', false);

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.8;

  // gentle "lo-fi" coloring on everything: soft clip + high rolloff
  crusher = ctx.createWaveShaper();
  const n = 256, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(1.6 * x) * 0.9;
  }
  crusher.curve = curve;
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 7200;

  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9;
  voxBus = ctx.createGain(); voxBus.gain.value = 0.85;
  musicBus = ctx.createGain(); musicBus.gain.value = 0.55;

  sfxBus.connect(crusher); voxBus.connect(crusher); musicBus.connect(crusher);
  crusher.connect(lpf); lpf.connect(master); master.connect(ctx.destination);
  return ctx;
}

function blip(bus, { freq = 440, type = 'square', dur = 0.08, vol = 0.25, at = 0, slide = 0, lp = 3500 }) {
  if (!ensureCtx()) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = lp;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  osc.connect(f).connect(g).connect(bus);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

function noiseBurst(bus, { dur = 0.1, vol = 0.2, at = 0, lp = 4000, hp = 100 }) {
  if (!ensureCtx()) return;
  const t0 = ctx.currentTime + at;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f1 = ctx.createBiquadFilter(); f1.type = 'lowpass'; f1.frequency.value = lp;
  const f2 = ctx.createBiquadFilter(); f2.type = 'highpass'; f2.frequency.value = hp;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f1).connect(f2).connect(g).connect(bus);
  src.start(t0);
}

// ---------------------------------------------------------------- UI SFX
export const sfx = {
  click()    { blip(sfxBus, { freq: 1100, type: 'square', dur: 0.035, vol: 0.16 }); },
  open()     { blip(sfxBus, { freq: 330, slide: 360, type: 'triangle', dur: 0.14, vol: 0.3 });
               blip(sfxBus, { freq: 660, type: 'square', dur: 0.06, vol: 0.12, at: 0.07 }); },
  close()    { blip(sfxBus, { freq: 620, slide: -380, type: 'triangle', dur: 0.13, vol: 0.28 }); },
  minimize() { blip(sfxBus, { freq: 500, slide: -250, type: 'sine', dur: 0.1, vol: 0.25 }); },
  menu()     { blip(sfxBus, { freq: 880, type: 'triangle', dur: 0.05, vol: 0.18 }); },
  error()    { blip(sfxBus, { freq: 196, type: 'square', dur: 0.22, vol: 0.22 });
               blip(sfxBus, { freq: 155, type: 'square', dur: 0.26, vol: 0.22, at: 0.02 }); },
  ding()     { blip(sfxBus, { freq: 1318, type: 'sine', dur: 0.3, vol: 0.2 });
               blip(sfxBus, { freq: 1760, type: 'sine', dur: 0.4, vol: 0.12, at: 0.05 }); },
  bounce(v = 1) { blip(sfxBus, { freq: 180 + 160 * v, slide: -90, type: 'sine', dur: 0.07, vol: 0.12 * v }); },
  startup() {
    // little original boot chime — rising major pad
    const notes = [261.63, 329.63, 392.0, 523.25];
    notes.forEach((f, i) => {
      blip(sfxBus, { freq: f, type: 'triangle', dur: 1.1 - i * 0.1, vol: 0.16, at: i * 0.13, lp: 2400 });
      blip(sfxBus, { freq: f * 2, type: 'sine', dur: 0.9, vol: 0.05, at: i * 0.13 + 0.02 });
    });
    noiseBurst(sfxBus, { dur: 0.6, vol: 0.02, lp: 1200 });
  },
};

// ---------------------------------------------------------------- BABBLE
// Animal-Crossing-style speech: one pitched chirp per syllable.
let babbleTimer = null;

export function babble(text, { pitch = 1, onSyllable = null, onDone = null } = {}) {
  if (!ensureCtx()) { onDone?.(); return { duration: 0, stop() {} }; }
  stopBabble();
  const syllables = (text.match(/[aeiouyAEIOUY]+[^aeiouyAEIOUY\s]*/g) || ['a']).slice(0, 64);
  const isQuestion = /\?\s*$/.test(text);
  const step = 0.082;
  const dur = syllables.length * step;
  let i = 0;
  const tick = () => {
    if (i >= syllables.length) { babbleTimer = null; onDone?.(); return; }
    const prog = i / syllables.length;
    const syl = syllables[i];
    let f = 300 * pitch + (syl.charCodeAt(0) % 17) * 14 + Math.random() * 30;
    if (isQuestion && prog > 0.72) f *= 1 + (prog - 0.72) * 1.7;   // rising inflection
    if (!isQuestion && prog > 0.85) f *= 0.92;                      // falling cadence
    blip(voxBus, { freq: f, type: 'sawtooth', dur: 0.07, vol: 0.1, lp: 1900, slide: 40 });
    blip(voxBus, { freq: f * 1.5, type: 'triangle', dur: 0.05, vol: 0.05, lp: 2400 });
    onSyllable?.(i, syllables.length);
    i++;
    babbleTimer = setTimeout(tick, step * 1000 * (0.85 + Math.random() * 0.3));
  };
  tick();
  return { duration: dur, stop: stopBabble };
}

export function stopBabble() {
  if (babbleTimer) { clearTimeout(babbleTimer); babbleTimer = null; }
}

// ------------------------------------------------------------- SOUNDTRACK
// Standard MIDI file → note list. Handles format 0/1, running status,
// multi-track merging and tempo changes; ignores everything we don't play.
function parseMidi(buf) {
  const d = new DataView(buf);
  let p = 0;
  const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
  const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
  const u8 = () => d.getUint8(p++);
  const vlq = () => { let v = 0, b; do { b = u8(); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (u32() !== 0x4d546864) throw new Error('not a MIDI file');
  u32();                                   // header length
  u16();                                   // format
  const nTracks = u16();
  const division = u16();                  // ticks per quarter note

  const all = [];
  for (let t = 0; t < nTracks; t++) {
    if (u32() !== 0x4d54726b) throw new Error('bad track chunk');
    const end = u32() + p;
    let tick = 0, running = 0;
    while (p < end) {
      tick += vlq();
      let status = u8();
      if (status < 0x80) { p--; status = running; } else running = status;
      const type = status & 0xf0;
      if (type === 0x90 || type === 0x80) {
        const note = u8(), vel = u8();
        all.push({ tick, kind: (type === 0x90 && vel > 0) ? 'on' : 'off', note, vel });
      } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) p += 2;
      else if (type === 0xc0 || type === 0xd0) p += 1;
      else if (status === 0xff) {
        const meta = u8(), len = vlq();
        if (meta === 0x51 && len === 3) {
          all.push({ tick, kind: 'tempo', uspq: (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2) });
        }
        p += len;
      } else if (status === 0xf0 || status === 0xf7) p += vlq();
    }
    p = end;
  }

  all.sort((a, b) => a.tick - b.tick);
  let uspq = 500000, lastTick = 0, lastSec = 0;
  const open = new Map();
  const notes = [];
  for (const e of all) {
    const sec = lastSec + ((e.tick - lastTick) * uspq) / 1e6 / division;
    lastTick = e.tick; lastSec = sec;
    if (e.kind === 'tempo') uspq = e.uspq;
    else if (e.kind === 'on') open.set(e.note, { t: sec, vel: e.vel });
    else {
      const o = open.get(e.note);
      if (o) { notes.push({ t: o.t, note: e.note, vel: o.vel, dur: Math.max(0.1, sec - o.t) }); open.delete(e.note); }
    }
  }
  notes.sort((a, b) => a.t - b.t);
  const length = notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
  return { notes, length };
}

// soft felt-piano voice: triangle body + quiet octave partial, velocity-keyed
// lowpass, fast attack into a long exponential decay
function pianoNote(note, vel, at, dur, { gain = 1, detune = 0 } = {}) {
  if (!ensureCtx()) return;
  const t0 = ctx.currentTime + at;
  const f = 440 * Math.pow(2, (note - 69) / 12);
  const v = Math.min(1, vel / 127) * 0.3 * gain;
  if (v <= 0.002) return;
  const hold = Math.min(Math.max(dur, 0.25), 4);
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900 + (vel / 127) * 3000;
  const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f; o1.detune.value = detune;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2; o2.detune.value = detune;
  const g2 = ctx.createGain(); g2.gain.value = 0.3;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(v, t0 + 0.009);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0012, v * 0.12), t0 + hold);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + hold + 0.3);
  o1.connect(lp); o2.connect(g2).connect(lp); lp.connect(g).connect(musicBus);
  o1.start(t0); o2.start(t0);
  o1.stop(t0 + hold + 0.45); o2.stop(t0 + hold + 0.45);
}

// Loops the piece indefinitely and "extends" it by cycling variation passes:
// pass 0 as written, pass 1 adds a music-box octave shimmer, pass 2 doubles
// the low end an octave down — plus a soft constant echo and vinyl crackle.
class MidiPiano {
  constructor(url) {
    this.url = url;
    this.playing = false;
    this._notes = null; this._len = 0;
    this._timer = null; this._crackle = null;
    this._pass = 0; this._idx = 0; this._passStart = 0;
  }
  get bpm() { return 0; }   // legacy API shim

  async _load() {
    if (this._notes) return this._notes.length > 0;
    try {
      const buf = await (await fetch(this.url)).arrayBuffer();
      const { notes, length } = parseMidi(buf);
      this._notes = notes;
      this._len = length + 2.4;            // a breath between passes
      return notes.length > 0;
    } catch (err) {
      console.warn('soundtrack MIDI failed to load:', err);
      this._notes = [];
      return false;
    }
  }

  start() {
    if (this.playing || !ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
    this.playing = true;                   // optimistic: tray reads this now
    this._load().then((ok) => {
      if (!ok || !this.playing) { this.playing = false; return; }
      this._pass = 0; this._idx = 0;
      this._passStart = ctx.currentTime + 0.2;
      this._crackleOn();
      this._loop();
    });
  }
  stop() {
    this.playing = false;
    clearTimeout(this._timer);
    this._crackle?.stop(); this._crackle = null;
  }
  toggle() { this.playing ? this.stop() : this.start(); return this.playing; }

  _crackleOn() {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() < 0.0017 ? (Math.random() * 2 - 1) * 0.5 : (Math.random() * 2 - 1) * 0.012;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0.35;
    src.connect(f).connect(g).connect(musicBus);
    src.start();
    this._crackle = src;
  }

  _loop() {
    if (!this.playing) return;
    const horizon = ctx.currentTime + 0.7;
    while (true) {
      if (this._idx >= this._notes.length) {
        this._pass++; this._idx = 0;
        this._passStart += this._len;
      }
      const n = this._notes[this._idx];
      const at = this._passStart + n.t;
      if (at > horizon) break;
      const rel = at - ctx.currentTime;
      if (rel > -0.05) this._schedule(n, Math.max(0, rel));
      this._idx++;
    }
    this._timer = setTimeout(() => this._loop(), 200);
  }

  _schedule(n, at) {
    pianoNote(n.note, n.vel, at, n.dur);
    const variation = this._pass % 3;
    if (variation === 1) pianoNote(n.note + 12, n.vel * 0.42, at + 0.035, n.dur, { gain: 0.55 });
    if (variation === 2 && n.note < 62) pianoNote(n.note - 12, n.vel * 0.5, at + 0.012, n.dur, { gain: 0.8 });
    pianoNote(n.note, n.vel * 0.26, at + 0.45, Math.min(n.dur, 1.1), { gain: 0.5, detune: 5 }); // room echo
  }
}

export const beat = new MidiPiano('src/ode-to-sadness.mid');

// ---------------------------------------------------------------- misc
export function unlock() {            // call from a user gesture (boot click)
  const c = ensureCtx();
  if (c && c.state === 'suspended') c.resume();
}
export function setMuted(m) {
  muted = m;
  store.set('audio.muted', m);
  if (master) master.gain.linearRampToValueAtTime(m ? 0 : 0.8, ctx.currentTime + 0.05);
}
export function isMuted() { return muted; }
export function setMusicVolume(v) { if (ensureCtx()) musicBus.gain.value = v; }
