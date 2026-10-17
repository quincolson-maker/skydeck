// Weather data layer for Flight Planning: NOAA MRMS radar (1 km / 2 min) + echo tops, HRRR/GFS pressure-level model columns, METAR/TAF/PIREP/hazard polygons.
// Nothing is invented: every loader returns {ok, ...} or throws; callers show an empty state with the reason.
import { API } from './api.js';
import { FT } from './util.js';
export const J = async path => { if (!API.proxy) throw new Error('needs the SkyDeck proxy'); const r = await fetch(API.base + 'api/' + path); if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; try { e.detail = (await r.json()).detail; } catch { } throw e; } return r.json(); };
const b64 = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); return u; };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export { sstep };
// ---------------- MRMS ----------------
async function fetchGrid(prod, bb, step, age) {
  const CH = 10, parts = []; for (let w = bb.w; w < bb.e - 1e-6; w += CH) for (let s = bb.s; s < bb.n - 1e-6; s += CH) parts.push([w, s, Math.min(bb.e, w + CH), Math.min(bb.n, s + CH)]);
  const rs = await Promise.all(parts.map(p => J(`wx/mrms?prod=${prod}&w=${p[0].toFixed(3)}&s=${p[1].toFixed(3)}&e=${p[2].toFixed(3)}&n=${p[3].toFixed(3)}&step=${step}${age ? '&age=' + age : ''}`)));
  if (rs.length === 1) { const r = rs[0]; return { t: r.t, newest: r.newest, w: r.w, n: r.n, nx: r.nx, ny: r.ny, step: r.step, d: b64(r.data) }; }
  const st = rs[0].step, W = Math.min(...rs.map(r => r.w)), N = Math.max(...rs.map(r => r.n)), nx = Math.max(...rs.map(r => Math.round((r.w - W) / st) + r.nx)), ny = Math.max(...rs.map(r => Math.round((N - r.n) / st) + r.ny)), d = new Uint8Array(nx * ny);
  for (const r of rs) { const ox = Math.round((r.w - W) / st), oy = Math.round((N - r.n) / st), u = b64(r.data); for (let j = 0; j < r.ny; j++) for (let i = 0; i < r.nx; i++) { const v = u[j * r.nx + i]; if (v > d[(oy + j) * nx + ox + i]) d[(oy + j) * nx + ox + i] = v; } }
  return { t: rs[0].t, newest: rs[0].newest, w: W, n: N, nx, ny, step: st, d };
}
const pool = (g, f) => { const nx = Math.ceil(g.nx / f), ny = Math.ceil(g.ny / f), o = new Uint8Array(nx * ny); for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const v = g.d[j * g.nx + i], k = ((j / f) | 0) * nx + ((i / f) | 0); if (v > o[k]) o[k] = v; } return { nx, ny, d: o }; };
function ssd(a, b, nx, ny, sx, sy, stride) { let s = 0, n = 0; const x0 = Math.max(0, sx), x1 = Math.min(nx, nx + sx), y0 = Math.max(0, sy), y1 = Math.min(ny, ny + sy); for (let j = y0; j < y1; j += stride) for (let i = x0; i < x1; i += stride) { const v = a[j * nx + i], u = b[(j - sy) * nx + i - sx]; if (v || u) { s += (v - u) * (v - u); n++; } } return n > 20 ? s / n : Infinity; }
export function estimateMotion(newG, oldG, dtMin) {   // pattern shift (grid cells per minute) by cross-correlation of the two MRMS composites
  if (!oldG || oldG.nx !== newG.nx || oldG.ny !== newG.ny) return null; let cnt = 0; for (const v of newG.d) if (v >= 104) cnt++; if (cnt < 40) return null;
  const f = Math.max(1, Math.round(newG.nx / 110)), a = pool(newG, f), b = pool(oldG, f), R = 12; let best = [0, 0], bs = Infinity, zero = ssd(a.d, b.d, a.nx, a.ny, 0, 0, 1);
  for (let sy = -R; sy <= R; sy++) for (let sx = -R; sx <= R; sx++) { const s = ssd(a.d, b.d, a.nx, a.ny, sx, sy, 1); if (s < bs) { bs = s; best = [sx, sy]; } }
  let fb = [best[0] * f, best[1] * f], fs = Infinity; for (let sy = fb[1] - f; sy <= fb[1] + f; sy++) for (let sx = fb[0] - f; sx <= fb[0] + f; sx++) { const s = ssd(newG.d, oldG.d, newG.nx, newG.ny, sx, sy, 2); if (s < fs) { fs = s; fb = [sx, sy]; } }
  if (!isFinite(fs) || fs > zero * 0.92 && Math.hypot(...fb) > 0) return fs < zero ? { vx: fb[0] / dtMin, vy: fb[1] / dtMin, weak: true } : null;
  return { vx: fb[0] / dtMin, vy: fb[1] / dtMin };
}
export class Radar {
  constructor(c, et, et50, old, mot) { this.c = c; this.et = et; this.et50 = et50; this.old = old; this.mot = mot; this.t = c.t; this.cache = new Map(); this.w = c.w; this.n = c.n; this.nx = c.nx; this.ny = c.ny; this.step = c.step; }
  get motionKt() { if (!this.mot) return null; const kmx = this.mot.vx * this.step * 111.2 * Math.cos(this.n * Math.PI / 180) * 60, kmy = -this.mot.vy * this.step * 111.2 * 60; return { kt: Math.hypot(kmx, kmy) / 1.852, from: (Math.atan2(-kmx, -kmy) * 180 / Math.PI + 360) % 360 }; }
  shifted(arr, dx, dy) { if (!arr) return null; const { nx, ny } = this, o = new Uint8Array(nx * ny); for (let j = 0; j < ny; j++) { const sj = j - dy; if (sj < 0 || sj >= ny) continue; for (let i = 0; i < nx; i++) { const si = i - dx; if (si >= 0 && si < nx) o[j * nx + i] = arr[sj * nx + si]; } } return o; }
  at(tMs) {   // -> {kind:'obs'|'nowcast', dt, dbz(byte), top(byte km*10), top50} | null when beyond the 2 h nowcast window
    const dt = (tMs - this.t) / 6e4; if (dt <= 3) return { kind: 'obs', dt: Math.max(0, dt), dbz: this.c.d, top: this.et?.d, top50: this.et50?.d };
    if (dt > 125 || !this.mot) return null; const k = Math.round(dt / 5) * 5, c = this.cache.get(k); if (c) return c;
    const dx = Math.round(this.mot.vx * k), dy = Math.round(this.mot.vy * k), o = { kind: 'nowcast', dt: k, dbz: this.shifted(this.c.d, dx, dy), top: this.shifted(this.et?.d, dx, dy), top50: this.shifted(this.et50?.d, dx, dy) };
    this.cache.set(k, o); if (this.cache.size > 30) this.cache.delete(this.cache.keys().next().value); return o;
  }
  sample(lat, lon, tMs) { const r = this.at(tMs); if (!r) return null; const i = Math.floor((lon - this.w) / this.step), j = Math.floor((this.n - lat) / this.step); if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return null; const k = j * this.nx + i, b = r.dbz[k]; return { kind: r.kind, dbz: b ? b / 2 - 32 : null, topFt: r.top && r.top[k] ? r.top[k] / 10 * 1000 / FT : null, top50Ft: r.top50 && r.top50[k] ? r.top50[k] / 10 * 1000 / FT : null }; }
}
export async function loadRadar(bb, mobile) {
  const span = Math.max(bb.e - bb.w, bb.n - bb.s), step = Math.min(0.1, Math.max(0.01, Math.ceil(span / (mobile ? 260 : 520) / 0.01) * 0.01)).toFixed(2);
  const [c, et, et50, old] = await Promise.allSettled([fetchGrid('cref', bb, step, 0), fetchGrid('et18', bb, step, 0), mobile ? Promise.reject() : fetchGrid('et50', bb, step, 0), fetchGrid('cref', bb, step, 30)]);
  if (c.status !== 'fulfilled') throw c.reason || new Error('MRMS composite unavailable');
  const o = old.status === 'fulfilled' ? old.value : null, mot = o ? estimateMotion(c.value, o, (c.value.t - o.t) / 6e4) : null;
  return new Radar(c.value, et.status === 'fulfilled' ? et.value : null, et50.status === 'fulfilled' ? et50.value : null, o, mot);
}
// ---------------- HRRR / GFS column model ----------------
export class Model {
  constructor(j) { Object.assign(this, j); this.H = j.times.length; }
  gridPos(lat, lon) { const fx = Math.min(this.nx - 1.0001, Math.max(0, (lon - this.w) / (this.e - this.w) * (this.nx - 1))), fy = Math.min(this.ny - 1.0001, Math.max(0, (this.n - lat) / (this.n - this.s) * (this.ny - 1))); const i = Math.floor(fx), j = Math.floor(fy), ax = fx - i, ay = fy - j; return [[j * this.nx + i, (1 - ax) * (1 - ay)], [j * this.nx + i + 1, ax * (1 - ay)], [(j + 1) * this.nx + i, (1 - ax) * ay], [(j + 1) * this.nx + i + 1, ax * ay]]; }
  tIdx(t) { const f = (t - this.times[0]) / 36e5, c = Math.min(this.H - 1, Math.max(0, f)); return { h0: Math.floor(c), a: c - Math.floor(c), out: f < -0.5 ? 'before' : f > this.H - 0.5 ? 'after' : null }; }
  val(cs, key, ti) { let s = 0, w = 0; for (const [k, ww] of cs) { const a = this.pts[k].v[key]; if (!a) continue; const x0 = a[ti.h0], x1 = a[Math.min(this.H - 1, ti.h0 + 1)]; const x = x0 == null ? x1 : x1 == null ? x0 : x0 + (x1 - x0) * ti.a; if (x == null) continue; s += x * ww; w += ww; } return w > 0.0001 ? s / w : null; }
  column(lat, lon, t) {
    const cs = this.gridPos(lat, lon), ti = this.tIdx(t), g = k => this.val(cs, k, ti), elev = cs.reduce((s, [k, w]) => s + this.pts[k].elev * w, 0), lev = [];
    for (const p of this.levels) { const z = g(`geopotential_height_${p}hPa`), T = g(`temperature_${p}hPa`); if (z == null || T == null || z < elev + 15) continue; const ws = g(`wind_speed_${p}hPa`) ?? 0, wd = (g(`wind_direction_${p}hPa`) ?? 0) * Math.PI / 180; lev.push({ p, z, T, rh: g(`relative_humidity_${p}hPa`) ?? 0, u: -ws * Math.sin(wd), v: -ws * Math.cos(wd) }); }
    lev.sort((a, b) => a.z - b.z); const t2 = g('temperature_2m'); if (t2 != null && lev.length) { const l0 = lev[0]; lev.unshift({ p: null, z: elev, T: t2, rh: l0.rh, u: l0.u, v: l0.v, sfc: true }); }
    return { lat, lon, t, elev, lev, fzl: g('freezing_level_height'), cc: [g('cloud_cover_low') ?? 0, g('cloud_cover_mid') ?? 0, g('cloud_cover_high') ?? 0], cape: g('cape') ?? 0, vis: g('visibility'), precip: g('precipitation') ?? 0, tOut: ti.out };
  }
}
export async function loadModel(bb, t0, hours, mobile) {
  const spanx = bb.e - bb.w, spany = bb.n - bb.s, cap = mobile ? 5 : 7, nx = Math.max(3, Math.min(cap, Math.round(spanx / 0.9) + 2)), ny = Math.max(3, Math.min(cap, Math.round(spany / 0.9) + 2));
  return new Model(await J(`wx/model?w=${bb.w.toFixed(3)}&s=${bb.s.toFixed(3)}&e=${bb.e.toFixed(3)}&n=${bb.n.toFixed(3)}&nx=${nx}&ny=${ny}&t0=${t0}&hours=${hours}`));
}
// ---- profile helpers (altitude in ft MSL) ----
export function atAlt(col, altFt) {
  const L = col.lev, z = altFt * FT; if (!L.length) return null; if (z <= L[0].z) return { ...L[0], ground: z < col.elev - 5 };
  for (let i = 1; i < L.length; i++) if (z <= L[i].z) { const a = (z - L[i - 1].z) / Math.max(1, L[i].z - L[i - 1].z), A = L[i - 1], B = L[i]; return { T: A.T + (B.T - A.T) * a, rh: A.rh + (B.rh - A.rh) * a, u: A.u + (B.u - A.u) * a, v: A.v + (B.v - A.v) * a }; }
  return { ...L[L.length - 1], above: true };
}
export function isoFt(col, tC) {   // lowest altitude above the surface where air cools through tC; 0 = already colder at the surface; null = not reached below model top
  const L = col.lev; if (!L.length) return null; if (L[0].T <= tC) return col.elev / FT;
  for (let i = 1; i < L.length; i++) if (L[i - 1].T > tC && L[i].T <= tC) return (L[i - 1].z + (L[i].z - L[i - 1].z) * (L[i - 1].T - tC) / (L[i - 1].T - L[i].T)) / FT; return null;
}
export const icingScore = (T, rh) => { if (T > 0 || T < -20) return 0; const tf = T > -2 ? 0.25 + 0.15 * (-T) : T > -8 ? 0.55 + 0.075 * (-T - 2) : T > -14 ? 1 : 1 - 0.1 * (-T - 14); return Math.max(0, tf) * sstep(80, 98, rh); };
export const iceLabel = s => s >= 0.7 ? 'HIGH' : s >= 0.45 ? 'MOD' : s >= 0.2 ? 'LOW' : null;
export const cloudFrac = (rh, T, cc, altFt) => { if (T < -42) return 0; const band = altFt < 6500 ? cc[0] : altFt < 20000 ? cc[1] : cc[2]; return sstep(82, 100, rh) * (0.3 + 0.7 * Math.min(1, band / 60)); };
export function shearKt1k(col, altFt) { const a = atAlt(col, altFt - 1500), b = atAlt(col, altFt + 1500); if (!a || !b || a.above) return 0; return Math.hypot(b.u - a.u, b.v - a.v) / 3 ; }
export function cloudTopFt(col) { let top = null; for (const l of col.lev) if (l.rh >= 80 && l.T > -42) top = l.z / FT; return top; }
export function modelPrecip(col) { const R = col.precip; if (R < 0.1) return null; const dbz = 10 * Math.log10(200 * Math.pow(R, 1.6)); return { dbz: Math.min(60, dbz), topFt: cloudTopFt(col) || 8000 }; }
// ---------------- aviationweather.gov ----------------
export async function loadStations(ids) { const r = await J('wx/stations?ids=' + ids.join(',')); return new Map(r.map(s => [s.icaoId, { id: s.icaoId, name: s.site, lat: s.lat, lon: s.lon, elev: s.elev * 3.281 }])); }
export async function loadMetars(bb, route) {
  const tiles = [], T = 5; for (let w = bb.w; w < bb.e; w += T) for (let s = bb.s; s < bb.n; s += T) { const t = { w, s, e: Math.min(bb.e, w + T), n: Math.min(bb.n, s + T) }; if (!route || route.some(p => p.lon > t.w - 1 && p.lon < t.e + 1 && p.lat > t.s - 1 && p.lat < t.n + 1)) tiles.push(t); }
  const rs = await Promise.all(tiles.slice(0, 12).map(t => J(`wx/metarbox?s=${t.s.toFixed(2)}&w=${t.w.toFixed(2)}&n=${t.n.toFixed(2)}&e=${t.e.toFixed(2)}`))), seen = new Set(), r = [];
  for (const x of rs.flat()) if (!seen.has(x.icaoId)) { seen.add(x.icaoId); r.push(x); }
  return r.map(m => { const cl = (m.clouds || []).filter(c => c.base != null), ceil = cl.filter(c => c.cover === 'BKN' || c.cover === 'OVC' || c.cover === 'OVX').sort((a, b) => a.base - b.base)[0]; return { id: m.icaoId, lat: m.lat, lon: m.lon, elev: m.elev, cat: m.fltCat || '', vis: m.visib, ceil: ceil ? ceil.base : null, clouds: cl, wx: m.wxString || '', raw: m.rawOb, t: m.obsTime * 1000, temp: m.temp, dewp: m.dewp, wdir: m.wdir, wspd: m.wspd, name: m.name }; });
}
export const loadMetarIds = async ids => (await J('wx/metar?ids=' + ids.join(','))).reduce((m, x) => (m.has(x.icaoId) || m.set(x.icaoId, x), m), new Map());
export const loadTafs = async ids => (await J('wx/taf?ids=' + ids.join(','))).reduce((m, x) => (m.has(x.icaoId) || m.set(x.icaoId, x), m), new Map());
const num = v => v && /^\d+$/.test(String(v)) ? +v * 100 : null;
export async function loadHazards(bb) {
  const st = {}, out = [], run = async (k, f) => { try { const r = await f(); st[k] = { ok: true, n: r }; } catch (e) { st[k] = { ok: false, msg: e.message }; } };
  const inBox = co => co.some(c => c[0] >= bb.w - 3 && c[0] <= bb.e + 3 && c[1] >= bb.s - 3 && c[1] <= bb.n + 3) || (Math.min(...co.map(c => c[0])) <= bb.w && Math.max(...co.map(c => c[0])) >= bb.e);
  await Promise.all([
    run('SIGMET/AIRMET', async () => { const a = await J('wx/airsigmet'); let n = 0; for (const x of a) { const co = (x.coords || []).map(c => [+c.lon, +c.lat]); if (co.length < 4 || !inBox(co)) continue; out.push({ kind: x.airSigmetType, hazard: x.hazard, hi: x.altitudeHi2 || x.altitudeHi1 || 45000, lo: x.altitudeLow1 || x.altitudeLow2 || 0, t0: x.validTimeFrom * 1000, t1: x.validTimeTo * 1000, co, raw: x.rawAirSigmet, sev: x.severity }); n++; } return n; }),
    run('G-AIRMET', async () => { const a = await J('wx/gairmet'); let n = 0; for (const x of a) { if (x.geometryType !== 'AREA') continue; const co = (x.coords || []).map(c => [+c.lon, +c.lat]); if (co.length < 4 || !inBox(co)) continue; const v = Date.parse(x.validTime); out.push({ kind: 'G-AIRMET', hazard: x.hazard, hi: num(x.top) ?? ({ IFR: 10000, MT_OBSC: 14000, LLWS: 2000, SFC_WND: 2000 }[x.hazard] || 18000), lo: x.base === 'FZL' ? 'FZL' : (num(x.base) ?? 0), t0: v - 1.5 * 36e5, t1: v + 1.5 * 36e5, fh: x.forecastHour, co, raw: `G-AIRMET ${x.hazard} ${x.tag || ''} fcst +${x.forecastHour}h valid ${x.validTime}`, tag: x.tag }); n++; } return n; }),
    run('CWA', async () => { const a = await J('wx/cwa'); let n = 0; for (const x of a) { const co = (x.coords || []).map(c => [+c.lon, +c.lat]); if (co.length < 4 || !inBox(co)) continue; out.push({ kind: 'CWA', hazard: x.hazard === 'TS' ? 'CONVECTIVE' : x.hazard === 'TURB' ? 'TURB' : x.hazard === 'ICE' ? 'ICE' : x.hazard, hi: x.top || 45000, lo: x.base || 0, t0: x.validTimeFrom * 1000, t1: x.validTimeTo * 1000, co, raw: x.rawText }); n++; } return n; })]);
  return { items: out, status: st };
}
export async function loadPireps(bb) {
  const r = await J(`wx/pirep?s=${bb.s}&w=${bb.w}&n=${bb.n}&e=${bb.e}&age=6`), out = [];
  for (const p of r) { if (p.lat == null) continue; const ice = p.icgInt1 || '', tb = p.tbInt1 || '', alt = (p.fltLvl ?? (p.icgBas1 ?? p.tbBas1 ?? 0)) * 100; if (!ice && !tb) continue; out.push({ lat: p.lat, lon: p.lon, alt: alt || (p.icgTop1 ? p.icgTop1 * 100 : 0), t: p.obsTime * 1000, ac: p.acType, ice, iceType: p.icgType1, iceBase: p.icgBas1 != null ? p.icgBas1 * 100 : null, iceTop: p.icgTop1 != null ? p.icgTop1 * 100 : null, tb, tbType: p.tbType1, raw: p.rawOb }); }
  return out;
}
