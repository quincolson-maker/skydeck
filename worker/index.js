// SkyDeck on ONE Cloudflare Worker: static app (Workers Static Assets, binding ASSETS) + the same /api proxy routes as server.js.
// Free-tier notes: 100k requests/day; 50 subrequests per request (TFR enrichment is therefore capped & cached per NOTAM);
// identical concurrent requests are coalesced in-isolate and responses are cached with the Cache API.
const UA = 'SkyDeck/1.0 (+personal flight tracker)';
const ADSB_OK = /^((point|hex|callsign|registration|type|sqk|closest|lat)\/|(mil|pia|ladd)$)/;
const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' };
const inflight = new Map();
const mk = (body, status, type, extra = {}) => new Response(body, { status, headers: { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store', ...H, ...extra } });
const jerr = (status, obj) => mk(JSON.stringify(obj), status);
// cached + coalesced upstream fetch -> {status, body(ArrayBuffer), type}
async function upstream(url, { ttl = 3, headers = {} } = {}) {
  const ck = new Request('https://skydeck-cache.invalid/' + encodeURIComponent(url)), cache = caches.default;
  const hit = await cache.match(ck);
  if (hit) return { status: hit.status, body: await hit.arrayBuffer(), type: hit.headers.get('content-type') || 'application/json', cache: 'hit' };
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(20000) });
      const body = await r.arrayBuffer(), type = r.headers.get('content-type') || 'application/json';
      const t = r.ok ? ttl : (r.status === 404 ? Math.max(ttl, 30) : 2);
      if (r.status !== 429 && r.status < 500) await cache.put(ck, new Response(body, { status: r.status, headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=' + Math.max(1, Math.round(t)) } })).catch(() => {});
      return { status: r.status, body, type, cache: 'miss' };
    } catch (e) { return { status: 502, body: new TextEncoder().encode(JSON.stringify({ error: 'upstream unavailable', detail: String(e.message || e) })), type: 'application/json' }; }
    finally { inflight.delete(url); }
  })();
  inflight.set(url, p); return p;
}
const send = o => mk(o.body, o.status, o.type, { 'X-SkyDeck-Cache': o.cache || 'na' });
const utcDay = d => d.toISOString().slice(0, 10);
async function tfrDetail(id, budget) {
  const o = await upstream(`https://tfr.faa.gov/download/detail_${id}.xml`, { ttl: 3600 });
  if (o.status !== 200) return {};
  const x = new TextDecoder().decode(o.body), g = re => (x.match(re) || [])[1];
  const lo = +g(/<valDistVerLower>(\-?\d+)/), hi = +g(/<valDistVerUpper>(\d+)/);
  return { loFt: isNaN(lo) ? 0 : lo, hiFt: isNaN(hi) ? null : hi, upperRef: g(/<codeDistVerUpper>(\w+)/), eff: g(/<dateEffective>([^<]+)/), exp: g(/<dateExpire>([^<]+)/), name: g(/<txtLocalName>([^<]+)/) };
}
async function tfr() {
  const o = await upstream('https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&outputFormat=application/json', { ttl: 900 });
  if (o.status !== 200) return o;
  const fc = JSON.parse(new TextDecoder().decode(o.body)); const ids = fc.features.map(f => (f.properties.NOTAM_KEY || '').split('-')[0].replace('/', '_'));
  // free plan: 50 subrequests/request (1 used above, 1 for cache lookups per upstream()). Enrich at most 35 new ones per call; the rest fill in on later calls (cached 1 h).
  const det = new Array(ids.length); let i = 0, used = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (i < ids.length && used < 35) { const k = i++; used++; det[k] = await tfrDetail(ids[k]).catch(() => ({})); } }));
  fc.features.forEach((f, k) => Object.assign(f.properties, det[k] || {}));
  fc.properties = { ...(fc.properties || {}), enriched: det.filter(Boolean).length, total: ids.length };
  return { status: 200, body: new TextEncoder().encode(JSON.stringify(fc)), type: 'application/json', cache: 'na' };
}
async function api(req, u) {
  const p = decodeURIComponent(u.pathname);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: H });
  if (p === '/api/ping') return jerr(200, { skydeck: true, version: '1.0', runtime: 'cloudflare-worker' });
  if (p.startsWith('/api/adsb/')) {
    const r0 = p.slice(10);
    if (!ADSB_OK.test(r0) || r0.includes('..')) return jerr(400, { error: 'endpoint not allowed' });
    return send(await upstream('https://api.adsb.lol/v2/' + r0, { ttl: r0.startsWith('mil') ? 8 : r0.startsWith('point') ? 2.5 : 2 }));
  }
  if (p.startsWith('/api/trace/')) {
    const hex = p.slice(11).toLowerCase(); if (!/^[0-9a-f]{6}$/.test(hex)) return jerr(400, { error: 'bad hex' });
    const kind = u.searchParams.get('kind') || 'recent', sub = hex.slice(-2); let url, ttl = 60;
    if (kind === 'day') {
      const day = u.searchParams.get('day') || ''; if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return jerr(400, { error: 'bad day' });
      if (day >= utcDay(new Date())) url = `https://globe.adsbexchange.com/data/traces/${sub}/trace_full_${hex}.json`;
      else { url = `https://globe.adsbexchange.com/globe_history/${day.replace(/-/g, '/')}/traces/${sub}/trace_full_${hex}.json`; ttl = 6 * 3600; }
    } else url = `https://globe.adsbexchange.com/data/traces/${sub}/trace_${kind === 'full' ? 'full' : 'recent'}_${hex}.json`;
    const o = await upstream(url, { ttl, headers: { Referer: 'https://globe.adsbexchange.com/' } });
    return o.status === 404 ? jerr(404, { error: 'no trace for that aircraft/day' }) : send(o);
  }
  if (p.startsWith('/api/hexdb/')) {
    const hex = p.slice(11).toLowerCase(); if (!/^[0-9a-f]{6}$/.test(hex)) return jerr(400, { error: 'bad hex' });
    const o = await upstream('https://hexdb.io/api/v1/aircraft/' + hex, { ttl: 86400 }); return o.status === 200 ? send(o) : jerr(404, { error: 'unknown' });
  }
  if (p === '/api/wx/airsigmet') return send(await upstream('https://aviationweather.gov/api/data/airsigmet?format=json', { ttl: 300 }));
  if (p === '/api/wx/gairmet') return send(await upstream('https://aviationweather.gov/api/data/gairmet?format=json', { ttl: 300 }));
  if (p === '/api/tfr') return send(await tfr());
  return jerr(404, { error: 'not found' });
}
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname.startsWith('/api/')) { try { return await api(req, u); } catch (e) { return jerr(500, { error: String(e.message || e) }); } }
    return env.ASSETS.fetch(req);
  }
};
