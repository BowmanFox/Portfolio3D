// DATALINK — real web connectivity for a serverless static site.
// Wikipedia's public APIs ship permissive CORS (origin=*), need no key, and
// are stable — so the Search app and Internet Explorer can pull live data
// from the actual internet. Nothing is proxied; requests go straight from
// the visitor's browser.

// Public SearXNG instances to try, in order. Instances come and go and not
// all allow JSON+CORS — failures just fall through the provider chain.
const SEARX_INSTANCES = [
  'https://searx.be',
  'https://search.bus-hit.me',
  'https://searx.tiekoetter.com',
];

async function searxSearch(query, limit) {
  for (const base of SEARX_INSTANCES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${base}/search?q=${encodeURIComponent(query)}&format=json&safesearch=1`,
        { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const d = await res.json();
      const hits = (d.results || []).slice(0, limit).map(r => ({
        title: r.title, desc: r.content || r.pretty_url || '', url: r.url, kind: 'web',
      }));
      if (hits.length) return { provider: `SearXNG (${new URL(base).hostname})`, results: hits };
    } catch { /* next instance */ }
  }
  throw new Error('no SearXNG instance answered');
}

// DuckDuckGo Instant Answers — keyless, and JSONP sidesteps CORS entirely.
function ddgSearch(query, limit) {
  return new Promise((resolve, reject) => {
    const cb = `__ddg_cb_${Date.now()}_${Math.floor(Math.random() * 1e5)}`;
    const script = document.createElement('script');
    const cleanup = () => { delete window[cb]; script.remove(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('DuckDuckGo timeout')); }, 5000);
    window[cb] = (d) => {
      clearTimeout(timer); cleanup();
      const hits = [];
      if (d.AbstractText) hits.push({ title: d.Heading || query, desc: d.AbstractText, url: d.AbstractURL, kind: 'web' });
      const walk = (topics) => {
        for (const t of topics || []) {
          if (t.Topics) { walk(t.Topics); continue; }
          if (t.FirstURL && t.Text) hits.push({ title: t.Text.split(' - ')[0], desc: t.Text, url: t.FirstURL, kind: 'web' });
        }
      };
      walk(d.RelatedTopics);
      if (!hits.length) return reject(new Error('DuckDuckGo: no instant answers'));
      resolve({ provider: 'DuckDuckGo', results: hits.slice(0, limit) });
    };
    script.src = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&callback=${cb}`;
    script.onerror = () => { clearTimeout(timer); cleanup(); reject(new Error('DuckDuckGo unreachable')); };
    document.head.appendChild(script);
  });
}

async function wikiSearch(query, limit) {
  const u = 'https://en.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*' +
            `&limit=${limit}&search=${encodeURIComponent(query)}`;
  const res = await fetch(u);
  if (!res.ok) throw new Error(`wikipedia ${res.status}`);
  const [, titles, descs, urls] = await res.json();
  const results = titles.map((t, i) => ({ title: t, desc: descs?.[i] || 'Wikipedia article', url: urls[i], kind: 'wiki' }));
  if (!results.length) throw new Error('wikipedia: nothing found');
  return { provider: 'Wikipedia', results };
}

/**
 * Live web search through a chain of free engines: SearXNG instances first,
 * DuckDuckGo instant answers second, Wikipedia as the dependable floor.
 * Returns { provider, results: [{ title, desc, url, kind: 'web'|'wiki' }] }.
 */
export async function webSearch(query, limit = 6) {
  const providers = [searxSearch, ddgSearch, wikiSearch];
  let lastErr = null;
  for (const p of providers) {
    try { return await p(query, limit); }
    catch (err) { lastErr = err; }
  }
  throw lastErr ?? new Error('all datalink providers failed');
}

/** Article summary (title, extract, optional thumbnail, canonical URL). */
export async function pageSummary(title) {
  const res = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  if (!res.ok) throw new Error(`no summary (${res.status})`);
  const d = await res.json();
  return {
    title: d.title,
    extract: d.extract || '(no summary available)',
    thumb: d.thumbnail?.source ?? null,
    url: d.content_urls?.desktop?.page ?? null,
  };
}

/** Current weather via open-meteo (also CORS-open, keyless). */
export async function weatherAt(lat, lon) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
            '&current_weather=true&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto';
  const res = await fetch(u);
  if (!res.ok) throw new Error(`weather ${res.status}`);
  return res.json();
}

export const WMO_CODES = {
  0: '☀️ Clear', 1: '🌤️ Mostly clear', 2: '⛅ Partly cloudy', 3: '☁️ Overcast',
  45: '🌫️ Fog', 48: '🌫️ Rime fog', 51: '🌦️ Light drizzle', 53: '🌦️ Drizzle',
  55: '🌧️ Heavy drizzle', 61: '🌧️ Light rain', 63: '🌧️ Rain', 65: '🌧️ Heavy rain',
  71: '🌨️ Light snow', 73: '🌨️ Snow', 75: '❄️ Heavy snow', 80: '🌦️ Showers',
  81: '🌧️ Showers', 82: '⛈️ Violent showers', 95: '⛈️ Thunderstorm',
  96: '⛈️ Storm + hail', 99: '⛈️ Severe storm',
};
