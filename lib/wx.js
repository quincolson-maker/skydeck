// Server-side weather helpers: NOAA MRMS (1 km / 2 min) GRIB2-PNG decoder + crop, Open-Meteo HRRR/GFS batch fetch.
const zlib = require('zlib');
const UA = 'SkyDeck/1.0 (+personal flight planner)';
const BASE = 'https://mrms.ncep.noaa.gov/2D/';
const PRODS = { cref: 'MergedReflectivityQCComposite', et18: 'EchoTop_18', et50: 'EchoTop_50' };
let decodeChain = Promise.resolve();   // MRMS decodes run one at a time (memory)
const listCache = new Map(), rasters = new Map(), crops = new Map(), pend = new Map();
async function get(url, buf) { const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return buf ? Buffer.from(await r.arrayBuffer()) : r.text(); }
async function list(prod) {
  const c = listCache.get(prod); if (c && Date.now() - c.t < 45e3) return c.v;
  const html = await get(BASE + PRODS[prod] + '/'), re = /MRMS_[A-Za-z0-9_.]+?_(\d{8})-(\d{6})\.grib2\.gz/g, out = []; let m; const seen = new Set();
  while ((m = re.exec(html))) { if (seen.has(m[0])) continue; seen.add(m[0]); const d = m[1], t = m[2]; out.push({ name: m[0], t: Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)) }); }
  out.sort((a, b) => a.t - b.t); listCache.set(prod, { t: Date.now(), v: out }); return out;
}
// minimal PNG (16-bit gray, non-interlaced) decoder
async function pngGray16(png) {
  let p = 8, w = 0, h = 0, bd = 0, ct = 0; const idat = [];
  while (p < png.length) { const len = png.readUInt32BE(p), type = png.toString('latin1', p + 4, p + 8); if (type === 'IHDR') { w = png.readUInt32BE(p + 8); h = png.readUInt32BE(p + 12); bd = png[p + 16]; ct = png[p + 17]; } else if (type === 'IDAT') idat.push(png.subarray(p + 8, p + 8 + len)); else if (type === 'IEND') break; p += 12 + len; }
  if (ct !== 0 || (bd !== 16 && bd !== 8)) throw new Error('unsupported PNG ' + bd + '/' + ct);
  const raw = await new Promise((res, rej) => zlib.inflate(Buffer.concat(idat), (e, r) => e ? rej(e) : res(r)));
  const bpp = bd / 8, stride = w * bpp, rs = stride + 1;   // unfilter in place (saves ~50 MB on the 7000x3500 MRMS grid)
  for (let y = 0; y < h; y++) {
    const f = raw[y * rs], o = y * rs + 1, po = o - rs;
    if (f === 1) { for (let i = bpp; i < stride; i++) raw[o + i] = (raw[o + i] + raw[o + i - bpp]) & 255; }
    else if (f === 2) { if (y) for (let i = 0; i < stride; i++) raw[o + i] = (raw[o + i] + raw[po + i]) & 255; }
    else if (f === 3) { for (let i = 0; i < stride; i++) raw[o + i] = (raw[o + i] + (((i >= bpp ? raw[o + i - bpp] : 0) + (y ? raw[po + i] : 0)) >> 1)) & 255; }
    else if (f === 4) { for (let i = 0; i < stride; i++) { const a = i >= bpp ? raw[o + i - bpp] : 0, b = y ? raw[po + i] : 0, c = y && i >= bpp ? raw[po + i - bpp] : 0, pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); raw[o + i] = (raw[o + i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; } }
    if ((y & 127) === 127) await new Promise(r => setImmediate(r));
  }
  const u = new Uint16Array(w * h); for (let y = 0; y < h; y++) { const o = y * rs + 1, r0 = y * w; if (bd === 16) for (let i = 0; i < w; i++) u[r0 + i] = (raw[o + 2 * i] << 8) | raw[o + 2 * i + 1]; else for (let i = 0; i < w; i++) u[r0 + i] = raw[o + i]; }
  return { w, h, u };
}
const sm = (v, bits) => (v & (1 << (bits - 1))) ? -(v & ((1 << (bits - 1)) - 1)) : v;
async function decodeGrib(buf) {
  let pos = 16, g = {}, five = null, png = null;
  while (pos < buf.length - 4) {
    if (buf.toString('latin1', pos, pos + 4) === '7777') break;
    const len = buf.readUInt32BE(pos), sec = buf[pos + 4];
    if (sec === 3) g = { ni: buf.readUInt32BE(pos + 30), nj: buf.readUInt32BE(pos + 34), la1: buf.readInt32BE(pos + 46) / 1e6, lo1: buf.readInt32BE(pos + 50) / 1e6, la2: buf.readInt32BE(pos + 55) / 1e6, lo2: buf.readInt32BE(pos + 59) / 1e6, di: buf.readUInt32BE(pos + 63) / 1e6, dj: buf.readUInt32BE(pos + 67) / 1e6 };
    if (sec === 5) { if (buf.readUInt16BE(pos + 9) !== 41) throw new Error('unsupported GRIB packing'); five = { R: buf.readFloatBE(pos + 11), E: sm(buf.readUInt16BE(pos + 15), 16), D: sm(buf.readUInt16BE(pos + 17), 16) }; }
    if (sec === 7) png = buf.subarray(pos + 5, pos + len);
    pos += len;
  }
  if (!five || !png) throw new Error('bad GRIB');
  const im = await pngGray16(png); if (im.w !== g.ni || im.h !== g.nj) throw new Error('grid mismatch');
  if (g.lo1 > 180) g.lo1 -= 360;
  return { ...g, ...five, u: im.u };
}
async function raster(prod, file) {
  const k = prod + file.name, c = rasters.get(k); if (c) { c.t = Date.now(); return c.r; }
  if (pend.has(k)) return pend.get(k);
  const p = decodeChain = decodeChain.catch(() => { }).then(async () => { const c2 = rasters.get(k); if (c2) return c2.r; const buf = zlib.gunzipSync(await get(BASE + PRODS[prod] + '/' + file.name, true)); const r = await decodeGrib(buf); rasters.set(k, { t: Date.now(), r }); for (const [kk, v] of rasters) if (Date.now() - v.t > 90e3 || rasters.size > 2) rasters.delete(kk); return r; }).finally(() => pend.delete(k));
  pend.set(k, p); return p;
}
// crop + max-pool to <= ~700 cells wide; returns bytes: cref (dBZ+32)*2, echo tops km*10  (0 = none)
async function mrms(prod, w, s, e, n, step, ageMin) {
  if (!PRODS[prod]) throw new Error('bad product');
  const files = await list(prod); if (!files.length) throw new Error('no MRMS files');
  const target = Date.now() - (ageMin || 0) * 60e3; let f = null; for (const x of files) if (x.t <= target) f = x; if (!f) f = files[0];
  const key = [prod, f.name, w, s, e, n, step].join('|'), cc = crops.get(key); if (cc) return cc;
  const r = await raster(prod, f), k = Math.max(1, Math.round(step / r.di));
  const x0 = Math.max(0, Math.floor((w - r.lo1) / r.di)), x1 = Math.min(r.ni, Math.ceil((e - r.lo1) / r.di)), y0 = Math.max(0, Math.floor((r.la1 - n) / r.dj)), y1 = Math.min(r.nj, Math.ceil((r.la1 - s) / r.dj));
  const nx = Math.max(0, Math.floor((x1 - x0) / k)), ny = Math.max(0, Math.floor((y1 - y0) / k)), out = Buffer.alloc(nx * ny), isC = prod === 'cref';
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let mx = 0;
    for (let b = 0; b < k; b++) { const row = (y0 + j * k + b) * r.ni + x0 + i * k; for (let a = 0; a < k; a++) { const v = (r.R + r.u[row + a]) / Math.pow(10, r.D); if (isC) { if (v > -30 && v > mx - 32 * 1) { const q = Math.round((v + 32) * 2); if (q > mx) mx = q; } } else if (v > 0) { const q = Math.round(v * 10); if (q > mx) mx = q; } }
    }
    out[j * nx + i] = Math.min(255, mx);
  }
  const res = { prod, file: f.name, t: f.t, newest: files[files.length - 1].t, w: r.lo1 + x0 * r.di, n: r.la1 - y0 * r.dj, e: r.lo1 + (x0 + nx * k) * r.di, s: r.la1 - (y0 + ny * k) * r.dj, nx, ny, step: k * r.di, enc: isC ? 'cref' : 'et', data: out.toString('base64') };
  crops.set(key, res); setTimeout(() => crops.delete(key), 110e3).unref?.(); if (crops.size > 60) crops.delete(crops.keys().next().value);
  return res;
}
// ---- Open-Meteo HRRR (CONUS 3 km hourly) / GFS fallback, pressure levels
const LEVELS = [1000, 975, 950, 925, 900, 875, 850, 800, 750, 700, 650, 600, 500, 400, 300, 250, 200];
const VARS = []; for (const l of LEVELS) VARS.push(`temperature_${l}hPa`, `relative_humidity_${l}hPa`, `geopotential_height_${l}hPa`, `wind_speed_${l}hPa`, `wind_direction_${l}hPa`);
const SFC = ['freezing_level_height', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'cape', 'visibility', 'precipitation', 'temperature_2m'];
const omCache = new Map();
async function omBatch(pts, model, t0, t1) {
  const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + pts.map(p => p[0].toFixed(3)).join(',') + '&longitude=' + pts.map(p => p[1].toFixed(3)).join(',') + '&hourly=' + [...VARS, ...SFC].join(',') + '&models=' + model + '&start_hour=' + t0 + '&end_hour=' + t1 + '&wind_speed_unit=kn&timezone=GMT';
  const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) { const t = await r.text(); throw Object.assign(new Error('Open-Meteo HTTP ' + r.status + ' ' + t.slice(0, 120)), { status: r.status }); }
  const j = await r.json(); return Array.isArray(j) ? j : [j];
}
async function model(w, s, e, n, nx, ny, t0, hours) {
  nx = Math.max(2, Math.min(9, nx | 0)); ny = Math.max(2, Math.min(9, ny | 0)); hours = Math.max(1, Math.min(30, hours | 0));
  const start = new Date(Math.floor(t0 / 36e5) * 36e5), end = new Date(start.getTime() + (hours - 1) * 36e5), iso = d => d.toISOString().slice(0, 13) + ':00';
  const key = [w, s, e, n, nx, ny, iso(start), hours].join('|'), c = omCache.get(key); if (c && Date.now() - c.t < 30 * 60e3) return c.v;
  if (pend.has(key)) return pend.get(key);
  const p = (async () => {
    const pts = []; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts.push([n - (n - s) * j / (ny - 1), w + (e - w) * i / (nx - 1)]);
    let used = 'gfs_hrrr', rows = [];
    const run = async mdl => { const B = 8, jobs = []; for (let i = 0; i < pts.length; i += B) jobs.push(pts.slice(i, i + B)); const out = new Array(jobs.length); let q = 0; await Promise.all(Array.from({ length: 5 }, async () => { while (q < jobs.length) { const k = q++; out[k] = await omBatch(jobs[k], mdl, iso(start), iso(end)); } })); rows = out.flat(); };
    try { await run('gfs_hrrr'); if (!rows.length || rows.some(r => !r.hourly || r.hourly.temperature_850hPa.every(x => x == null))) throw new Error('outside HRRR'); }
    catch (err) { if (err.status === 429) throw err; used = 'gfs_seamless'; await run('gfs_seamless'); }
    const times = rows[0].hourly.time.map(t => Date.parse(t + 'Z'));
    const q = a => a.map(x => x == null ? null : Math.round(x * 10) / 10);
    const out = { model: used, label: used === 'gfs_hrrr' ? 'NOAA HRRR 3 km (hourly) via Open-Meteo' : 'NOAA GFS 0.25° via Open-Meteo (outside HRRR domain)', fetched: Date.now(), w, s, e, n, nx, ny, levels: LEVELS, times, pts: rows.map(r => ({ lat: r.latitude, lon: r.longitude, elev: r.elevation, v: Object.fromEntries([...VARS, ...SFC].map(k => [k, q(r.hourly[k] || [])])) })) };
    omCache.set(key, { t: Date.now(), v: out }); if (omCache.size > 20) omCache.delete(omCache.keys().next().value); return out;
  })().finally(() => pend.delete(key));
  pend.set(key, p); return p;
}
module.exports = { mrms, list, model, PRODS, LEVELS };
