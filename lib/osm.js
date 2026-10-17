// OSM building footprints via public Overpass mirrors (free), compacted for 3D extrusion. Cached 7 days in memory; one upstream request at a time.
const UA = 'SkyDeck/1.0 (personal flight tracker; OSM data ODbL)';
const MIRRORS = ['https://z.overpass-api.de/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'], bad = new Map();   // bad: mirror -> retry-after timestamp
const cache = new Map(), inflight = new Map(); let active = 0; const waitq = [];
const slot = () => new Promise(r => { const go = () => { active++; r(); }; active < 2 ? go() : waitq.push(go); }), free = () => { active--; waitq.shift()?.(); };
const DEF = { house: 7, residential: 7, detached: 7, garage: 3.5, shed: 3, hangar: 9, industrial: 9, warehouse: 9, commercial: 11, retail: 8, apartments: 14, terminal: 12, office: 14, hospital: 16, school: 9, church: 12, roof: 4, yes: 8 };
const hOf = t => { if (t.height) { const v = parseFloat(String(t.height).replace(',', '.')); if (v > 0) return /ft|'/.test(t.height) ? v * 0.3048 : v; } const lv = parseFloat(t['building:levels']); if (lv > 0) return lv * 3.2 + 1; return DEF[t.building] || 8; };
async function query(s, w, n, e) {
  const q = `[out:json][timeout:20];way["building"](${s},${w},${n},${e});out tags geom 4000;`; let last = 'no mirror';
  for (const m of MIRRORS) {
    if ((bad.get(m) || 0) > Date.now()) continue;
    try { const r = await fetch(m, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(22000) });
      if (!r.ok) { last = m + ' HTTP ' + r.status; bad.set(m, Date.now() + 120000); continue; } const j = await r.json(); if (!Array.isArray(j.elements)) { last = m + ' bad json'; continue; }
      return j.elements.filter(x => x.geometry && x.geometry.length >= 4).map(x => [Math.round(hOf(x.tags || {}) * 10) / 10, x.geometry.flatMap(p => [Math.round(p.lon * 1e6) / 1e6, Math.round(p.lat * 1e6) / 1e6])]);
    } catch (err) { last = m + ' ' + (err.message || err); bad.set(m, Date.now() + 120000); }
  }
  throw new Error(last);
}
function buildings(s, w, n, e) {
  const key = [s, w, n, e].join(','), c = cache.get(key); if (c && Date.now() - c.t < 7 * 864e5) return Promise.resolve(c.v); if (inflight.has(key)) return inflight.get(key);
  const p = (async () => { await slot(); try { await new Promise(r => setTimeout(r, 150)); const b = await query(s, w, n, e), v = { src: 'OpenStreetMap contributors (ODbL) via Overpass', b }; cache.set(key, { t: Date.now(), v }); if (cache.size > 500) cache.delete(cache.keys().next().value); return v; } finally { free(); inflight.delete(key); } })();
  inflight.set(key, p); return p;
}
module.exports = { buildings };
