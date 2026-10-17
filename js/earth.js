// Earth detail: OSM 3D buildings (footprints extruded around the camera at low altitude) and runway markings (threshold bars, dashed centreline, designators).
import { scene, viewer, exag, cameraInfo } from './globe.js';
import { API } from './api.js';
import { state, isMobile } from './store.js';
const Cesium = window.Cesium, C = s => Cesium.Color.fromCssColorString(s);
export const qualityHigh = () => { const q = state.settings.quality || 'auto'; return q === 'high' || (q === 'auto' && !isMobile()); };
// ---------------- buildings ----------------
const TW = 0.04, TH = 0.03;   // tile size (deg lon / lat)
export const buildings = {
  on: false, tiles: new Map(), busy: 0, lastKey: '', msg: '', n: 0,
  toggle(v) { this.on = v; state.settings.buildings = v; if (!v) for (const t of this.tiles.values()) { if (t.prim) t.prim.show = false; } else this.update(); document.dispatchEvent(new CustomEvent('layerstatus', { detail: { k: 'bld', ok: true, msg: v ? 'Zoom in below ~' + Math.round(this.limit() / 1000) + ' km altitude to load OSM buildings' : 'off' } })); },
  limit() { return qualityHigh() ? 9000 : 4500; },
  update() {
    if (!this.on || !API.proxy) return; const ci = cameraInfo(), c = ci.ctr; if (!c || ci.h > this.limit()) { for (const t of this.tiles.values()) if (t.prim) t.prim.show = false; return; }
    const ti = Math.floor(c.lon / TW), tj = Math.floor(c.lat / TH), want = new Set(); const R = ci.h > 4000 ? 2 : 1;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) want.add((ti + di) + '_' + (tj + dj));
    for (const [k, t] of this.tiles) if (t.prim) t.prim.show = want.has(k) && t.ok;
    for (const k of want) { if (this.tiles.has(k) || this.busy >= 3) continue; this.load(k); }
    if (this.tiles.size > 36) for (const [k, t] of this.tiles) { if (!want.has(k) && this.tiles.size > 30) { if (t.prim) scene.primitives.remove(t.prim); this.tiles.delete(k); } }
  },
  async load(k) {
    const [i, j] = k.split('_').map(Number), t = { ok: false, prim: null, tries: 0 }; this.tiles.set(k, t); this.busy++;
    try {
      const w = i * TW, s = j * TH, r = await fetch(`${API.base}api/osm/buildings?s=${s.toFixed(4)}&w=${w.toFixed(4)}&n=${(s + TH).toFixed(4)}&e=${(w + TW).toFixed(4)}`); if (!r.ok) throw new Error('HTTP ' + r.status);
      t.data = (await r.json()).b; t.ok = true; this.build(t); this.msg = ''; 
    } catch (e) { this.tiles.delete(k); this.msg = 'OSM buildings unavailable: ' + e.message; document.dispatchEvent(new CustomEvent('layerstatus', { detail: { k: 'bld', ok: false, msg: this.msg } })); }
    this.busy--;
  },
  build(t) {
    if (t.prim) { scene.primitives.remove(t.prim); t.prim = null; } if (!t.data || !t.data.length) return; const k = exag(), inst = [], pts = [];
    const bs = t.data.slice().sort((a, b) => b[1].length - a[1].length).slice(0, qualityHigh() ? 1400 : 350);
    for (const [h, ring] of bs) { let cx = 0, cy = 0; const n = ring.length / 2; for (let q = 0; q < ring.length; q += 2) { cx += ring[q]; cy += ring[q + 1]; } cx /= n; cy /= n; const g = scene.globe.getHeight(new Cesium.Cartographic(Cesium.Math.toRadians(cx), Cesium.Math.toRadians(cy))); pts.push(g); }
    const known = pts.filter(v => v != null).sort((a, b) => a - b); if (!known.length) { if (t.tries++ < 4) setTimeout(() => this.build(t), 2500); return; } const med = known[known.length >> 1];
    bs.forEach(([h, ring], q) => {
      const base = (pts[q] ?? med) * k - 1, tone = Math.min(1, h / 30), col = Cesium.Color.fromHsl(0.6, 0.05, 0.5 + 0.2 * tone).withAlpha(1);
      try { inst.push(new Cesium.GeometryInstance({ geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring.slice(0, ring.length - 2))), height: base, extrudedHeight: base + h * k + 1, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }), attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(col) } })); } catch { }
    });
    if (inst.length) { t.prim = scene.primitives.add(new Cesium.Primitive({ geometryInstances: inst, appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: true }), asynchronous: true, allowPicking: false })); this.n += inst.length; }
  },
  rebuild() { for (const t of this.tiles.values()) if (t.ok) this.build(t); }
};
// ---------------- runway markings ----------------
const M_LAT = 111320;
export function runwayMarkings(rings, lat0) {   // rings: [{ring:[[lon,lat]...], des:'17/35'}] -> {instances, labels}
  const inst = [], labels = [], col = Cesium.ColorGeometryInstanceAttribute.fromColor(C('#ffffff').withAlpha(0.95));
  const quad = (lon, lat, ux, uy, vx, vy, hl, hw) => { const q = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([a, b]) => { const mx = ux * a + vx * b, my = uy * a + vy * b; return [lon + mx / (M_LAT * Math.cos(lat * Math.PI / 180)), lat + my / M_LAT]; }); return new Cesium.GeometryInstance({ geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(q.flat())), vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }), attributes: { color: col } }); };
  for (const { ring, des } of rings) {
    if (!ring || ring.length < 4) continue; const p = ring.slice(0, 4), cl = Math.cos(p[0][1] * Math.PI / 180), m = ([lo, la]) => [lo * M_LAT * cl, la * M_LAT], P = p.map(m), d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const long01 = d(P[0], P[1]) >= d(P[1], P[2]); const a0 = long01 ? [(P[1][0] + P[2][0]) / 2, (P[1][1] + P[2][1]) / 2] : [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2], a1 = long01 ? [(P[3][0] + P[0][0]) / 2, (P[3][1] + P[0][1]) / 2] : [(P[2][0] + P[3][0]) / 2, (P[2][1] + P[3][1]) / 2];
    const L = d(a0, a1), W = long01 ? d(P[1], P[2]) : d(P[0], P[1]); if (L < 450 || W < 8 || L / W < 5) continue; const ux = (a1[0] - a0[0]) / L, uy = (a1[1] - a0[1]) / L, vx = -uy, vy = ux, at = s => [a0[0] + ux * s, a0[1] + uy * s], toLL = ([x, y]) => [x / (M_LAT * cl), y / M_LAT];
    // dashed centreline
    for (let s = 40; s < L - 60; s += 50) { const c = toLL(at(s + 15)); inst.push(quad(c[0], c[1], ux, uy, vx, vy, 15, 0.45)); }
    // threshold bars at both ends
    const n = W > 30 ? 8 : W > 20 ? 6 : 4, span = W * 0.72, step = span / (n - 1);
    for (const [s0, dir] of [[8, 1], [L - 8, -1]]) for (let i = 0; i < n; i++) { const off = -span / 2 + i * step; if (Math.abs(off) < 1.2) continue; const c = toLL([at(s0 + dir * 15)[0] + vx * off, at(s0 + dir * 15)[1] + vy * off]); inst.push(quad(c[0], c[1], ux, uy, vx, vy, 15, 0.9)); }
    // edge lines
    for (const side of [-1, 1]) { const c = toLL([at(L / 2)[0] + vx * side * (W / 2 - 1.2), at(L / 2)[1] + vy * side * (W / 2 - 1.2)]); inst.push(quad(c[0], c[1], ux, uy, vx, vy, L / 2 - 10, 0.35)); }
    const ds = String(des || '').split('/'), e0 = toLL(at(60)), e1 = toLL(at(L - 60)); if (ds.length === 2) { labels.push({ lon: e0[0], lat: e0[1], text: ds[0].trim() }, { lon: e1[0], lat: e1[1], text: ds[1].trim() }); }
  }
  return { inst, labels };
}
export function initEarth() {
  buildings.on = state.settings.buildings ?? true;
  let t = 0; scene.camera.moveEnd.addEventListener(() => buildings.update()); setInterval(() => { if (buildings.on && performance.now() - t > 1500) { t = performance.now(); buildings.update(); } }, 2500);
}
