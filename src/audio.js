from pathlib import Path
import re

src = Path("/mnt/data/sadness-piano.js").read_text()

# Extract the full event table from the original file.
m = re.search(r"const events = \[(.*?)\]\.sort", src, re.S)
events = m.group(1)

module_text = f"""// sadness-piano.js
// Refactored for audio.js-style integration.
// - ES module
// - No DOM/UI injection
// - No globals
// - Exported controller object
// - Original timing, BPM, and event map preserved

let ctx = null;
let master, musicBus;

function ensureCtx() {{
  if (ctx) return ctx;

  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;

  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = 0.82;

  musicBus = ctx.createGain();
  musicBus.gain.value = 1.0;

  musicBus.connect(master);
  master.connect(ctx.destination);

  return ctx;
}}

function noteToFreq(note) {{
  const map = {{
    C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,
    F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,
    A:9,'A#':10,Bb:10,B:11
  }};

  const oct = parseInt(note.slice(-1), 10);
  const semi = map[note.slice(0, -1)];
  return 440 * Math.pow(2, (semi - 9 + (oct - 4) * 12) / 12);
}}

function pianoNote(bus, freq, {{
  duration = 2.8,
  velocity = 0.7,
  at = 0,
  melody = false,
  bass = false
}} = {{}}) {{
  if (!ensureCtx()) return;

  const t0 = ctx.currentTime + at;

  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  const o3 = ctx.createOscillator();

  o1.type = 'sawtooth';
  o2.type = 'sawtooth';
  o3.type = 'sine';

  o1.frequency.value = freq;
  o2.frequency.value = freq * 1.0027;
  o3.frequency.value = freq * 2.004;

  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = bass ? 920 : (melody ? 2250 : 1580);

  const gain = ctx.createGain();
  const peak = velocity * (bass ? 0.78 : 0.95);

  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.0035);

  const relStart = t0 + duration;
  gain.gain.setValueAtTime(peak * 0.9, relStart);
  gain.gain.exponentialRampToValueAtTime(0.0005, relStart + duration * 0.9);

  o1.connect(filt);
  o2.connect(filt);
  o3.connect(filt);
  filt.connect(gain).connect(bus);

  o1.start(t0);
  o2.start(t0);
  o3.start(t0);

  const stopAt = relStart + duration + 1;
  o1.stop(stopAt);
  o2.stop(stopAt);
  o3.stop(stopAt);
}}

const BPM = 52;
const SPB = 60 / BPM;
const TOTAL_BEATS = 24;

const EVENTS = [{events}
].sort((a, b) => a.beat - b.beat);

class SadnessPiano {{
  constructor() {{
    this.playing = false;
    this._timeout = null;
  }}

  get bpm() {{
    return BPM;
  }}

  start() {{
    if (!ensureCtx() || this.playing) return;

    if (ctx.state === 'suspended') ctx.resume();

    this.playing = true;

    for (const ev of EVENTS) {{
      pianoNote(musicBus, ev.freq, {{
        duration: ev.durBeats * SPB,
        velocity: ev.vel,
        at: ev.beat * SPB,
        melody: !!ev.melody,
        bass: !!ev.bass
      }});
    }}

    clearTimeout(this._timeout);
    this._timeout = setTimeout(() => {{
      this.playing = false;
    }}, (TOTAL_BEATS + 4) * SPB * 1000);
  }}

  stop() {{
    this.playing = false;
    clearTimeout(this._timeout);
  }}

  toggle() {{
    this.playing ? this.stop() : this.start();
    return this.playing;
  }}
}}

export const sadness = new SadnessPiano();

export function unlock() {{
  const c = ensureCtx();
  if (c && c.state === 'suspended') c.resume();
}}

export function setMusicVolume(v) {{
  if (ensureCtx()) musicBus.gain.value = v;
}}

export function setVolume(v) {{
  if (ensureCtx()) master.gain.value = Math.max(0, Math.min(1, v));
}}
"""

out = "/mnt/data/sadness-piano-final-module.js"
Path(out).write_text(module_text)
print(out)
