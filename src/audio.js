// sadness-piano.js
// Clean acoustic piano recreation of "Sadness" by Nikolai Bowman
// Non-lofi • Slow, heavy, and emotionally depressing
// Drop into any HTML page: <script src="sadness-piano.js"></script>
// Or include in your project. Creates its own elegant dark UI automatically.

(() => {
  let ctx = null;
  let master = null;
  let playing = false;
  let startTime = 0;
  let eventIndex = 0;
  let rafId = null;

  // UI elements (injected)
  let ui = null;
  let btn = null;
  let progressEl = null;
  let infoEl = null;

  const BPM = 52;                    // slower than original 59 for more weight
  const SPB = 60 / BPM;
  const TOTAL_BEATS = 24;            // 8 measures × 3 beats

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      console.error('Web Audio API not supported in this browser');
      return null;
    }
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.82;
    master.connect(ctx.destination);
    return ctx;
  }

  function noteToFreq(note) {
    const map = {
      C:0, 'C#':1, Db:1, D:2, 'D#':3, Eb:3, E:4,
      F:5, 'F#':6, Gb:6, G:7, 'G#':8, Ab:8,
      A:9, 'A#':10, Bb:10, B:11
    };
    const oct = parseInt(note.slice(-1), 10);
    const semi = map[note.slice(0, -1)];
    if (semi === undefined) return 440;
    return 440 * Math.pow(2, (semi - 9 + (oct - 4) * 12) / 12);
  }

  // Rich, warm acoustic piano voice — NO lo-fi crush, NO vinyl, NO heavy filtering
  function playNote(freq, {
    duration = 2.8,
    velocity = 0.7,
    time = 0,
    melody = false,
    bass = false
  } = {}) {
    if (!ctx) return;
    const t0 = ctx.currentTime + Math.max(0, time);

    // Gentle hammer attack (short filtered noise burst)
    const atkDur = 0.011;
    try {
      const nBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * atkDur), ctx.sampleRate);
      const nd = nBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) {
        nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length) * 0.9;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = nBuf;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = freq * (bass ? 2.8 : 3.8);
      nf.Q.value = 2.4;
      const ng = ctx.createGain();
      ng.gain.value = velocity * (bass ? 0.32 : 0.48);
      ng.gain.linearRampToValueAtTime(0.0001, t0 + atkDur * 5);
      noise.connect(nf).connect(ng).connect(master);
      noise.start(t0);
    } catch (e) {}

    // Core tone: 3 oscillators for rich, singing piano body (clean & warm)
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = freq;

    const o2 = ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = freq * 1.0027;   // very slight detune = natural chorus

    const o3 = ctx.createOscillator();
    o3.type = 'sine';
    o3.frequency.value = freq * 2.004;

    // Warm lowpass (intimate room tone, not lo-fi)
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = bass ? 920 : (melody ? 2250 : 1580);
    filt.Q.value = bass ? 0.55 : 0.9;

    // Natural piano envelope — fast attack, long singing decay + release
    const g = ctx.createGain();
    g.gain.value = 0;
    const peak = velocity * (bass ? 0.78 : 0.95);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.0035);

    const relStart = t0 + duration;
    g.gain.setValueAtTime(peak * 0.9, relStart);
    g.gain.exponentialRampToValueAtTime(0.0005, relStart + duration * 0.9);

    // Emotional "sigh" — very subtle downward pitch drift on long melody notes
    // (makes it feel heavier and more human/depressing)
    if (melody && duration > 1.3) {
      const driftStart = t0 + duration * 0.38;
      const driftEnd = relStart + duration * 0.48;
      o1.frequency.setValueAtTime(freq, driftStart);
      o1.frequency.linearRampToValueAtTime(freq * 0.983, driftEnd);
      o2.frequency.setValueAtTime(freq * 1.0027, driftStart);
      o2.frequency.linearRampToValueAtTime(freq * 1.0027 * 0.983, driftEnd);
    }

    // Connect everything
    o1.connect(filt);
    o2.connect(filt);
    o3.connect(filt);
    filt.connect(g);
    g.connect(master);

    o1.start(t0);
    o2.start(t0);
    o3.start(t0);

    const stopAt = relStart + duration * 1.0 + 1.0;
    o1.stop(stopAt);
    o2.stop(stopAt);
    o3.stop(stopAt);
  }

  // Score — arranged from the visible sheet music
  // Chords: Am | G | G7→Am→F | G7→Am | E7 | G | G (C bass) | G (D bass)
  // Long sustains, sparse melody, heavy bass movement in final bars
  const events = [
    // === m1 Am (pink highlighted) — long high A4
    {beat: 0,    freq: noteToFreq('A2'),  durBeats: 3.5, vel: 0.61, bass: true},
    {beat: 0.07, freq: noteToFreq('C3'),  durBeats: 3.1, vel: 0.37},
    {beat: 0.14, freq: noteToFreq('E3'),  durBeats: 3.1, vel: 0.35},
    {beat: 0.21, freq: noteToFreq('A3'),  durBeats: 3.1, vel: 0.31},
    {beat: 0,    freq: noteToFreq('A4'),  durBeats: 3.0, vel: 0.87, melody: true},
    {beat: 2.55, freq: noteToFreq('G4'),  durBeats: 0.65, vel: 0.52, melody: true},

    // === m2 G
    {beat: 3,    freq: noteToFreq('G2'),  durBeats: 3.4, vel: 0.57, bass: true},
    {beat: 3.08, freq: noteToFreq('B2'),  durBeats: 2.8, vel: 0.31},
    {beat: 3.16, freq: noteToFreq('D3'),  durBeats: 2.8, vel: 0.31},
    {beat: 3,    freq: noteToFreq('B4'),  durBeats: 1.05, vel: 0.71, melody: true},
    {beat: 4,    freq: noteToFreq('A4'),  durBeats: 1.0,  vel: 0.66, melody: true},
    {beat: 5,    freq: noteToFreq('G4'),  durBeats: 1.35, vel: 0.60, melody: true},

    // === m3 G7 (b6) → Am (b7) → F (b8)
    {beat: 6,    freq: noteToFreq('G2'),  durBeats: 1.2, vel: 0.51, bass: true},
    {beat: 6.07, freq: noteToFreq('B2'),  durBeats: 1.05, vel: 0.27},
    {beat: 6.14, freq: noteToFreq('D3'),  durBeats: 1.05, vel: 0.27},
    {beat: 6.21, freq: noteToFreq('F3'),  durBeats: 1.05, vel: 0.29},
    {beat: 6,    freq: noteToFreq('D5'),  durBeats: 0.95, vel: 0.64, melody: true},

    {beat: 7,    freq: noteToFreq('A2'),  durBeats: 1.2, vel: 0.47, bass: true},
    {beat: 7.07, freq: noteToFreq('C3'),  durBeats: 1.05, vel: 0.25},
    {beat: 7.14, freq: noteToFreq('E3'),  durBeats: 1.05, vel: 0.25},
    {beat: 7,    freq: noteToFreq('C5'),  durBeats: 0.95, vel: 0.59, melody: true},

    {beat: 8,    freq: noteToFreq('F2'),  durBeats: 1.2, vel: 0.47, bass: true},
    {beat: 8.07, freq: noteToFreq('A2'),  durBeats: 1.05, vel: 0.25},
    {beat: 8.14, freq: noteToFreq('C3'),  durBeats: 1.05, vel: 0.25},
    {beat: 8,    freq: noteToFreq('A4'),  durBeats: 0.95, vel: 0.54, melody: true},

    // === m4 G7 → Am
    {beat: 9,    freq: noteToFreq('G2'),  durBeats: 1.65, vel: 0.49, bass: true},
    {beat: 9.09, freq: noteToFreq('B2'),  durBeats: 1.45, vel: 0.26},
    {beat: 9.18, freq: noteToFreq('D3'),  durBeats: 1.45, vel: 0.26},
    {beat: 9.27, freq: noteToFreq('F3'),  durBeats: 1.45, vel: 0.28},
    {beat: 9,    freq: noteToFreq('B4'),  durBeats: 1.25, vel: 0.57, melody: true},

    {beat: 10,   freq: noteToFreq('A2'),  durBeats: 2.35, vel: 0.43, bass: true},
    {beat: 10.09, freq: noteToFreq('C3'), durBeats: 2.05, vel: 0.23},
    {beat: 10.18, freq: noteToFreq('E3'), durBeats: 2.05, vel: 0.23},
    {beat: 10,   freq: noteToFreq('A4'),  durBeats: 2.15, vel: 0.51, melody: true},

    // === m5 E7 (dominant tension)
    {beat: 12,   freq: noteToFreq('E2'),  durBeats: 3.5, vel: 0.51, bass: true},
    {beat: 12.08, freq: noteToFreq('G#2'),durBeats: 3.1, vel: 0.27},
    {beat: 12.16, freq: noteToFreq('B2'), durBeats: 3.1, vel: 0.27},
    {beat: 12.24, freq: noteToFreq('D3'), durBeats: 3.1, vel: 0.27},
    {beat: 12,   freq: noteToFreq('B4'),  durBeats: 1.55, vel: 0.59, melody: true},
    {beat: 13.55, freq: noteToFreq('G#4'),durBeats: 1.55, vel: 0.54, melody: true},

    // === m6 G
    {beat: 15,   freq: noteToFreq('G2'),  durBeats: 3.5, vel: 0.47, bass: true},
    {beat: 15.08, freq: noteToFreq('B2'), durBeats: 2.9, vel: 0.23},
    {beat: 15.16, freq: noteToFreq('D3'), durBeats: 2.9, vel: 0.23},
    {beat: 15,   freq: noteToFreq('D5'),  durBeats: 3.1, vel: 0.47, melody: true},

    // === m7 G (bass moves C → C → E as visible in score)
    {beat: 18,   freq: noteToFreq('C3'),  durBeats: 1.65, vel: 0.41, bass: true},
    {beat: 18.6, freq: noteToFreq('C3'),  durBeats: 1.55, vel: 0.37, bass: true},
    {beat: 19.6, freq: noteToFreq('E3'),  durBeats: 1.55, vel: 0.37, bass: true},
    {beat: 18,   freq: noteToFreq('B4'),  durBeats: 3.3, vel: 0.41, melody: true},

    // === m8 G (bass D → D → E)
    {beat: 21,   freq: noteToFreq('D3'),  durBeats: 1.65, vel: 0.39, bass: true},
    {beat: 21.6, freq: noteToFreq('D3'),  durBeats: 1.55, vel: 0.35, bass: true},
    {beat: 22.6, freq: noteToFreq('E3'),  durBeats: 1.55, vel: 0.35, bass: true},
    {beat: 21,   freq: noteToFreq('G4'),  durBeats: 2.9, vel: 0.37, melody: true},

    // final soft A hint (resolution that never quite arrives)
    {beat: 23.1, freq: noteToFreq('A4'),  durBeats: 2.3, vel: 0.21, melody: true},
  ].sort((a, b) => a.beat - b.beat);

  function scheduleLoop() {
    if (!playing || !ctx) return;

    const nowBeat = (ctx.currentTime - startTime) / SPB;

    while (eventIndex < events.length) {
      const ev = events[eventIndex];
      if (ev.beat <= nowBeat + 2.9) {
        const t = Math.max(0, (startTime + ev.beat * SPB) - ctx.currentTime);
        playNote(ev.freq, {
          duration: ev.durBeats * SPB,
          velocity: ev.vel,
          time: t,
          melody: !!ev.melody,
          bass: !!ev.bass
        });
        eventIndex++;
      } else {
        break;
      }
    }

    if (eventIndex >= events.length && nowBeat > TOTAL_BEATS + 2) {
      stop();
      return;
    }

    setTimeout(scheduleLoop, 65);
  }

  function start() {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});

    if (playing) return;

    playing = true;
    startTime = c.currentTime;
    eventIndex = 0;

    if (btn) {
      btn.innerHTML = '⏹  Stop';
      btn.style.background = '#2a1f1f';
      btn.style.borderColor = '#5a3a3a';
    }
    if (infoEl) infoEl.textContent = 'Playing • slow & heavy • A minor';

    scheduleLoop();
    if (progressEl) updateProgress();
  }

  function stop() {
    playing = false;
    if (btn) {
      btn.innerHTML = '▶  Play';
      btn.style.background = '#1f252f';
      btn.style.borderColor = '#3a4252';
    }
    if (infoEl) infoEl.textContent = 'Finished • Press play or hit SPACE to replay';
    if (progressEl) progressEl.style.width = '100%';

    setTimeout(() => {
      if (!playing && progressEl) progressEl.style.width = '0%';
      if (infoEl && !playing) infoEl.textContent = 'Press play to hear the piece';
    }, 1400);
  }

  function updateProgress() {
    if (!playing || !progressEl || !ctx) return;
    const nowBeat = (ctx.currentTime - startTime) / SPB;
    const pct = Math.min(100, Math.max(0, (nowBeat / TOTAL_BEATS) * 100));
    progressEl.style.width = pct + '%';

    if (playing) {
      rafId = requestAnimationFrame(updateProgress);
    }
  }

  // Inject elegant dark UI (depressing / elegant aesthetic)
  function injectUI() {
    if (document.getElementById('sadness-ui')) return;

    ui = document.createElement('div');
    ui.id = 'sadness-ui';
    ui.style.cssText = `
      position: fixed;
      bottom: 28px;
      left: 50%;
      transform: translateX(-50%);
      background: #0c0e14;
      border: 1px solid #252a36;
      border-radius: 18px;
      padding: 26px 32px 22px;
      box-shadow: 0 12px 50px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.03);
      font-family: system-ui, -apple-system, "Segoe UI", Georgia, serif;
      color: #c8d0e0;
      min-width: 340px;
      z-index: 2147483647;
      text-align: center;
      user-select: none;
    `;

    ui.innerHTML = `
      <div style="margin-bottom: 6px;">
        <div style="font-size: 32px; font-weight: 600; letter-spacing: -0.025em; color: #d4dbe6; line-height: 1;">Sadness</div>
        <div style="font-size: 15.5px; color: #7b8799; font-style: italic; margin-top: -3px;">Nikolai Bowman</div>
      </div>

      <div style="font-size: 11.5px; color: #555e70; margin-bottom: 16px; letter-spacing: 1.5px; font-weight: 500;">
        ♩ = 52 &nbsp;•&nbsp; 3/4 &nbsp;•&nbsp; A minor &nbsp;•&nbsp; clean piano
      </div>

      <button id="sadness-play-btn" style="
        background: #1f252f;
        color: #d4dbe6;
        border: 1px solid #3a4252;
        border-radius: 9999px;
        padding: 11px 38px;
        font-size: 15px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.1s cubic-bezier(0.23, 1, 0.32, 1);
        outline: none;
        min-width: 148px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      ">▶  Play</button>

      <div style="margin: 18px auto 0; width: 100%; max-width: 268px; height: 3.5px; background: #1a1f29; border-radius: 999px; overflow: hidden; box-shadow: inset 0 1px 2px rgba(0,0,0,0.4);">
        <div id="sadness-progress" style="height: 100%; width: 0%; background: linear-gradient(to right, #6b7a8f, #8a96a8); transition: width 0.06s linear; box-shadow: 0 0 6px rgba(138,150,168,0.4);"></div>
      </div>

      <div id="sadness-info" style="margin-top: 11px; font-size: 12.2px; color: #5f6a7d; min-height: 18px;">
        Press play to hear the piece
      </div>
    `;

    document.body.appendChild(ui);

    btn = document.getElementById('sadness-play-btn');
    progressEl = document.getElementById('sadness-progress');
    infoEl = document.getElementById('sadness-info');

    btn.onclick = () => {
      if (!playing) {
        start();
      } else {
        stop();
      }
    };

    // Keyboard controls (Space or K to toggle, R to restart)
    document.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key.toLowerCase() === 'k') && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        if (!playing) start(); else stop();
      }
      if (e.key.toLowerCase() === 'r' && !playing) {
        stop();
        setTimeout(() => start(), 90);
      }
    });

    // Subtle hover feedback
    btn.onmouseenter = () => {
      if (!playing) btn.style.borderColor = '#4a5568';
    };
    btn.onmouseleave = () => {
      if (!playing) btn.style.borderColor = '#3a4252';
    };

    // Allow clicking the whole card to toggle (nice touch)
    ui.onclick = (e) => {
      if (e.target === ui || e.target.closest('div[style*="font-size: 32px"]')) {
        if (!playing) start(); else stop();
      }
    };

    console.log('%c[Sadness] Non-lofi depressing piano player ready — click Play or press SPACE', 'color:#4a5568');
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectUI);
  } else {
    injectUI();
  }

  // Public API (in case you want to control it programmatically)
  window.Sadness = {
    play: () => start(),
    stop: () => stop(),
    isPlaying: () => playing,
    setVolume: (v) => {
      if (master) master.gain.value = Math.max(0.05, Math.min(1, v));
    },
    getBPM: () => BPM
  };
})();