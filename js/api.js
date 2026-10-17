// Data access. Live ADS-B + history + weather go through the local proxy (/api/*) because those sources send no CORS headers.
// ArcGIS (FAA AIS), hexdb.io, RainViewer, IEM and AWS terrain tiles are CORS-open and are called directly.
import { icaoToN } from './util.js';
const _b = (new URLSearchParams(location.search).get('api') || window.SKYDECK_API || '').replace(/\/*$/, '');   // optional remote proxy (Cloudflare Worker) for static hosting
export const API = { proxy: null, base: _b ? _b + '/' : '' };
export async function detectProxy() {
  try { const r = await fetch(API.base + 'api/ping', { cache: 'no-store' }); const j = r.ok ? await r.json() : null; API.proxy = !!(j && j.skydeck); }
  catch { API.proxy = false; }
  return API.proxy;
}
export class NoProxy extends Error { constructor() { super('This data source needs the SkyDeck proxy (run: node server.js)'); } }
async function getJSON(url, opt) { const r = await fetch(url, opt); if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; e.retryAfter = +r.headers.get('retry-after') || 0; throw e; } return r.json(); }
export const adsb = async path => { if (!API.proxy) throw new NoProxy(); return getJSON(API.base + 'api/adsb/' + path); };
export const proxied = async path => { if (!API.proxy) throw new NoProxy(); return getJSON(API.base + 'api/' + path); };
// ---- aircraft normalisation (adsb.lol v2 / readsb JSON) ----
const COMM = /^[A-Z]{3}\d{1,4}[A-Z]{0,2}$/;
export function norm(a, now) {
  if (a.lat == null || a.lon == null) return null;
  const gnd = a.alt_baro === 'ground';
  let alt = gnd ? 0 : (typeof a.alt_baro === 'number' ? a.alt_baro : (typeof a.alt_geom === 'number' ? a.alt_geom : null));
  if (!gnd && typeof a.alt_baro === 'number' && a.nav_qnh && alt < 18000) alt += (a.nav_qnh - 1013.25) * 27;   // QNH-correct to ~MSL so aircraft sit on the terrain mesh
  const fl = (a.flight || '').trim(), f = a.dbFlags || 0, reg = a.r || '';
  const mil = !!(f & 1), masked = !!(f & 12);
  const cat = mil ? 'mil' : masked ? 'masked' : (COMM.test(fl) && !/^N\d/.test(fl) ? 'com' : 'pvt');
  return { hex: a.hex.toLowerCase(), fl, reg: reg || (a.hex[0] !== '~' ? icaoToN(a.hex) || '' : ''), type: a.t || '', desc: a.desc || '', alt, gnd, gs: a.gs ?? 0, trk: a.track ?? a.true_heading ?? 0,
    vr: a.baro_rate ?? a.geom_rate ?? 0, sqk: a.squawk || '', lat: a.lat, lon: a.lon, t: now - (a.seen_pos ?? 0) * 1000, catg: a.category || '', mil, masked, ladd: !!(f & 8), pia: !!(f & 4),
    emg: a.emergency && a.emergency !== 'none' ? a.emergency : '', cat, heli: /^A7/.test(a.category || '') , ownOp: a.ownOp || '', mlat: Array.isArray(a.mlat) && a.mlat.includes('lat') };
}
export async function fetchList(path) { const j = await adsb(path); const now = j.now || Date.now(); return { now: Date.now(), list: (j.ac || []).map(a => norm(a, Date.now())).filter(Boolean), total: j.total, sky: j.sky || null }; }
export const hexInfo = (() => { const c = new Map(); return async hex => { hex = hex.toLowerCase(); if (c.has(hex)) return c.get(hex); const p = (API.proxy ? fetch(API.base + 'api/hexdb/' + hex) : Promise.resolve({ ok: false })).then(r => r.ok ? r.json() : null).catch(() => null); c.set(hex, p); return p; }; })();
// ---- ADS-B Exchange trace_full / trace_recent JSON -> points ----
export function parseTrace(j) {
  const t0 = j.timestamp * 1000, pts = [];
  for (const p of j.trace || []) { const gnd = p[3] === 'ground'; const a = gnd ? 0 : (typeof p[3] === 'number' ? p[3] : null); if (p[1] == null) continue; pts.push({ t: t0 + p[0] * 1000, lat: p[1], lon: p[2], alt: a, gnd, gs: p[4] ?? 0, trk: p[5] ?? 0, vr: p[7] ?? 0 }); }
  return { hex: j.icao, reg: j.r, type: j.t, desc: j.desc, ownOp: j.ownOp, pts };
}
export async function loadTraceDay(hex, day) { try { return parseTrace(await proxied(`trace/${hex}?kind=day&day=${day}`)); } catch (e) { if (e.status === 404) return { hex, pts: [], none: true }; throw e; } }
export async function loadTraceRecent(hex) { try { return parseTrace(await proxied(`trace/${hex}?kind=recent`)); } catch (e) { if (e.status === 404) return { hex, pts: [], none: true }; throw e; } }
// ---- FAA AIS (ArcGIS hosted feature services; CORS-open) ----
const AIS = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/';
export async function ais(svc, q, tries = 3) {
  for (let i = 0; ; i++) {
    let j; try { j = await getJSON(AIS + svc + '/FeatureServer/0/query?' + new URLSearchParams({ f: 'geojson', outSR: 4326, inSR: 4326, ...q })); } catch (e) { if (i >= tries - 1) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); continue; }
    if (j && Array.isArray(j.features)) return j;
    const code = j?.error?.code, msg = j?.error?.message || 'unexpected response';
    if (i >= tries - 1) { const e = new Error(code === 429 ? 'FAA AIS quota exceeded (shared hosted service, retry in a minute)' : 'FAA AIS error: ' + msg); e.status = code; throw e; }
    await new Promise(r => setTimeout(r, code === 429 ? 6000 : 1500 * (i + 1)));
  }
}
export const bboxQ = (w, s, e, n) => ({ geometry: `${w},${s},${e},${n}`, geometryType: 'esriGeometryEnvelope', spatialRel: 'esriSpatialRelIntersects' });
export async function airportByIdent(id) { id = id.toUpperCase().replace(/^K(?=[A-Z0-9]{3}$)/, ''); const j = await ais('US_Airport', { where: `IDENT='${id.replace(/'/g, '')}' OR ICAO_ID='K${id.replace(/'/g, '')}' OR ICAO_ID='${id.replace(/'/g, '')}'`, outFields: 'IDENT,NAME,ICAO_ID,LATITUDE,LONGITUDE,ELEVATION,TYPE_CODE,SERVCITY,STATE', returnGeometry: false }); return j.features.map(f => f.properties); }
