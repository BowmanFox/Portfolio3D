// BIOS boot sequence: staged POST lines with CRT fade/flicker (see boot.css),
// an animated memory count, then "press any key" → resolves once dismissed.
// The dismissing gesture doubles as the user gesture that unlocks WebAudio.
import { unlock, sfx } from './audio.js';

const LINES = [
  { t: 'Main Processor   : VISITOR(tm) CPU at 3.5 THz', d: 1.3 },
  { t: 'Memory Test      : ', d: 1.55, mem: true },
  { t: '', d: 2.6 },
  { t: 'Detecting IDE drives ...', d: 2.7 },
  { t: '  Primary Master : BOWMAN-PORTFOLIO v5.1 <span class="ok">[OK]</span>', d: 3.0 },
  { t: '  Primary Slave  : FBX-CHARACTER "SPOTTY" <span class="ok">[OK]</span>', d: 3.25 },
  { t: '  Secondary      : LOCAL-LLM COPROCESSOR <span class="val">[STANDBY]</span>', d: 3.5 },
  { t: 'Initializing physics solver .............. <span class="ok">DONE</span>', d: 3.75 },
  { t: 'Calibrating real-time lighting rig ....... <span class="ok">DONE</span>', d: 3.95 },
];

export function runBoot() {
  return new Promise((resolve) => {
    const boot = document.getElementById('boot');
    const linesEl = document.getElementById('bios-lines');
    const prompt = document.getElementById('bios-prompt');
    let finished = false;
    let ready = false;

    if (new URLSearchParams(location.search).has('noboot')) {
      boot.remove();
      resolve();
      return;
    }

    for (const line of LINES) {
      const el = document.createElement('div');
      el.className = 'bline bios-fade';
      el.style.setProperty('--d', line.d + 's');
      el.innerHTML = line.t || '&nbsp;';
      linesEl.appendChild(el);
      if (line.mem) {
        const span = document.createElement('span');
        span.className = 'val';
        el.appendChild(span);
        const total = 65536, t0 = performance.now() + line.d * 1000;
        const count = () => {
          if (finished) return;
          const k = Math.min(total, Math.max(0, Math.floor((performance.now() - t0) / 1.6) * 64));
          span.textContent = `${k} KB OK`;
          if (k < total) requestAnimationFrame(count);
        };
        requestAnimationFrame(count);
      }
    }

    const showPrompt = setTimeout(() => { prompt.hidden = false; ready = true; }, 4600);

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(showPrompt);
      unlock();                       // user gesture → AudioContext allowed
      boot.classList.add('off');      // CRT power-off collapse
      setTimeout(() => {
        boot.remove();
        sfx.startup();
        resolve();
      }, 360);
    };

    // before the prompt appears the first input just skips ahead to it
    const onInput = (e) => {
      if (e.type === 'keydown' && e.key === 'F12') return; // leave devtools alone
      e.preventDefault?.();
      if (!ready) {
        ready = true;
        clearTimeout(showPrompt);
        prompt.hidden = false;
        unlock();
        return;
      }
      window.removeEventListener('keydown', onInput, true);
      finish();
    };
    boot.addEventListener('pointerdown', onInput);
    window.addEventListener('keydown', onInput, true);

    // auto-boot after a while so an embed never sits on the BIOS forever
    setTimeout(() => finish(), 11000);
  });
}
