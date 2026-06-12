// Visitor memory — Spotty remembers returning visitors WITHOUT identifying
// them. Privacy model (GDPR / ePrivacy / CCPA aligned):
//
//   · 100% local: every byte lives in this browser's storage. There is no
//     server, no telemetry, no analytics — nothing is transmitted, ever.
//   · No fingerprinting: identity is a random 256-bit secret generated on
//     this device (crypto.getRandomValues), not derived from the browser,
//     hardware, IP or anything traceable. Clearing site data destroys it.
//   · Opt-in: nothing is stored until the visitor explicitly says yes
//     (ePrivacy consent for non-essential device storage).
//   · Encrypted at rest: the memory blob is AES-GCM-256 ciphertext, keyed
//     via HKDF from the local secret; the visitor label is a SHA-256 hash.
//     (Honest caveat: key and blob share the same device — this guards
//     against casual inspection and storage-scraping scripts, not a
//     determined local attacker. Nothing stronger is possible serverless.)
//   · Data minimization: a name (only if offered), visit count, last-seen
//     date, up to 4 project topics and the last 6 trimmed exchanges.
//   · Visitor rights: "what do you remember about me" recites everything
//     (access); "forget me" or the Settings button erases it all (erasure).
import { store } from './store.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let key = null;          // AES-GCM CryptoKey (derived, non-extractable)
let data = null;         // decrypted memory object
let visitorHash = '';    // short SHA-256 tag, display only
let lastSeenBefore = null;

async function deriveKey(secretBytes) {
  const raw = await crypto.subtle.importKey('raw', secretBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('bowman-memory-v1'), info: enc.encode('aes-gcm') },
    raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function load() {
  const blob = store.get('mem.blob');
  if (!blob || !key) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
    return JSON.parse(dec.decode(pt));
  } catch { return null; }   // corrupted / foreign blob → start fresh
}

async function save() {
  if (!key || !data) return;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
  store.set('mem.blob', { iv: b64(iv), ct: b64(ct) });
}

export const memory = {
  get supported() { return !!crypto?.subtle; },
  get consent() { return store.get('mem.consent', null); },          // null | 'granted' | 'denied'
  get enabled() { return this.consent === 'granted' && !!data; },
  get visitorLabel() { return visitorHash ? `VISITOR-${visitorHash}` : null; },

  async init() {
    if (this.consent !== 'granted' || !this.supported) return;
    await this._open();
  },

  async grant() {
    if (!this.supported) return false;
    store.set('mem.consent', 'granted');
    await this._open();
    return true;
  },

  deny() { store.set('mem.consent', 'denied'); },

  /** Right to erasure: destroy secret, ciphertext and consent. */
  forget() {
    store.remove('mem.secret');
    store.remove('mem.blob');
    store.set('mem.consent', 'denied');
    key = null; data = null; visitorHash = ''; lastSeenBefore = null;
  },

  async _open() {
    let secret = store.get('mem.secret');
    if (!secret) {
      secret = b64(crypto.getRandomValues(new Uint8Array(32)));
      store.set('mem.secret', secret);
    }
    const bytes = unb64(secret);
    key = await deriveKey(bytes);
    const h = await crypto.subtle.digest('SHA-256', bytes);
    visitorHash = [...new Uint8Array(h).slice(0, 4)]
      .map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    data = (await load()) ?? { name: null, visits: 0, lastSeen: null, topics: [], log: [] };
    lastSeenBefore = data.lastSeen;
    data.visits += 1;
    data.lastSeen = Date.now();
    await save();
  },

  setName(name) {
    if (!this.enabled) return;
    data.name = String(name).trim().slice(0, 24);
    save();
  },

  recordExchange(userText, botText, projectId = null) {
    if (!this.enabled) return;
    data.log.push({ u: String(userText).slice(0, 140), b: String(botText).slice(0, 140) });
    while (data.log.length > 6) data.log.shift();
    if (projectId) data.topics = [projectId, ...data.topics.filter((t) => t !== projectId)].slice(0, 4);
    save();
  },

  /** Priming block injected into Spotty's brains for returning visitors. */
  primingText() {
    if (!this.enabled || (data.visits <= 1 && !data.log.length)) return '';
    const lines = [];
    if (data.name) lines.push(`The visitor previously told you their name: ${data.name}.`);
    if (lastSeenBefore) {
      lines.push(`This is visit #${data.visits}; they were last here ${new Date(lastSeenBefore).toLocaleDateString()}.`);
    }
    if (data.topics.length) lines.push(`Projects discussed before: ${data.topics.join(', ')}.`);
    if (data.log.length) {
      lines.push('Tail of the last conversation: ' +
        data.log.map((e) => `(them) "${e.u}" (you) "${e.b}"`).join(' '));
    }
    return lines.join(' ');
  },

  /** Greeting hints for the welcome-back line. */
  greetingInfo() {
    if (!this.enabled || data.visits <= 1) return null;
    return { name: data.name, visits: data.visits, lastTopic: data.topics[0] || null };
  },

  /** Right of access: everything stored, in plain words. */
  describe() {
    if (this.consent !== 'granted') return 'I am not remembering anything — memory is off. Everything you say is gone when you close the page.';
    if (!data) return 'Memory is on, but I have nothing stored yet.';
    const bits = [
      `Everything below lives ONLY in this browser, encrypted (AES-256), tagged ${this.visitorLabel} — a random local id, not a fingerprint:`,
      data.name ? `your name: ${data.name}` : 'no name (you never told me one)',
      `${data.visits} visit${data.visits === 1 ? '' : 's'}`,
      data.topics.length ? `topics: ${data.topics.join(', ')}` : 'no project topics yet',
      `${data.log.length} remembered exchange${data.log.length === 1 ? '' : 's'}`,
    ];
    return bits.join(' · ') + '. Say "forget me" and it is all destroyed instantly.';
  },
};
