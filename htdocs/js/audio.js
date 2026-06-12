// Procedural Web Audio engine: lo-fi UI sfx, character babble, and a lo-fi
// beat sequencer. No audio assets — everything is synthesized, which keeps the
// carrd embed payload tiny and avoids licensing entirely.
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

// ---------------------------------------------------------------- LO-FI BEAT
// 8-bar swung lo-fi loop: dusty kick/snare/hat + jazz chords + vinyl crackle.
const CHORDS = [ // Fmaj7 – Em7 – Dm7 – Cmaj7 (freqs in Hz, low voicings)
  [174.61, 220.0, 261.63, 329.63],
  [164.81, 196.0, 246.94, 293.66],
  [146.83, 174.61, 220.0, 261.63],
  [130.81, 164.81, 196.0, 246.94],
];

class LofiBeat {
  constructor() { this.playing = false; this._next = 0; this._step = 0; this._timer = null; this._crackle = null; }
  get bpm() { return 84; }
  start() {
    if (!ensureCtx() || this.playing) return;
    if (ctx.state === 'suspended') ctx.resume();
    this.playing = true;
    this._step = 0;
    this._next = ctx.currentTime + 0.06;
    this._crackleOn();
    this._loop();
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
    const g = ctx.createGain(); g.gain.value = 0.5;
    src.connect(f).connect(g).connect(musicBus);
    src.start();
    this._crackle = src;
  }
  _loop() {
    if (!this.playing) return;
    const spb = 60 / this.bpm;           // seconds per beat
    const s16 = spb / 4;                 // 16th note
    while (this._next < ctx.currentTime + 0.35) {
      const st = this._step % 32;        // two bars of 16ths
      const swing = (st % 2 === 1) ? s16 * 0.32 : 0;
      const t = this._next - ctx.currentTime + swing;
      // kick on 1 and the "and" of 2 (boom-bap)
      if (st === 0 || st === 10 || st === 16 || st === 26) {
        blip(musicBus, { freq: 120, slide: -78, type: 'sine', dur: 0.22, vol: 0.5, at: t });
      }
      if (st === 8 || st === 24) noiseBurst(musicBus, { dur: 0.12, vol: 0.2, at: t, lp: 2600, hp: 700 }); // snare
      if (st % 4 === 2) noiseBurst(musicBus, { dur: 0.03, vol: 0.07, at: t, lp: 9000, hp: 5000 });        // hat
      // chord stab each bar, held; progression advances per bar
      if (st % 16 === 0) {
        const chord = CHORDS[Math.floor(this._step / 16) % CHORDS.length];
        for (const f of chord) {
          blip(musicBus, { freq: f, type: 'triangle', dur: spb * 3.4, vol: 0.085, at: t, lp: 1300 });
          blip(musicBus, { freq: f * 1.004, type: 'sawtooth', dur: spb * 3.4, vol: 0.022, at: t, lp: 900 });
        }
        // sparse melody note
        const mel = chord[(Math.floor(this._step / 16) * 7 + 5) % 4] * 2;
        blip(musicBus, { freq: mel, type: 'sine', dur: spb * 1.2, vol: 0.07, at: t + s16 * 6 });
      }
      this._next += s16;
      this._step++;
    }
    this._timer = setTimeout(() => this._loop(), 90);
  }
}

export const beat = new LofiBeat();

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
