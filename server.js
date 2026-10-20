#!/usr/bin/env node
// SkyDeck local server: serves the static app + a tiny caching CORS proxy for the free data sources
// that don't send CORS headers (adsb.lol, ADS-B Exchange history, aviationweather.gov, FAA TFR).
// Zero dependencies (Node >= 18).  Run:  node server.js     (PORT=8080 HOST=127.0.0.1 by default)
try { require('v8').setFlagsFromString('--max-old-space-size=230'); } catch { }   // Render free = 512 MB: keep the heap (incl. the JetBasket registry index) well under it
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = +process.env.PORT || 8080, HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname, UA = 'SkyDeck/1.0 (+personal flight tracker)';
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css', '.json':'application/json',
  '.webmanifest':'application/manifest+json', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.map':'application/json' };
const JB = require('./lib/registry'); let jbStarted = false; const jbPrices = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'prices.json'), 'utf8')); } catch { return { prices: [] }; } })(); const enrichCache = new Map(); let lastNom = 0;
const WX = require('./lib/wx'), OSM = require('./lib/osm');
const cache = new Map();           // url -> {t, ttl, status, body, type}
const inflight = new Map();
const stats = { hits: 0, misses: 0, errors: 0 };
async function upstream(url, { ttl = 3000, headers = {}, key } = {}) {
  key = key || url; const c = cache.get(key);
  if (c && Date.now() - c.t < c.ttl) { stats.hits++; return c; }
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    stats.misses++;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(25000) });
      if (r.status === 429 && c) return { ...c, stale: true };
      const body = Buffer.from(await r.arrayBuffer());
      const out = { t: Date.now(), ttl: r.ok ? ttl : Math.min(ttl, 5000), status: r.status, body, type: r.headers.get('content-type') || 'application/json' };
      cache.set(key, out); if (cache.size > 800) cache.delete(cache.keys().next().value);
      return out;
    } catch (e) {
      stats.errors++;
      if (c) return { ...c, stale: true };
      return { t: Date.now(), ttl: 2000, status: 502, body: Buffer.from(JSON.stringify({ error: 'upstream unavailable', detail: String(e.message || e) })), type: 'application/json' };
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p); return p;
}
const send = (res, o) => { res.writeHead(o.status, { 'Content-Type': o.type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'X-SkyDeck-Cache': o.stale ? 'stale' : 'ok' }); res.end(o.body); };
const json = (res, status, obj) => send(res, { status, type: 'application/json', body: Buffer.from(JSON.stringify(obj)) });
const ADSB_OK = /^((point|hex|callsign|registration|type|sqk|closest|lat)\/|(mil|pia|ladd)$)/;
// ---------------------------------------------------------------------------------------------------------------
// Live ADS-B pipeline: grid-snapped cache keys, request coalescing, a global upstream queue with per-source spacing,
// per-source cooldown (Retry-After honoured), a fallback chain adsb.lol -> adsb.fi -> airplanes.live, and stale-while-error.
// All sources are normalised to the adsb.lol v2 shape: { ac:[...], now:<ms>, total, sky:{src,age,stale,note} }.
// ---------------------------------------------------------------------------------------------------------------
const TTL = { point: 8e3, mil: 20e3, hex: 8e3, other: 15e3 };          // server cache TTLs
const STALE_MAX = 15 * 60e3;                                            // never serve data older than this, even as a fallback
const R_STEPS = [25, 50, 75, 100, 150, 200, 250], GRID = 0.25;          // viewport snap: 0.25° grid, radius rounded up
const SRC = [
  { id: 'adsb.lol', gap: 350, cool: 0, fails: 0, ok: 0, last: 0, err: '',
    url: r => 'https://api.adsb.lol/v2/' + r.path, fix: j => j },
  { id: 'adsb.fi', gap: 1100, cool: 0, fails: 0, ok: 0, last: 0, err: '',
    url: r => r.kind === 'point' ? `https://opendata.adsb.fi/api/v2/lat/${r.lat}/lon/${r.lon}/dist/${r.r}` : ['callsign', 'registration', 'hex', 'sqk', 'mil'].includes(r.kind) ? 'https://opendata.adsb.fi/api/v2/' + r.path : null,
    fix: j => (j.ac ? j : { ...j, ac: j.aircraft || [], total: j.resultCount ?? (j.aircraft || []).length, now: j.now && j.now < 1e11 ? j.now * 1000 : j.now }) },
  { id: 'airplanes.live', gap: 1100, cool: 0, fails: 0, ok: 0, last: 0, err: '',
    url: r => r.kind === 'point' ? `https://api.airplanes.live/v2/point/${r.lat}/${r.lon}/${r.r}` : r.kind === 'registration' ? 'https://api.airplanes.live/v2/reg/' + r.path.slice(13) : ['callsign', 'hex', 'type', 'sqk', 'mil', 'pia', 'ladd'].includes(r.kind) ? 'https://api.airplanes.live/v2/' + r.path : null,
    fix: j => j },
];
const adsbCache = new Map(), adsbInflight = new Map();
const NM_KM = 1.852, rad = x => x * Math.PI / 180;
const hav = (la1, lo1, la2, lo2) => { const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2; return 2 * 3440.065 * Math.asin(Math.sqrt(a)); };
// Turn the client's path into a canonical request: {kind, path, key, ttl, orig}
function planRoute(rest) {
  const parts = rest.split('/'), kind = parts[0];
  if (kind === 'point' && parts.length === 4) {
    const lat = +parts[1], lon = +parts[2], r0 = Math.min(250, Math.max(1, +parts[3])); if (![lat, lon, r0].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const sl = Math.round(lat / GRID) * GRID, so = Math.round(lon / GRID) * GRID;
    const off = hav(lat, lon, sl, so) + 0.5;                                   // snap error in nm (<= ~11 nm)
    const r = R_STEPS.find(x => x >= r0 + off) || 250, la = sl.toFixed(2), lo = so.toFixed(2);
    return { kind, lat: la, lon: lo, r, path: `point/${la}/${lo}/${r}`, key: `point/${la}/${lo}/${r}`, ttl: TTL.point, orig: { lat, lon, r: r0 } };
  }
  if (kind === 'hex') { const hs = (parts[1] || '').toLowerCase().split(',').filter(x => /^[0-9a-f]{6}$/.test(x)).sort(); if (!hs.length) return null; const path = 'hex/' + [...new Set(hs)].slice(0, 100).join(','); return { kind, path, key: path, ttl: TTL.hex }; }
  if (kind === 'mil' && parts.length === 1) return { kind, path: 'mil', key: 'mil', ttl: TTL.mil };
  return { kind, path: rest, key: rest, ttl: TTL.other };
}
// global queue: one upstream request at a time per source, spaced by `gap`; cap queue length so bursts never pile up
const queues = new Map();
function schedule(src, fn) {
  const q = queues.get(src.id) || { chain: Promise.resolve(), n: 0 }; queues.set(src.id, q);
  if (q.n >= 12) return Promise.reject(Object.assign(new Error('queue full'), { status: 503 }));
  q.n++;
  const run = q.chain.then(async () => { const w = src.last + src.gap - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w)); try { return await fn(); } finally { src.last = Date.now(); q.n--; } });
  q.chain = run.catch(() => {}); return run;
}
function cool(src, status, retryAfterS, why) {
  src.fails++; src.err = why || ('HTTP ' + status);
  const base = status === 403 ? 600e3 : status === 429 ? 30e3 : 10e3;
  let ms = retryAfterS ? retryAfterS * 1000 : Math.min(300e3, base * 2 ** Math.min(src.fails - 1, 4));
  src.cool = Date.now() + Math.min(ms, 600e3); stats.cool = (stats.cool || 0) + 1;
}
const FORCE_FAIL = new Set();     // test hook (only reachable with SKYDECK_TEST=1): /api/_test/fail?src=adsb.lol,adsb.fi
async function fetchFrom(src, req) {
  const url = src.url(req); if (!url) return null;
  return schedule(src, async () => {
    if (src.cool > Date.now()) return { skip: true };
    if (FORCE_FAIL.has(src.id)) { cool(src, 429, 4, 'simulated 429'); return { fail: 429 }; }
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429 || r.status === 403 || r.status >= 500) { cool(src, r.status, +r.headers.get('retry-after') || 0); return { fail: r.status }; }
      if (!r.ok) return { fail: r.status, passthrough: true };
      let j; try { j = JSON.parse(await r.text()); } catch { cool(src, 502, 0, 'bad JSON'); return { fail: 502 }; }
      j = src.fix(j); if (!Array.isArray(j.ac)) { cool(src, 502, 0, 'unexpected response'); return { fail: 502 }; }
      src.fails = 0; src.err = ''; src.ok = Date.now(); return { j };
    } catch (e) { cool(src, 0, 0, String(e.name === 'TimeoutError' ? 'timeout' : e.message)); return { fail: 0 }; }
  });
}
function respond(entry, req, extra = {}) {
  let ac = entry.j.ac;
  if (req.orig) ac = ac.filter(a => a.lat != null && hav(req.orig.lat, req.orig.lon, a.lat, a.lon) <= req.orig.r);  // exact circle the client asked for
  const age = Math.round((Date.now() - entry.t) / 1000);
  return { status: 200, type: 'application/json', body: Buffer.from(JSON.stringify({ ...entry.j, ac, total: ac.length, sky: { src: entry.src, age, stale: !!extra.stale, note: extra.note || '', tried: extra.tried || undefined } })) };
}
async function adsb(rest) {
  const req = planRoute(rest); if (!req) return { status: 400, type: 'application/json', body: Buffer.from('{"error":"bad request"}') };
  const c = adsbCache.get(req.key);
  if (c && Date.now() - c.t < req.ttl) { stats.hits++; return respond(c, req); }
  if (adsbInflight.has(req.key)) return adsbInflight.get(req.key).then(e => respond(e.entry || e, req, e.extra || {}));
  const p = (async () => {
    stats.misses++; const tried = []; let passthrough = null;
    for (const src of SRC) {
      if (src.cool > Date.now()) { tried.push(src.id + ': cooling ' + Math.ceil((src.cool - Date.now()) / 1000) + 's'); continue; }
      let o; try { o = await fetchFrom(src, req); } catch (e) { tried.push(src.id + ': ' + e.message); continue; }
      if (!o) continue;                                              // source does not support this route
      if (o.skip) { tried.push(src.id + ': cooling'); continue; }
      if (o.j) { const entry = { t: Date.now(), j: o.j, src: src.id }; adsbCache.set(req.key, entry); if (adsbCache.size > 600) adsbCache.delete(adsbCache.keys().next().value); return { entry, extra: { note: tried.length ? 'fallback: ' + tried.join('; ') : '' } }; }
      tried.push(src.id + ': HTTP ' + o.fail); if (o.passthrough && !passthrough) passthrough = o.fail;
    }
    if (c && Date.now() - c.t < STALE_MAX) { stats.stale = (stats.stale || 0) + 1; return { entry: c, extra: { stale: true, note: 'all sources busy — serving cached data', tried } }; }
    const wait = Math.max(0, Math.min(...SRC.map(s => s.cool)) - Date.now());
    return { error: true, status: passthrough || 429, wait: Math.ceil(wait / 1000) || 10, tried };
  })().finally(() => adsbInflight.delete(req.key));
  adsbInflight.set(req.key, p);
  const e = await p;
  if (e.error) return { status: e.status === 400 ? 400 : 429, type: 'application/json', retryAfter: e.wait, body: Buffer.from(JSON.stringify({ error: 'All live-data sources are rate-limiting right now', retryAfter: e.wait, tried: e.tried })) };
  return respond(e.entry, req, e.extra);
}
const tfrDetail = async id => {
  const o = await upstream(`https://tfr.faa.gov/download/detail_${id}.xml`, { ttl: 3600e3 });
  if (o.status !== 200) return {};
  const x = o.body.toString('utf8'), g = re => (x.match(re) || [])[1];
  const lo = +g(/<valDistVerLower>(\-?\d+)/), hi = +g(/<valDistVerUpper>(\d+)/);
  return { loFt: isNaN(lo) ? 0 : lo, hiFt: isNaN(hi) ? null : hi, upperRef: g(/<codeDistVerUpper>(\w+)/), eff: g(/<dateEffective>([^<]+)/), exp: g(/<dateExpire>([^<]+)/), name: g(/<txtLocalName>([^<]+)/) };
};
async function tfr() {
  const o = await upstream('https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&outputFormat=application/json', { ttl: 900e3 });
  if (o.status !== 200) return { status: o.status, type: 'application/json', body: o.body };
  const fc = JSON.parse(o.body.toString()); const ids = fc.features.map(f => (f.properties.NOTAM_KEY || '').split('-')[0].replace('/', '_'));
  const det = new Array(ids.length); let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (i < ids.length) { const k = i++; det[k] = await tfrDetail(ids[k]).catch(() => ({})); } }));
  fc.features.forEach((f, k) => Object.assign(f.properties, det[k] || {}));
  return { status: 200, type: 'application/json', body: Buffer.from(JSON.stringify(fc)) };
}
const jsonGz = (req, res, o) => { const b = Buffer.from(JSON.stringify(o)); const h = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }; if (/gzip/.test(req.headers['accept-encoding'] || '') && b.length > 1500) { h['Content-Encoding'] = 'gzip'; const z = require('zlib').gzipSync(b); res.writeHead(200, h); return res.end(z); } res.writeHead(200, h); res.end(b); };
const utcParts = (d) => { const p = n => String(n).padStart(2, '0'); return [d.getUTCFullYear(), p(d.getUTCMonth() + 1), p(d.getUTCDate())]; };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = decodeURIComponent(u.pathname);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' }); return res.end(); }
    if (p.startsWith('/api/jb/')) {   // JetBasket: FAA registry fleet intelligence (lazy: index is built on first use)
      if (!jbStarted) { jbStarted = true; JB.start(); }
      const q = Object.fromEntries(u.searchParams), k = p.slice(8), st = JB.status();
      if (k === 'status') return json(res, 200, st);
      if (k === 'append' && req.method === 'POST') {   // user-configured licensed phone-append provider; key comes from the device per request, never stored
        let body = ''; for await (const ch of req) { body += ch; if (body.length > 20000) return json(res, 413, { error: 'too large' }); } let j; try { j = JSON.parse(body); } catch { return json(res, 400, { error: 'bad json' }); }
        const P = j.provider || {}; if (!/^https:\/\//.test(P.url || '') || !P.key) return json(res, 400, { error: 'provider URL (https) and key required' });
        try { const r = await fetch(P.url, { method: 'POST', headers: { 'Content-Type': 'application/json', [P.keyHeader || 'Authorization']: (P.keyPrefix || '') + P.key }, body: JSON.stringify(((o) => P.array ? [o] : o)({ ...(j.person || {}), address: j.person?.street, zip_code: j.person?.zip })), signal: AbortSignal.timeout(20000) }); const t = await r.text(); let o; try { o = JSON.parse(t); } catch { o = { raw: t.slice(0, 2000) }; } return json(res, r.ok ? 200 : 502, r.ok ? o : { error: 'provider HTTP ' + r.status, detail: o }); } catch (e) { return json(res, 502, { error: e.message }); }
      }
      if (k === 'prices') { const m = (q.model || '').toUpperCase().replace(/[- ]/g, ''); return json(res, 200, { note: jbPrices.note, prices: (jbPrices.prices || []).filter(x => !m || x.models.some(y => y.toUpperCase().replace(/[- ]/g, '').startsWith(m) || m.startsWith(y.toUpperCase().replace(/[- ]/g, '')))) }); }
      if (k === 'enrich') {   // public business listing (OpenStreetMap / Nominatim: free, ODbL, 1 req/s, cached); businesses only, never individuals
        const key = `${q.name}|${q.city}|${q.state}`.toUpperCase(); if (enrichCache.has(key)) return json(res, 200, enrichCache.get(key));
        const wait = Math.max(0, lastNom + 1100 - Date.now()); await new Promise(r => setTimeout(r, wait)); lastNom = Date.now();
        const nm = String(q.name || '').replace(/\b(LLC|L L C|INC|CORP|CORPORATION|CO|LTD|TRUSTEE)\b\.?/gi, '').trim(); const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&extratags=1&limit=5&countrycodes=us&q=${encodeURIComponent(`${nm}, ${q.city || ''}, ${q.state || ''}`)}`;
        let out = { source: 'OpenStreetMap (Nominatim)', url, date: new Date().toISOString().slice(0, 10), results: [] };
        try { const r = await fetch(url, { headers: { 'User-Agent': UA + ' JetBasket', 'Accept-Language': 'en' } }); const j = await r.json(); out.results = (j || []).filter(x => x.extratags && (x.extratags.phone || x.extratags['contact:phone'] || x.extratags.website || x.extratags['contact:website'])).map(x => ({ name: x.name || x.display_name, address: x.display_name, phone: x.extratags.phone || x.extratags['contact:phone'] || null, website: x.extratags.website || x.extratags['contact:website'] || null, osm: `https://www.openstreetmap.org/${x.osm_type}/${x.osm_id}` })); } catch (e) { out.error = e.message; }
        enrichCache.set(key, out); return json(res, 200, out);
      }
      if (!st.ready) return json(res, 503, { loading: true, ...st, msg: st.err ? 'FAA registry unavailable: ' + st.err : 'Building the FAA registry index (first use after a restart takes ~30–60 s)…' });
      if (k === 'models') return json(res, 200, JB.models(q.q));
      if (k === 'search') return jsonGz(req, res, JB.search(q));
      if (k === 'aircraft') { const a = JB.aircraft(q.id); return a ? json(res, 200, a) : json(res, 404, { error: 'not in the FAA registry' }); }
      if (k === 'owners') return jsonGz(req, res, JB.owners(q));
      if (k === 'radar') return jsonGz(req, res, JB.radar(q));
      if (k === 'tx') return jsonGz(req, res, JB.transactions(q));
      return json(res, 404, { error: 'unknown' });
    }
    if (p === '/api/ping') return json(res, 200, { skydeck: true, version: '1.7.0', cache: cache.size + adsbCache.size, ...stats, sources: SRC.map(x => ({ id: x.id, cooldownS: Math.max(0, Math.ceil((x.cool - Date.now()) / 1000)), lastOkAgoS: x.ok ? Math.round((Date.now() - x.ok) / 1000) : null, lastError: x.err || null })) });
    if (process.env.SKYDECK_TEST === '1' && p === '/api/_test/fail') { FORCE_FAIL.clear(); (u.searchParams.get('src') || '').split(',').filter(Boolean).forEach(x => FORCE_FAIL.add(x)); for (const x of SRC) if (!FORCE_FAIL.has(x.id)) { x.cool = 0; x.fails = 0; } return json(res, 200, { forced: [...FORCE_FAIL] }); }
    if (p.startsWith('/api/adsb/')) {
      const rest = p.slice(10); if (!ADSB_OK.test(rest) || rest.includes('..')) return json(res, 400, { error: 'endpoint not allowed' });
      const o = await adsb(rest); if (o.retryAfter) res.setHeader('Retry-After', o.retryAfter); return send(res, o);
    }
    if (p.startsWith('/api/trace/')) {                       // /api/trace/<hex>?kind=recent|full|day&day=YYYY-MM-DD   (ADS-B Exchange, needs Referer; best effort)
      const hex = p.slice(11).toLowerCase(); if (!/^[0-9a-f]{6}$/.test(hex)) return json(res, 400, { error: 'bad hex' });
      const kind = u.searchParams.get('kind') || 'recent', sub = hex.slice(-2); let url, ttl = 60e3;
      if (kind === 'day') {
        const day = u.searchParams.get('day') || ''; if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json(res, 400, { error: 'bad day' });
        const today = utcParts(new Date()).join('-'); if (day >= today) { url = `https://globe.adsbexchange.com/data/traces/${sub}/trace_full_${hex}.json`; }
        else { url = `https://globe.adsbexchange.com/globe_history/${day.replace(/-/g, '/')}/traces/${sub}/trace_full_${hex}.json`; ttl = 6 * 3600e3; }
      } else url = `https://globe.adsbexchange.com/data/traces/${sub}/trace_${kind === 'full' ? 'full' : 'recent'}_${hex}.json`;
      const o = await upstream(url, { ttl, headers: { Referer: 'https://globe.adsbexchange.com/' } });
      if (o.status === 404) return json(res, 404, { error: 'no trace for that aircraft/day' });
      return send(res, o);
    }
    if (p.startsWith('/api/hexdb/')) { const hex = p.slice(11).toLowerCase(); if (!/^[0-9a-f]{6}$/.test(hex)) return json(res, 400, { error: 'bad hex' }); const o = await upstream('https://hexdb.io/api/v1/aircraft/' + hex, { ttl: 86400e3 }); return o.status === 200 ? send(res, o) : json(res, 404, { error: 'unknown' }); }
    if (p === '/api/wx/airsigmet') return send(res, await upstream('https://aviationweather.gov/api/data/airsigmet?format=json', { ttl: 300e3 }));
    if (p === '/api/wx/gairmet') return send(res, await upstream('https://aviationweather.gov/api/data/gairmet?format=json', { ttl: 300e3 }));
    if (p === '/api/osm/buildings') { const q = u.searchParams, [s, w, n, e] = ['s', 'w', 'n', 'e'].map(k => +q.get(k)); if ([s, w, n, e].some(isNaN) || n - s > 0.06 || e - w > 0.08 || n <= s || e <= w) return json(res, 400, { error: 'bad bbox (max 0.06° x 0.08°)' });
      try { return jsonGz(req, res, await OSM.buildings(s.toFixed(4), w.toFixed(4), n.toFixed(4), e.toFixed(4))); } catch (err) { return json(res, 502, { error: 'OSM building data unavailable', detail: String(err.message) }); } }
    if (p === '/api/wx/mrms') { const q = u.searchParams, nums = ['w', 's', 'e', 'n'].map(k => +q.get(k)); if (nums.some(isNaN) || nums[2] <= nums[0] || nums[3] <= nums[1] || nums[2] - nums[0] > 12 || nums[3] - nums[1] > 12) return json(res, 400, { error: 'bad bbox (max 12°)' });
      try { return jsonGz(req, res, await WX.mrms(q.get('prod') || 'cref', ...nums, Math.max(0.01, +q.get('step') || 0.02), +q.get('age') || 0)); } catch (e) { return json(res, 502, { error: 'MRMS unavailable', detail: String(e.message) }); } }
    if (p === '/api/wx/mrmsinfo') { try { const o = {}; for (const k of Object.keys(WX.PRODS)) { const l = await WX.list(k); o[k] = { newest: l.length ? l[l.length - 1].t : null, oldest: l.length ? l[0].t : null, n: l.length }; } return json(res, 200, o); } catch (e) { return json(res, 502, { error: String(e.message) }); } }
    if (p === '/api/wx/model') { const q = u.searchParams, nums = ['w', 's', 'e', 'n'].map(k => +q.get(k)); if (nums.some(isNaN) || nums[2] <= nums[0] || nums[3] <= nums[1] || nums[2] - nums[0] > 40 || nums[3] - nums[1] > 40) return json(res, 400, { error: 'bad bbox' });
      try { return jsonGz(req, res, await WX.model(...nums, +q.get('nx') || 6, +q.get('ny') || 6, +q.get('t0') || Date.now(), +q.get('hours') || 6)); } catch (e) { return json(res, e.status === 429 ? 429 : 502, { error: 'Model data unavailable', detail: String(e.message) }); } }
    if (/^\/api\/wx\/(metar|taf|pirep|cwa|stations)$/.test(p)) {
      const k = p.slice(8), q = u.searchParams, ids = (q.get('ids') || '').toUpperCase().replace(/[^A-Z0-9,]/g, '').slice(0, 300);
      const url = k === 'metar' ? `https://aviationweather.gov/api/data/metar?ids=${ids}&format=json&hours=3` : k === 'taf' ? `https://aviationweather.gov/api/data/taf?ids=${ids}&format=json` : k === 'stations' ? `https://aviationweather.gov/api/data/stationinfo?ids=${ids}&format=json`
        : k === 'cwa' ? 'https://aviationweather.gov/api/data/cwa?format=json' : `https://aviationweather.gov/api/data/pirep?format=json&age=${Math.min(12, +q.get('age') || 3)}&bbox=${['s', 'w', 'n', 'e'].map(x => (+q.get(x) || 0).toFixed(2)).join(',')}`;
      if ((k === 'metar' || k === 'taf' || k === 'stations') && !ids) return json(res, 400, { error: 'ids required' });
      return send(res, await upstream(url, { ttl: k === 'stations' ? 86400e3 : k === 'taf' ? 600e3 : k === 'cwa' ? 300e3 : 120e3 }));
    }
    if (p === '/api/wx/metarbox') { const q = u.searchParams, b = ['s', 'w', 'n', 'e'].map(x => (+q.get(x) || 0).toFixed(2)).join(','); return send(res, await upstream(`https://aviationweather.gov/api/data/metar?bbox=${b}&format=json`, { ttl: 180e3 })); }
    if (p === '/api/tfr') return send(res, await tfr());
    // static
    let f = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p)); if (!f.startsWith(ROOT) || /(^|[\\/])(server\.js|worker|lib|tests|\.)/.test(path.relative(ROOT, f)) && !p.startsWith('/icons')) { res.writeHead(404); return res.end('not found'); }
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': f.endsWith('sw.js') ? 'no-cache' : 'no-cache' }); res.end(d);
    });
  } catch (e) { json(res, 500, { error: String(e.message || e) }); }
});
server.listen(PORT, HOST, () => console.log(`SkyDeck running → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
