// DATALINK — real web connectivity for a serverless static site.
// Wikipedia's public APIs ship permissive CORS (origin=*), need no key, and
// are stable — so the Search app and Internet Explorer can pull live data
// from the actual internet. Nothing is proxied; requests go straight from
// the visitor's browser.

/** Live web search. Returns [{ title, desc, url }]. */
export async function webSearch(query, limit = 6) {
  const u = 'https://en.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*' +
            `&limit=${limit}&search=${encodeURIComponent(query)}`;
  const res = await fetch(u);
  if (!res.ok) throw new Error(`datalink ${res.status}`);
  const [, titles, descs, urls] = await res.json();
  return titles.map((t, i) => ({ title: t, desc: descs?.[i] || '', url: urls[i] }));
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
