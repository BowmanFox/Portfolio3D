// Safe persistent storage. localStorage can throw inside third-party iframes
// (e.g. a carrd.co embed with blocked cookies), so fall back to memory.
const NS = 'bowmanxp.';
const mem = new Map();

let backend = null;
try {
  const t = NS + '__test';
  window.localStorage.setItem(t, '1');
  window.localStorage.removeItem(t);
  backend = window.localStorage;
} catch { backend = null; }

export const store = {
  get(key, def = null) {
    try {
      const raw = backend ? backend.getItem(NS + key) : mem.get(key);
      return raw == null ? def : JSON.parse(raw);
    } catch { return def; }
  },
  set(key, val) {
    try {
      const raw = JSON.stringify(val);
      if (backend) backend.setItem(NS + key, raw);
      else mem.set(key, raw);
    } catch { /* quota / private mode — ignore */ }
  },
  remove(key) {
    try {
      if (backend) backend.removeItem(NS + key);
      mem.delete(key);
    } catch { /* ignore */ }
  },
  clearAll() {
    try {
      if (backend) {
        for (const k of Object.keys(backend).filter(k => k.startsWith(NS))) backend.removeItem(k);
      }
      mem.clear();
    } catch { /* ignore */ }
  },
  persistent: !!backend,
};
