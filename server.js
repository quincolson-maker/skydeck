#!/usr/bin/env node
// SkyDeck local server: serves the static app + a tiny caching CORS proxy for the free data sources
// that don't send CORS headers (adsb.lol, ADS-B Exchange history, aviationweather.gov, FAA TFR).
// Zero dependencies (Node >= 18).  Run:  node server.js     (PORT=8080 HOST=127.0.0.1 by default)
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = +process.env.PORT || 8080, HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname, UA = 'SkyDeck/1.0 (+personal flight tracker)';
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css', '.json':'application/json',
  '.webmanifest':'application/manifest+json', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.map':'application/json' };
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
const utcParts = (d) => { const p = n => String(n).padStart(2, '0'); return [d.getUTCFullYear(), p(d.getUTCMonth() + 1), p(d.getUTCDate())]; };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = decodeURIComponent(u.pathname);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' }); return res.end(); }
    if (p === '/api/ping') return json(res, 200, { skydeck: true, version: '1.0', cache: cache.size, ...stats });
    if (p.startsWith('/api/adsb/')) {
      const rest = p.slice(10); if (!ADSB_OK.test(rest) || rest.includes('..')) return json(res, 400, { error: 'endpoint not allowed' });
      const ttl = rest.startsWith('mil') ? 8000 : rest.startsWith('point') ? 2500 : 2000;
      return send(res, await upstream('https://api.adsb.lol/v2/' + rest, { ttl }));
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
    if (p === '/api/tfr') return send(res, await tfr());
    // static
    let f = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p)); if (!f.startsWith(ROOT) || /(^|[\\/])(server\.js|worker|tests|\.)/.test(path.relative(ROOT, f)) && !p.startsWith('/icons')) { res.writeHead(404); return res.end('not found'); }
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': f.endsWith('sw.js') ? 'no-cache' : 'no-cache' }); res.end(d);
    });
  } catch (e) { json(res, 500, { error: String(e.message || e) }); }
});
server.listen(PORT, HOST, () => console.log(`SkyDeck running → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
