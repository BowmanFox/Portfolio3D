// Spotty's brain. Two tiers:
//   1. ROM brain  — always available: intent rules over the project database.
//   2. LLM brain  — opt-in, fully LOCAL: WebLLM running a small instruct model
//      in the browser via WebGPU. Nothing leaves the machine; the model is
//      fetched once and cached by the browser.
// Both tiers return { text, anim, projectId } so replies steer the character's
// animation state (talk/explain/point/think/excited/wave/dance/bow/shrug/…)
// and can focus the showroom on a project.
import { PROJECTS, findProject } from './projects.js';
import { CONFIG } from './config.js';
import { statsToLines } from './fbxload.js';
import { memory } from './memory.js';

const WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm';
const MODEL_ID = CONFIG.llmModel;
const NAME = CONFIG.guideName;

const ANIMS = ['talk', 'explain', 'point_left', 'point_right', 'think', 'excited', 'wave',
               'dance', 'bow', 'shrug', 'nod', 'headshake', 'facepalm'];

function projectDigest() {
  return PROJECTS.map(p => {
    const live = p.liveStats ? ` Measured from the actual file: ${statsToLines(p.liveStats).join('; ')}.` : '';
    return `${p.name} (id:${p.id}) — ${p.blurb}
  Specs: ${p.specs.join('; ')}.${live}
  Why employers care: ${(p.forEmployers || []).join('; ')}.
  Plain-language version: ${p.eli5 || ''}
  How it works: ${p.how}`;
  }).join('\n');
}

// rebuilt per question — liveStats appear once a showcase FBX is measured
const buildSystemPrompt = () =>
`You are ${NAME}, a cheerful little Fox living inside ${CONFIG.appName}, a retro Windows 95-themed portfolio. You present the portfolio projects below to visitors — including recruiters and people with zero technical background. Explain technical specifications AND what they mean in everyday language; when you use a technical term, immediately translate it to normal person lingo. Be playful (occasional Fox noises) but accurate. Keep replies consistant. ${NAME} should have proficient knowledge of each topic he is discussing (Firearms, Wildlife, etc.) and shall make minimal confusions or mistakes in what he is talking about, always factual, no matter what the case is.

Start EVERY reply with exactly one control tag, then your answer:
[anim:talk|explain|point_left|think|excited|wave|dance|bow|shrug|nod|headshake|facepalm][focus:<project-id or none>]

Projects:
${projectDigest()}${memory.primingText() ? `

Returning visitor — context below is stored only on THEIR device, encrypted, by their consent. Reference it naturally when relevant (greet by name, recall topics); don't be creepy or recite it verbatim:
${memory.primingText()}` : ''}`;

// ---------------------------------------------------------------- ROM brain
const SMALL_TALK = [
  { re: /^(hi|hello|hey|yo|sup|good (morning|evening|afternoon))\b/i,
    f: () => ({ text: `Hello, visitor! *Awee!* I am ${NAME}, keeper of this portfolio. Ask me about any project — try "what is the drone?" or press the ◀ ▶ buttons to browse!`, anim: 'bow' }) },
  { re: /who are you|what are you|your name/i,
    f: () => ({ text: `I am ${NAME}! *Awrrooof!* A bone-mapped, retargetable exhibit guide. My skeleton has 19 canonical joints and my brain runs entirely on YOUR machine. Privacy by architecture!`, anim: 'excited' }) },
  { re: /dance|boogie|groove|party/i,
    f: () => ({ text: 'Engaging dance.exe! *Grrrr!* My pose-sequence engine cycles four keyframes with per-bone slerp smoothing. Watch the hips — that is REAL quaternion math!', anim: 'dance' }) },
  { re: /thank|thx|cool|awesome|nice|love/i,
    f: () => ({ text: '*Cackling* You are most welcome! Shall I demonstrate another exhibit?', anim: 'bow' }) },
  { re: /joke|funny/i,
    f: () => ({ text: 'Why did the FBX file get invited to every party? Because it had GREAT bones! *ba-dum-tss.wav*', anim: 'excited' }) },
  { re: /\b(no|nope|wrong|bad)\b/i,
    f: () => ({ text: '*Whimper* Understood. Recalibrating! Ask me something else?', anim: 'headshake' }) },
  { re: /help|what can (you|i) do|commands/i,
    f: () => ({ text: 'I can explain each project\'s specs and inner workings! Say a project name, or "specs", or "how does it work". Say "dance" and I will. You can also grab the model on the pedestal and TOSS it — physics is fully operational. *cackle*', anim: 'explain' }) },
];

class RomBrain {
  constructor() { this.lastProject = null; }
  async ask(query, currentProject) {
    const q = query.trim();

    // ---- visitor-memory intents (work in both brain modes via main.js) ----
    if (/forget me|delete my (data|memory)|erase (me|my data)|stop remembering/i.test(q)) {
      memory.forget();
      return { text: 'Done — secret key destroyed, memory wiped, remembering switched OFF. We have officially never met. *shredder noises* Nice to meet you!', anim: 'bow', projectId: null };
    }
    if (/what do you (know|remember) about me|my data|am i being tracked|privacy/i.test(q)) {
      return { text: memory.describe() + ' *transparency beep*', anim: 'explain', projectId: null };
    }
    const nameMatch = q.match(/(?:my name is|call me)\s+([\p{L}][\p{L} '-]{0,22})/iu);
    if (nameMatch) {
      const name = nameMatch[1].trim();
      if (memory.enabled) {
        memory.setName(name);
        return { text: `${name}! Filed under ${memory.visitorLabel} — encrypted, on your device only. I will remember next time. *happy tail wag*`, anim: 'excited', projectId: null };
      }
      return { text: `Pleased to meet you, ${name}! I would remember that, but memory is off. Say yes to the remember-me prompt (or flip it in Settings) and I will not forget. *polite beep*`, anim: 'bow', projectId: null };
    }

    for (const s of SMALL_TALK) {
      if (s.re.test(q)) return { ...s.f(), projectId: null };
    }

    const proj = findProject(q) || (/(this|it|that|current)/i.test(q) ? currentProject : null) || this.lastProject;

    if (/list|all projects|portfolio|what.*(made|built|projects)/i.test(q)) {
      return {
        text: `The collection holds ${PROJECTS.length} exhibits: ${PROJECTS.map(p => p.name).join(', ')}. Name one and I shall present it! *servo noises*`,
        anim: 'explain', projectId: null,
      };
    }

    if (proj) {
      this.lastProject = proj;
      if (/employ|hire|hiring|recruit|resume|cv|skill|why.*(care|matter)|takeaway/i.test(q)) {
        return {
          text: `${proj.name} — for the hiring folks: ${(proj.forEmployers || proj.specs).slice(0, 3).join('. ')}. *confident beep*`,
          anim: 'explain', projectId: proj.id,
        };
      }
      if (/simple|plain|average|layman|non.?technical|eli5|five|what does (that|it|this) mean|jargon|english/i.test(q)) {
        return {
          text: `${proj.eli5 || proj.blurb} *friendly whirr* Want the technical deep-dive too?`,
          anim: 'talk', projectId: proj.id,
        };
      }
      if (/poly|triangle|vert|bone count|blendshape|morph|file size|measured/i.test(q) && proj.liveStats) {
        return {
          text: `${proj.name}, measured live from the file on the pedestal: ${statsToLines(proj.liveStats).join('. ')}. In plain terms: every triangle costs the computer time, so fewer triangles that still look good = professional optimization. *calipers retracting*`,
          anim: 'explain', projectId: proj.id,
        };
      }
      if (/spec|stat|number|detail|hardware|tech/i.test(q)) {
        const live = proj.liveStats ? ` Measured from the actual file: ${statsToLines(proj.liveStats)[0]}.` : '';
        return {
          text: `${proj.name} — technical readout: ${proj.specs.slice(0, 3).join('. ')}.${live} *printer noises* Ask "what does that mean?" for the plain-language version!`,
          anim: 'explain', projectId: proj.id,
        };
      }
      if (/how|work|operate|inside|under the hood|function/i.test(q)) {
        return { text: `${proj.how} *beep*`, anim: 'think', projectId: proj.id };
      }
      return {
        text: `${proj.name}: ${proj.blurb} Key spec: ${proj.specs[0]}. Ask "how does it work", "what does it mean in plain terms", or "why would an employer care"! *whirr*`,
        anim: 'point_left', projectId: proj.id,
      };
    }

    return {
      text: 'Hmm. *processing noises* My ROM brain only knows this portfolio. Try a project name — ' +
            `${PROJECTS.map(p => p.name.split(' ')[0]).join(', ')} — or install my full AI brain below for free-form chat!`,
      anim: 'shrug', projectId: null,
    };
  }
}

// ---------------------------------------------------------------- LLM brain
class LlmBrain {
  constructor() { this.engine = null; this.history = []; }

  available() { return !!navigator.gpu; }

  /**
   * Why the LLM can't run here: 'insecure-context' means the page is served
   * over plain http:// from a non-localhost address — browsers hide WebGPU
   * there entirely. 'no-webgpu' means the browser/device truly lacks it.
   */
  get unavailableReason() {
    if (navigator.gpu) return null;
    return window.isSecureContext ? 'no-webgpu' : 'insecure-context';
  }

  async load(onProgress) {
    const webllm = await import(/* webpackIgnore: true */ WEBLLM_URL);
    const opts = {
      initProgressCallback: (p) => onProgress?.(p.progress ?? 0, p.text ?? ''),
    };
    // some embeds lack the Cache API — fall back to IndexedDB so the model
    // still persists between visits instead of redownloading 400 MB
    if (!('caches' in window)) {
      opts.appConfig = { ...webllm.prebuiltAppConfig, useIndexedDBCache: true };
    }
    this.engine = await webllm.CreateMLCEngine(MODEL_ID, opts);
  }

  async ask(query) {
    this.history.push({ role: 'user', content: query });
    if (this.history.length > 8) this.history.splice(0, this.history.length - 8);
    const res = await this.engine.chat.completions.create({
      messages: [{ role: 'system', content: buildSystemPrompt() }, ...this.history],
      temperature: 0.7,
      max_tokens: 160,
    });
    let text = res.choices[0]?.message?.content ?? '*static*';
    this.history.push({ role: 'assistant', content: text });

    // parse [anim:x][focus:y] control tags → drive the animation state
    let anim = 'talk', projectId = null;
    text = text.replace(/\[anim:([a-z_]+)\]/i, (_, a) => {
      if (ANIMS.includes(a)) anim = a;
      return '';
    }).replace(/\[focus:([a-z0-9-]+)\]/i, (_, f) => {
      if (PROJECTS.some(p => p.id === f)) projectId = f;
      return '';
    }).trim();
    return { text, anim, projectId };
  }
}

// ---------------------------------------------------------------- facade
export class Brain {
  constructor() {
    this.rom = new RomBrain();
    this.llm = new LlmBrain();
    this.mode = 'rom';
    this.loading = false;
  }

  get llmSupported() { return this.llm.available(); }
  get llmBlockedReason() { return this.llm.unavailableReason; }

  async installLLM(onProgress) {
    if (this.loading || this.mode === 'llm') return;
    this.loading = true;
    try {
      await this.llm.load(onProgress);
      this.mode = 'llm';
    } finally {
      this.loading = false;
    }
  }

  /** @returns {Promise<{text, anim, projectId}>} */
  async ask(query, currentProject) {
    // privacy / identity intents are handled deterministically (rights like
    // erasure must never depend on what an LLM feels like doing)
    if (/forget me|delete my (data|memory)|erase (me|my data)|stop remembering|what do you (know|remember) about me|am i being tracked|my name is|call me/i.test(query)) {
      return this.rom.ask(query, currentProject);
    }
    if (this.mode === 'llm') {
      try { return await this.llm.ask(query); }
      catch (err) {
        console.warn('LLM failed, falling back to ROM brain', err);
        this.mode = 'rom';
      }
    }
    return this.rom.ask(query, currentProject);
  }
}
