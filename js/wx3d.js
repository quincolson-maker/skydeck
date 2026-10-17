// 3D weather rendering for Flight Planning: layered, noise-textured translucent volumes (radar + echo tops, clouds, icing, turbulence),
// isotherm surfaces (0 / -10 / -20 °C), animated winds aloft, hazard polygons, PIREP + METAR markers. All geometry derives from real data passed in.
import { scene, viewer, exag } from './globe.js';
import { FT, clamp } from './util.js';
import { atAlt, isoFt, icingScore, cloudFrac, shearKt1k, cloudTopFt, modelPrecip, sstep } from './wxdata.js';
import { infoHooks } from './layers.js';
import { isMobile } from './store.js';
const Cesium = window.Cesium, C = s => Cesium.Color.fromCssColorString(s);
// ---------- noise ----------
const NZ = new Float32Array(65536); { let s = 12345; for (let i = 0; i < NZ.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; NZ[i] = s / 4294967296; } }
const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), x0 = xi & 255, x1 = (xi + 1) & 255, y0 = (yi & 255) << 8, y1 = ((yi + 1) & 255) << 8, a = NZ[y0 | x0], b = NZ[y0 | x1], c = NZ[y1 | x0], d = NZ[y1 | x1]; return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
const fbm = (x, y) => 0.55 * vn(x, y) + 0.3 * vn(2.03 * x + 17, 2.03 * y + 5) + 0.15 * vn(4.1 * x + 3, 4.1 * y + 11);
// ---------- radar colour ramp (NWS-style) ----------
const RAMP = [[5, '#04e9e7'], [12, '#019ff4'], [18, '#0300f4'], [24, '#02fd02'], [30, '#01c501'], [35, '#fdf802'], [40, '#e5bc00'], [45, '#fd9500'], [50, '#fd0000'], [55, '#d40000'], [60, '#f800fd'], [70, '#fdfdfd']];
const LUT = new Uint8Array(256 * 3); { const rgb = RAMP.map(r => { const c = C(r[1]); return [r[0], c.red * 255, c.green * 255, c.blue * 255]; }); for (let i = 0; i < 256; i++) { const d = i / 2 - 32 + 32 * 0; const v = i / 2; let k = 0; while (k < rgb.length - 1 && v > rgb[k + 1][0]) k++; const a = rgb[k], b = rgb[Math.min(k + 1, rgb.length - 1)], t = b[0] === a[0] ? 0 : clamp((v - a[0]) / (b[0] - a[0]), 0, 1); for (let c = 0; c < 3; c++) LUT[i * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * t; } }
export const dbzColor = dbz => { const i = clamp(Math.round(dbz * 2), 0, 255) * 3; return `rgb(${LUT[i]},${LUT[i + 1]},${LUT[i + 2]})`; };
export const W3 = { on: { radar: true, clouds: !isMobile(), icing: true, fzl: true, wind: false, turb: false, haz: true, pirep: true, metar: true }, k: 1, info: new Map(), windFt: 18000, ready: false, stats: {} };
infoHooks.push(id => id.startsWith('pw:') ? W3.info.get(id) || null : null);
let A = null;   // area {bb,W,H,Gx,Gy,mobile,rect}
let V = null;   // volume at current time
const slices = { radar: [], clouds: [], icing: [], turb: [] };
let model = null, radar = null, haz = [], pireps = [], metars = [], sceneT = 0, precip = null, builtT = { v: -1e15, p: -1e15, h: -1e15 };
const grp = { fzl: null, haz: null, pirep: null, metar: null, wind: null };
const ALTS = Array.from({ length: 45 }, (_, i) => i * 1000);
// ---------- volume (model fields on a regular grid at scene time) ----------
function buildVolume(t) {
  const { bb, Gx, Gy } = A, n = Gx * Gy, F = () => ALTS.map(() => new Float32Array(n)), v = { t, T: F(), RH: F(), cf: F(), ice: F(), sh: F(), U: F(), V: F(), fzl: new Float32Array(n), iso10: new Float32Array(n), iso20: new Float32Array(n), dbz: new Float32Array(n), top: new Float32Array(n), cols: [], elev: new Float32Array(n), vis: new Float32Array(n), cape: new Float32Array(n), outT: null };
  for (let j = 0; j < Gy; j++) for (let i = 0; i < Gx; i++) {
    const k = j * Gx + i, lon = bb.w + (bb.e - bb.w) * i / (Gx - 1), lat = bb.n - (bb.n - bb.s) * j / (Gy - 1), col = model.column(lat, lon, t); v.cols[k] = col; v.outT = col.tOut || v.outT; v.elev[k] = col.elev / FT; v.vis[k] = col.vis ?? NaN; v.cape[k] = col.cape;
    const z0 = isoFt(col, 0), z10 = isoFt(col, -10), z20 = isoFt(col, -20); v.fzl[k] = col.fzl != null ? col.fzl / FT : (z0 ?? NaN); v.iso10[k] = z10 ?? NaN; v.iso20[k] = z20 ?? NaN;
    for (let a = 0; a < ALTS.length; a++) { const s = atAlt(col, ALTS[a]); if (!s || s.above || s.ground) { v.T[a][k] = NaN; v.RH[a][k] = 0; continue; } v.T[a][k] = s.T; v.RH[a][k] = s.rh; v.U[a][k] = s.u; v.V[a][k] = s.v; v.cf[a][k] = cloudFrac(s.rh, s.T, col.cc, ALTS[a]); v.ice[a][k] = icingScore(s.T, s.rh); v.sh[a][k] = shearKt1k(col, ALTS[a]); }
    const mp = modelPrecip(col); v.dbz[k] = mp ? mp.dbz : 0; v.top[k] = mp ? mp.topFt : 0;
  }
  return v;
}
const bil = (arr, Gx, Gy, fx, fy) => { fx = clamp(fx, 0, Gx - 1.001); fy = clamp(fy, 0, Gy - 1.001); const i = fx | 0, j = fy | 0, ax = fx - i, ay = fy - j, k = j * Gx + i; return arr[k] * (1 - ax) * (1 - ay) + arr[k + 1] * ax * (1 - ay) + arr[k + Gx] * (1 - ax) * ay + arr[k + Gx + 1] * ax * ay; };
function layerAt(fieldArr, alt) { const a = clamp(alt / 1000, 0, ALTS.length - 1.001), i = a | 0, f = a - i, n = A.Gx * A.Gy, o = new Float32Array(n), p = fieldArr[i], q = fieldArr[i + 1]; for (let k = 0; k < n; k++) { const x = p[k], y = q[k]; o[k] = isNaN(x) ? y : isNaN(y) ? x : x + (y - x) * f; } return o; }
export const volumeAt = (lat, lon, altFt) => { if (!V) return null; const { bb, Gx, Gy } = A, fx = (lon - bb.w) / (bb.e - bb.w) * (Gx - 1), fy = (bb.n - lat) / (bb.n - bb.s) * (Gy - 1); return { T: bilAlt(V.T, fx, fy, altFt), RH: bilAlt(V.RH, fx, fy, altFt), ice: bilAlt(V.ice, fx, fy, altFt), cf: bilAlt(V.cf, fx, fy, altFt), U: bilAlt(V.U, fx, fy, altFt), V: bilAlt(V.V, fx, fy, altFt), sh: bilAlt(V.sh, fx, fy, altFt) }; };
function bilAlt(F, fx, fy, alt) { const a = clamp(alt / 1000, 0, ALTS.length - 1.001), i = a | 0, f = a - i, x = bil(F[i], A.Gx, A.Gy, fx, fy), y = bil(F[i + 1], A.Gx, A.Gy, fx, fy); return isNaN(x) ? y : isNaN(y) ? x : x + (y - x) * f; }
// ---------- precip raster for the canvas grid (radar obs / nowcast / model-derived) ----------
function buildPrecip(t) {
  const { bb, W, H } = A, dbz = new Float32Array(W * H), top = new Float32Array(W * H), top50 = new Float32Array(W * H); let kind = 'none', dt = 0, r = radar ? radar.at(t) : null;
  if (r) { kind = r.kind; dt = r.dt; const R = radar; for (let y = 0; y < H; y++) { const lat = bb.n - (y + .5) / H * (bb.n - bb.s), j = Math.floor((R.n - lat) / R.step); if (j < 0 || j >= R.ny) continue; for (let x = 0; x < W; x++) { const lon = bb.w + (x + .5) / W * (bb.e - bb.w), i = Math.floor((lon - R.w) / R.step); if (i < 0 || i >= R.nx) continue; const k = j * R.nx + i, b = r.dbz[k]; if (b) { dbz[y * W + x] = b / 2 - 32; top[y * W + x] = r.top && r.top[k] ? r.top[k] / 10 * 1000 / FT : 0; top50[y * W + x] = r.top50 && r.top50[k] ? r.top50[k] / 10 * 1000 / FT : 0; } } } }
  else if (V) { kind = 'model'; const { Gx, Gy } = A; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = bil(V.dbz, Gx, Gy, x / (W - 1) * (Gx - 1), y / (H - 1) * (Gy - 1)); if (d > 8) { dbz[y * W + x] = d; top[y * W + x] = bil(V.top, Gx, Gy, x / (W - 1) * (Gx - 1), y / (H - 1) * (Gy - 1)); } } }
  return { dbz, top, top50, kind, dt, t };
}
// ---------- slice primitives ----------
class Slice {
  constructor(alt, set) { this.alt = alt; this.set = set; this.cv = [0, 1].map(() => { const c = document.createElement('canvas'); c.width = A.W; c.height = A.H; return c; }); this.sw = 0; this.img = new ImageData(A.W, A.H); this.mat = Cesium.Material.fromType('Image', { image: this.cv[0], color: new Cesium.Color(1, 1, 1, 1) }); this.prim = null; this.any = false; }
  place() { if (this.prim) scene.primitives.remove(this.prim); const { bb } = A; this.prim = scene.primitives.add(new Cesium.Primitive({ geometryInstances: new Cesium.GeometryInstance({ geometry: new Cesium.RectangleGeometry({ rectangle: Cesium.Rectangle.fromDegrees(bb.w, bb.s, bb.e, bb.n), height: this.alt * FT * W3.k, granularity: Cesium.Math.toRadians(0.4), vertexFormat: Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat }) }), appearance: new Cesium.MaterialAppearance({ material: this.mat, materialSupport: Cesium.MaterialAppearance.MaterialSupport.TEXTURED, flat: true, translucent: true, closed: false, faceForward: false, renderState: { depthTest: { enable: true }, depthMask: false, blending: Cesium.BlendingState.ALPHA_BLEND, cull: { enabled: false } } }), allowPicking: false, asynchronous: false })); this.prim.show = this.any && W3.on[this.set]; }
  paint(fn) { const { W, H } = A, d = this.img.data; d.fill(0); this.any = !!fn(d, W, H); const c = this.cv[1 - this.sw], ctx = c.getContext('2d'); ctx.putImageData(this.img, 0, 0); this.sw = 1 - this.sw; this.mat.uniforms.image = c; if (this.prim) this.prim.show = this.any && W3.on[this.set]; }
  destroy() { if (this.prim) scene.primitives.remove(this.prim); this.prim = null; }
}
const edge = (x, y, W, H) => sstep(0, 1, Math.min(x / (W * 0.08), (W - 1 - x) / (W * 0.08), y / (H * 0.08), (H - 1 - y) / (H * 0.08)));
const wxy = (x, y, seed) => { const { bb, W, H } = A, lat = bb.n - (y + .5) / H * (bb.n - bb.s), lon = bb.w + (x + .5) / W * (bb.e - bb.w), c = Math.cos(lat * Math.PI / 180); return [lon * c * 111 / 9 + seed * 3.7, lat * 111 / 9 + seed * 1.9]; };
function paintRadar(sl) {
  const p = precip; if (!p || p.kind === 'none') return sl.paint(() => false);
  const h = sl.alt, seed = h / 1000; sl.paint((d, W, H) => {
    let any = false;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x, db = p.dbz[k]; if (db < 8) continue; let top = p.top[k]; if (!top) top = 7000 + (db - 8) * 120; if (h > top) continue;
      const fr = h / top, vf = 1 - sstep(0.8, 1, fr), [nx, ny] = wxy(x, y, seed), n = fbm(nx, ny); let dd = db - 14 * fr * fr + (n - 0.5) * 14; if (p.top50[k] && h < p.top50[k]) dd = Math.max(dd, 50 - 8 * (h / p.top50[k]));
      if (dd < 6) continue; const tq = clamp((dd - 8) / 47, 0, 1), a = clamp((0.04 + 0.72 * Math.pow(tq, 1.3)) * vf * (0.65 + 0.7 * n), 0, 0.85); if (a < 0.03) continue; const i = clamp(Math.round(dd * 2), 0, 255) * 3, o = k * 4; d[o] = LUT[i]; d[o + 1] = LUT[i + 1]; d[o + 2] = LUT[i + 2]; d[o + 3] = a * 255; any = true;
    } return any;
  });
}
function paintCloud(sl) {
  if (!V) return sl.paint(() => false); const h = sl.alt, F = layerAt(V.cf, h), { Gx, Gy } = A, seed = h / 1000 + 40, shade = 150 + 95 * Math.min(1, h / 28000);
  sl.paint((d, W, H) => { let any = false; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = bil(F, Gx, Gy, x / (W - 1) * (Gx - 1), y / (H - 1) * (Gy - 1)); if (c < 0.12) continue; const [nx, ny] = wxy(x, y, seed), n = fbm(nx * 1.3, ny * 1.3), a = sstep(0.28, 0.85, c + (n - 0.5) * 0.9) * 0.5 * edge(x, y, W, H); if (a < 0.03) continue; const s = shade - 25 * n, o = (y * W + x) * 4; d[o] = s; d[o + 1] = s + 3; d[o + 2] = s + 8; d[o + 3] = a * 255; any = true; } return any; });
}
function paintIce(sl) {
  if (!V) return sl.paint(() => false); const h = sl.alt, F = layerAt(V.ice, h), { Gx, Gy } = A, seed = h / 1000 + 90;
  sl.paint((d, W, H) => { let any = false; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = bil(F, Gx, Gy, x / (W - 1) * (Gx - 1), y / (H - 1) * (Gy - 1)); if (s < 0.1) continue; const [nx, ny] = wxy(x, y, seed), n = fbm(nx * 1.1, ny * 1.1), a = sstep(0.1, 0.8, s + (n - 0.5) * 0.35) * 0.55 * edge(x, y, W, H); if (a < 0.03) continue; const o = (y * W + x) * 4, t = clamp((s - 0.15) / 0.7, 0, 1); d[o] = 110 + 90 * t; d[o + 1] = 230 - 150 * t; d[o + 2] = 255 - 5 * t; d[o + 3] = a * 255; any = true; } return any; });
}
function paintTurb(sl) {
  if (!V) return sl.paint(() => false); const h = sl.alt, F = layerAt(V.sh, h), { Gx, Gy } = A, seed = h / 1000 + 140;
  sl.paint((d, W, H) => { let any = false; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = bil(F, Gx, Gy, x / (W - 1) * (Gx - 1), y / (H - 1) * (Gy - 1)); if (s < 5) continue; const [nx, ny] = wxy(x, y, seed), n = fbm(nx * 1.6, ny * 1.6), t = clamp((s - 5) / 9, 0, 1), a = sstep(0, 1, t + (n - 0.5) * 0.4) * 0.5 * edge(x, y, W, H); if (a < 0.03) continue; const o = (y * W + x) * 4; d[o] = 255; d[o + 1] = 190 - 150 * t; d[o + 2] = 30; d[o + 3] = a * 255; any = true; } return any; });
}
const PAINT = { radar: paintRadar, clouds: paintCloud, icing: paintIce, turb: paintTurb };
const altSets = mobile => ({ radar: mobile ? [3000, 8000, 14000, 20000, 28000, 36000] : [2000, 4500, 7000, 9500, 12000, 15000, 18000, 21000, 25000, 29000, 33000, 37000, 42000], clouds: mobile ? [3000, 9000, 16000, 24000, 32000] : [1500, 3500, 5500, 7500, 10000, 13000, 16000, 19000, 23000, 27000, 31000, 35000], icing: mobile ? [3000, 6000, 9000, 12000, 16000, 20000] : [1000, 2500, 4000, 5500, 7000, 8500, 10000, 12000, 14000, 16000, 18000, 20000, 22000], turb: mobile ? [8000, 16000, 24000, 32000] : [5000, 8000, 11000, 14000, 17000, 20000, 24000, 28000, 32000, 36000, 40000] });
// ---------- isotherm surfaces ----------
function buildFzl() {
  if (grp.fzl) { scene.primitives.remove(grp.fzl); grp.fzl = null; } if (!V || !W3.on.fzl) return; const { bb, Gx, Gy } = A, inst = [], k = W3.k;
  for (const [arr, col, al] of [[V.fzl, '#9be7ff', 0.17], [V.iso10, '#4f8dff', 0.14], [V.iso20, '#b377ff', 0.14]]) {
    const pos = new Float64Array(Gx * Gy * 3), ok = new Uint8Array(Gx * Gy);
    for (let j = 0; j < Gy; j++) for (let i = 0; i < Gx; i++) { const q = j * Gx + i, ft = arr[q]; ok[q] = isNaN(ft) ? 0 : 1; const c = Cesium.Cartesian3.fromDegrees(bb.w + (bb.e - bb.w) * i / (Gx - 1), bb.n - (bb.n - bb.s) * j / (Gy - 1), (isNaN(ft) ? 0 : ft) * FT * k); pos[q * 3] = c.x; pos[q * 3 + 1] = c.y; pos[q * 3 + 2] = c.z; }
    const idx = []; for (let j = 0; j < Gy - 1; j++) for (let i = 0; i < Gx - 1; i++) { const a = j * Gx + i, b = a + 1, c = a + Gx, d = c + 1; if (ok[a] && ok[b] && ok[c] && ok[d]) idx.push(a, b, c, b, d, c); }
    if (!idx.length) continue;
    inst.push(new Cesium.GeometryInstance({ geometry: new Cesium.Geometry({ attributes: { position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: pos }) }, indices: new Uint16Array(idx), primitiveType: Cesium.PrimitiveType.TRIANGLES, boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(pos)) }), attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(C(col).withAlpha(al)) } }));
  }
  if (inst.length) grp.fzl = scene.primitives.add(new Cesium.Primitive({ geometryInstances: inst, appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true, closed: false, renderState: { depthMask: false, cull: { enabled: false }, depthTest: { enable: true }, blending: Cesium.BlendingState.ALPHA_BLEND } }), allowPicking: false, asynchronous: false }));
}
// ---------- hazard polygons ----------
const HC = { TURB: '#fb923c', 'TURB-HI': '#fb923c', 'TURB-LO': '#fb923c', ICE: '#22d3ee', CONVECTIVE: '#f43f5e', TS: '#f43f5e', IFR: '#94a3b8', MT_OBSC: '#a8a29e', M_FZLVL: '#60a5fa', FZLVL: '#60a5fa', ASH: '#78716c', LLWS: '#facc15', SFC_WND: '#facc15', DS: '#d6a35c', MTW: '#fb923c' };
export const hazardActive = (h, t) => t >= h.t0 && t <= h.t1;
export const hazardLo = (h, lat, lon) => { if (h.lo !== 'FZL') return h.lo; if (!V) return 0; const c = V.cols[Math.round(clamp((A.bb.n - lat) / (A.bb.n - A.bb.s), 0, 1) * (A.Gy - 1)) * A.Gx + Math.round(clamp((lon - A.bb.w) / (A.bb.e - A.bb.w), 0, 1) * (A.Gx - 1))]; return c && c.fzl != null ? c.fzl / FT : 0; };
function buildHaz() {
  if (grp.haz) { for (const p of grp.haz) scene.primitives.remove(p); grp.haz = null; } for (const k of [...W3.info.keys()]) if (k.startsWith('pw:haz')) W3.info.delete(k); if (!W3.on.haz) return;
  const fill = [], edge = [], k = W3.k; let n = 0, seen = new Set();
  for (const h of haz) {
    if (!hazardActive(h, sceneT)) continue; if (h.kind === 'G-AIRMET') { const kk = h.hazard + h.tag + h.lo + h.hi; if (seen.has(kk)) continue; seen.add(kk); }
    const cx = h.co.reduce((s, c) => s + c[0], 0) / h.co.length, cy = h.co.reduce((s, c) => s + c[1], 0) / h.co.length, lo = hazardLo(h, cy, cx) * FT * k, hi = Math.max(h.hi * FT * k, lo + 300), id = 'pw:haz' + n++, col = C(HC[h.hazard] || '#f59e0b');
    W3.info.set(id, `${h.kind} ${h.hazard}${h.sev ? ' · severity ' + h.sev : ''} · ${Math.round(hazardLo(h, cy, cx)).toLocaleString()}–${Math.round(h.hi).toLocaleString()} ft · valid ${new Date(h.t0).toISOString().slice(11, 16)}–${new Date(h.t1).toISOString().slice(11, 16)}Z`);
    try { const hier = new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(h.co.flat())), g = { polygonHierarchy: hier, height: lo, extrudedHeight: hi };
      fill.push(new Cesium.GeometryInstance({ id, geometry: new Cesium.PolygonGeometry({ ...g, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }), attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(col.withAlpha(0.16)) } }));
      edge.push(new Cesium.GeometryInstance({ geometry: new Cesium.PolygonOutlineGeometry(g), attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(col.withAlpha(0.85)) } })); } catch { }
  }
  grp.haz = []; if (fill.length) grp.haz.push(scene.primitives.add(new Cesium.Primitive({ geometryInstances: fill, appearance: new Cesium.PerInstanceColorAppearance({ translucent: true, closed: true, flat: true }), asynchronous: true })));
  if (edge.length) grp.haz.push(scene.primitives.add(new Cesium.Primitive({ geometryInstances: edge, appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true, renderState: { lineWidth: 1 } }), asynchronous: true, allowPicking: false })));
  W3.stats.hazDrawn = n;
}
// ---------- markers ----------
const iconCache = new Map(); const icon = (key, draw) => { if (iconCache.has(key)) return iconCache.get(key); const c = document.createElement('canvas'); c.width = c.height = 40; draw(c.getContext('2d')); iconCache.set(key, c); return c; };
const INT = { NEG: ['#9ca3af', 0], TRC: ['#facc15', 1], LGT: ['#facc15', 1], MOD: ['#fb923c', 2], SEV: ['#ef4444', 3], EXTRM: ['#ef4444', 3] };
const intOf = s => { const u = String(s || '').toUpperCase().split(/[-/]/); return INT[u[u.length - 1]] || ['#facc15', 1]; };
function buildPireps() {
  if (grp.pirep) { scene.primitives.remove(grp.pirep); grp.pirep = null; } for (const k of [...W3.info.keys()]) if (k.startsWith('pw:pirep')) W3.info.delete(k); if (!W3.on.pirep || !pireps.length) return;
  const bc = scene.primitives.add(new Cesium.BillboardCollection({ scene })); grp.pirep = bc;
  pireps.forEach((p, i) => { const ice = !!p.ice, [col] = intOf(ice ? p.ice : p.tb), im = icon((ice ? 'i' : 't') + col, g => { g.fillStyle = 'rgba(0,0,0,.65)'; g.beginPath(); g.arc(20, 20, 17, 0, 7); g.fill(); g.strokeStyle = ice ? '#7fe9ff' : col; g.lineWidth = 3; g.stroke(); g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); if (ice) { for (let a = 0; a < 3; a++) { const r = a * Math.PI / 3; g.moveTo(20 + 10 * Math.cos(r), 20 + 10 * Math.sin(r)); g.lineTo(20 - 10 * Math.cos(r), 20 - 10 * Math.sin(r)); } } else { g.moveTo(9, 16); g.quadraticCurveTo(15, 9, 20, 16); g.quadraticCurveTo(25, 23, 31, 16); g.moveTo(9, 25); g.quadraticCurveTo(15, 18, 20, 25); g.quadraticCurveTo(25, 32, 31, 25); } g.stroke(); }), id = 'pw:pirep' + i;
    W3.info.set(id, `PIREP ${p.ice ? 'ICING ' + p.ice + (p.iceType ? ' ' + p.iceType : '') : 'TURB ' + p.tb + (p.tbType ? ' ' + p.tbType : '')} · ${Math.round(p.alt || 0).toLocaleString()} ft · ${p.ac || ''} · ${Math.round((Date.now() - p.t) / 60000)} min ago · ${p.raw}`);
    bc.add({ id, image: im, position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, (p.alt || 3000) * FT * W3.k), width: 22, height: 22, scaleByDistance: new Cesium.NearFarScalar(2e4, 1.3, 3e6, 0.5), disableDepthTestDistance: 1e7 }); });
}
const CATC = { VFR: '#22c55e', MVFR: '#3b82f6', IFR: '#ef4444', LIFR: '#d946ef' };
function buildMetars() {
  if (grp.metar) { for (const p of grp.metar) scene.primitives.remove(p); grp.metar = null; } for (const k of [...W3.info.keys()]) if (k.startsWith('pw:metar')) W3.info.delete(k); if (!W3.on.metar || !metars.length) return;
  const bc = scene.primitives.add(new Cesium.BillboardCollection({ scene })), lc = scene.primitives.add(new Cesium.LabelCollection({ scene })), pl = scene.primitives.add(new Cesium.PolylineCollection()); grp.metar = [bc, lc, pl];
  metars.forEach((m, i) => { const col = CATC[m.cat] || '#9ca3af', id = 'pw:metar' + i, ground = (m.elev || 0) * W3.k, im = icon('m' + col, g => { g.fillStyle = col; g.beginPath(); g.arc(20, 20, 9, 0, 7); g.fill(); g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 3; g.stroke(); });
    W3.info.set(id, `${m.id} ${m.cat || '?'} · ${m.raw}`); bc.add({ id, image: im, position: Cesium.Cartesian3.fromDegrees(m.lon, m.lat, ground + 40), width: 12, height: 12, disableDepthTestDistance: 5e6, scaleByDistance: new Cesium.NearFarScalar(2e4, 1.4, 4e6, 0.5) });
    lc.add({ text: m.id, position: Cesium.Cartesian3.fromDegrees(m.lon, m.lat, ground + 60), font: '11px Barlow, sans-serif', fillColor: C('#e5e7eb'), outlineColor: C('#000'), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(8, -6), horizontalOrigin: Cesium.HorizontalOrigin.LEFT, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6e5), disableDepthTestDistance: 5e6 });
    if (m.ceil) pl.add({ positions: [Cesium.Cartesian3.fromDegrees(m.lon, m.lat, ground), Cesium.Cartesian3.fromDegrees(m.lon, m.lat, (m.elev + m.ceil) * FT * W3.k)], width: 2, material: Cesium.Material.fromType('Color', { color: C(col).withAlpha(0.7) }) }); });
}
// ---------- winds aloft particles ----------
let wind = null;
function startWind() {
  stopWind(); if (!W3.on.wind || !V) return; const N = A.mobile ? 220 : 700, pc = scene.primitives.add(new Cesium.PointPrimitiveCollection()), { bb } = A, ps = [];
  for (let i = 0; i < N; i++) { const o = { life: Math.random() * 20, tr: [] }; for (let t = 0; t < 3; t++) o.tr.push(pc.add({ position: Cesium.Cartesian3.ZERO, pixelSize: 3 - t * .6, color: Cesium.Color.WHITE.withAlpha(0), disableDepthTestDistance: 0 })); respawn(o); ps.push(o); }
  function respawn(o) { o.lat = bb.s + Math.random() * (bb.n - bb.s); o.lon = bb.w + Math.random() * (bb.e - bb.w); o.hist = [[o.lat, o.lon], [o.lat, o.lon], [o.lat, o.lon]]; o.life = 14 + Math.random() * 14; }
  const tick = () => { if (!V) return; const dt = 0.15, h = W3.windFt * FT * W3.k; for (const o of ps) { const w = volumeAt(o.lat, o.lon, W3.windFt); o.life -= dt; if (!w || o.life <= 0 || o.lat < bb.s || o.lat > bb.n || o.lon < bb.w || o.lon > bb.e) { respawn(o); continue; } const kt = Math.hypot(w.U, w.V), m = 260 * dt * 0.5144; o.lat += w.V * m / 111000; o.lon += w.U * m / (111000 * Math.cos(o.lat * Math.PI / 180)); o.hist.unshift([o.lat, o.lon]); o.hist.length = 3; const c = kt < 40 ? Cesium.Color.lerp(C('#4f8dff'), C('#ffffff'), kt / 40, new Cesium.Color()) : Cesium.Color.lerp(C('#ffffff'), C('#ffd54a'), Math.min(1, (kt - 40) / 60), new Cesium.Color()), fade = Math.min(1, o.life / 2) * Math.min(1, (28 - o.life + 1) / 2); for (let t = 0; t < 3; t++) { const q = o.tr[t]; q.position = Cesium.Cartesian3.fromDegrees(o.hist[t][1], o.hist[t][0], h); q.color = c.withAlpha(0.85 * fade * (1 - t * 0.3)); } } if (scene.requestRenderMode) scene.requestRender(); };
  wind = { pc, timer: setInterval(tick, A.mobile ? 220 : 130) };
}
function stopWind() { if (wind) { clearInterval(wind.timer); scene.primitives.remove(wind.pc); wind = null; } }
// ---------- public API ----------
export function setArea(bb, mobile) {
  clearAll(); const lat = (bb.n + bb.s) / 2, ar = (bb.e - bb.w) * Math.cos(lat * Math.PI / 180) / (bb.n - bb.s), S = mobile ? 256 : 400, Sg = mobile ? 34 : 50, d = (s, ar) => ar >= 1 ? [s, Math.max(48, Math.round(s / ar))] : [Math.max(48, Math.round(s * ar)), s];
  const [W, H] = d(S, ar), [Gx, Gy] = d(Sg, ar).map(v => Math.max(12, v)); A = { bb, W, H, Gx, Gy, mobile }; W3.k = exag(); W3.ready = true;
  const sets = altSets(mobile); for (const key of Object.keys(slices)) slices[key] = sets[key].map(a => new Slice(a, key));
}
export function setData(d) { if ('radar' in d) { radar = d.radar; builtT.p = -1e15; } if ('model' in d) { model = d.model; builtT.v = -1e15; } if (d.haz) haz = d.haz; if (d.pireps) pireps = d.pireps; if (d.metars) metars = d.metars; if (d.haz || d.pireps || d.metars) { buildHaz(); buildPireps(); buildMetars(); } }
export function setTime(t, force) {
  if (!A) return; sceneT = t; let dirty = false;
  if (model && (force || Math.abs(t - builtT.v) >= 8 * 60e3)) { V = buildVolume(t); builtT.v = t; dirty = true; for (const s of slices.clouds) paintCloud(s); for (const s of slices.icing) paintIce(s); for (const s of slices.turb) paintTurb(s); buildFzl(); buildHaz(); if (W3.on.wind && !wind) startWind(); }
  if ((radar || V) && (force || dirty || Math.abs(t - builtT.p) >= 4 * 60e3)) { precip = buildPrecip(t); builtT.p = t; for (const s of slices.radar) paintRadar(s); dirty = true; }
  if (force || Math.abs(t - builtT.h) >= 20 * 60e3) { buildHaz(); builtT.h = t; }
  if (dirty) { for (const key of Object.keys(slices)) for (const s of slices[key]) if (!s.prim) s.place(); else s.prim.show = s.any && W3.on[key]; W3.precip = precip; W3.volume = V; if (scene.requestRenderMode) scene.requestRender(); }
}
export function setLayer(k, v) { W3.on[k] = v; if (slices[k]) for (const s of slices[k]) { if (!s.prim && v && A && (V || precip)) s.place(); if (s.prim) s.prim.show = s.any && v; } if (k === 'fzl') buildFzl(); if (k === 'haz') buildHaz(); if (k === 'pirep') buildPireps(); if (k === 'metar') buildMetars(); if (k === 'wind') v ? startWind() : stopWind(); if ((k === 'clouds' || k === 'icing' || k === 'turb') && v && V) { const f = { clouds: paintCloud, icing: paintIce, turb: paintTurb }[k]; for (const s of slices[k]) { if (!s.prim) s.place(); f(s); } } if (k === 'radar' && v && precip) for (const s of slices.radar) { if (!s.prim) s.place(); s.prim.show = s.any; } if (scene.requestRenderMode) scene.requestRender(); }
export function setWindAlt(ft) { W3.windFt = ft; }
export function rebuildExag() { if (!A) return; W3.k = exag(); for (const key of Object.keys(slices)) for (const s of slices[key]) if (s.prim) s.place(); buildFzl(); buildHaz(); buildPireps(); buildMetars(); }
export function clearAll() { stopWind(); for (const key of Object.keys(slices)) { slices[key].forEach(s => s.destroy()); slices[key] = []; } if (grp.fzl) scene.primitives.remove(grp.fzl); grp.fzl = null; if (grp.haz) for (const p of grp.haz) scene.primitives.remove(p); grp.haz = null; if (grp.pirep) scene.primitives.remove(grp.pirep); grp.pirep = null; if (grp.metar) for (const p of grp.metar) scene.primitives.remove(p); grp.metar = null; V = null; precip = null; model = null; radar = null; haz = []; pireps = []; metars = []; builtT = { v: -1e15, p: -1e15, h: -1e15 }; W3.ready = false; A = null; }
export function hideAll(v) { for (const key of Object.keys(slices)) for (const s of slices[key]) if (s.prim) s.prim.show = !v && s.any && W3.on[key]; for (const g of [grp.fzl, ...(grp.haz || []), grp.pirep, ...(grp.metar || [])]) if (g) g.show = !v; if (v) stopWind(); else if (W3.on.wind) startWind(); if (scene.requestRenderMode) scene.requestRender(); }
export const getVolume = () => V; export const getPrecip = () => precip; export const getArea = () => A;
export function probe(lat, lon, alt) { if (!A || !V) return null; return volumeAt(lat, lon, alt); }
