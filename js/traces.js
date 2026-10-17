// 24-hour traces (ADS-B Exchange trace files through the proxy; best effort) drawn as altitude-coloured polylines (Primitive-based).
import { loadTraceDay, loadTraceRecent, API } from './api.js';
import { viewer, scene, exag } from './globe.js';
import { dayStr, FT, toast, fmtAge } from './util.js';
import { idbGet, idbSet } from './store.js';
const Cesium = window.Cesium;
const RAMP = [[0, [112, 130, 156]], [8000, [86, 160, 255]], [22000, [150, 222, 255]], [40000, [255, 255, 255]]];   // slate -> blue -> ice -> white (readable on a dark globe)
export const altColor = (alt, a = 1) => { alt = Math.max(0, alt || 0); let i = 1; while (i < RAMP.length - 1 && alt > RAMP[i][0]) i++; const [a0, c0] = RAMP[i - 1], [a1, c1] = RAMP[i], f = Math.min(1, Math.max(0, (alt - a0) / (a1 - a0))); return new Cesium.Color((c0[0] + (c1[0] - c0[0]) * f) / 255, (c0[1] + (c1[1] - c0[1]) * f) / 255, (c0[2] + (c1[2] - c0[2]) * f) / 255, a); };
export function mergePts(arrs) { const all = arrs.flat().sort((a, b) => a.t - b.t); const out = []; let last = -1; for (const p of all) { if (p.t === last) continue; last = p.t; out.push(p); } return out; }
export async function trace24h(hex) {
  const now = Date.now(); const days = [dayStr(now - 86400000), dayStr(now)]; const res = [], notes = [];
  for (const d of days) { try { const t = await loadTraceDay(hex, d); if (t.pts.length) res.push(t.pts); } catch (e) { notes.push(e.message); } }
  let pts = mergePts(res).filter(p => p.t >= now - 86400000);
  if (!pts.length) { try { const t = await loadTraceRecent(hex); pts = t.pts.filter(p => p.t >= now - 86400000); } catch (e) { notes.push(e.message); } }
  return { pts, notes };
}
export class Traces {
  constructor() { this.data = new Map(); this.shown = new Map(); this.src = new Map(); this._rebuildT = 0; }
  has(hex) { return this.shown.has(hex); }
  async show(hex, label) {
    if (this.shown.has(hex)) return; this.shown.set(hex, { prims: [] });
    let d = this.data.get(hex), note = '';
    if (!d) {
      try { const r = await trace24h(hex); d = r.pts; if (d.length) idbSet('trace:' + hex, { t: Date.now(), pts: d.slice(-30000) }); else throw new Error(r.notes[0] || 'empty'); this.src.set(hex, 'live'); }
      catch (e) { const c = await idbGet('trace:' + hex); if (c && c.pts.length) { d = c.pts; this.src.set(hex, 'cached'); note = ` (offline cache from ${fmtAge((Date.now() - c.t) / 1000)})`; } else { d = []; this.src.set(hex, 'none'); } }
      this.data.set(hex, d);
    }
    if (!d.length) { this.shown.delete(hex); toast(`No 24 h trace available for ${label || hex.toUpperCase()} — ADS-B Exchange returned nothing (aircraft not seen in the last 24 h, or the proxy/source is unreachable).`, 'warn', 7000); return; }
    if (note) toast(`Showing cached trace for ${label || hex}${note}`, 'warn');
    await this.draw(hex);
  }
  hide(hex) { const s = this.shown.get(hex); if (!s) return; s.prims.forEach(p => { try { p.show = false; scene.primitives.remove(p); } catch {} }); this.shown.delete(hex); }
  clear() { for (const h of [...this.shown.keys()]) this.hide(h); this.data.clear(); }
  push(hex, a) { const d = this.data.get(hex); if (!d || !d.length) return; const l = d[d.length - 1]; if (a.t <= l.t || (Math.abs(l.lat - a.lat) < 2e-4 && Math.abs(l.lon - a.lon) < 2e-4)) return; d.push({ t: a.t, lat: a.lat, lon: a.lon, alt: a.gnd ? 0 : a.alt, gnd: a.gnd, gs: a.gs, trk: a.trk, vr: a.vr }); this.scheduleRebuild(); }
  scheduleRebuild() { clearTimeout(this._rebuildT); this._rebuildT = setTimeout(() => { for (const h of this.shown.keys()) this.draw(h); }, 12000); }
  async draw(hex) {
    const s = this.shown.get(hex); if (!s) return; const d = this.data.get(hex) || [], k = exag();
    s.prims.forEach(p => scene.primitives.remove(p)); s.prims = [];
    // split into runs: break on gaps >10 min; airborne vs ground
    const runs = []; let cur = null;
    for (const p of d) { const g = p.gnd; if (!cur || p.t - cur.last > 600000 || cur.gnd !== g) { const prev = cur; cur = { gnd: g, pts: [], last: p.t }; if (prev && p.t - prev.last <= 600000) cur.pts.push(prev.pts[prev.pts.length - 1]); runs.push(cur); } cur.pts.push(p); cur.last = p.t; }
    // terrain height for ground points adjacent to airborne runs
    const adj = []; for (const r of runs) if (!r.gnd) for (const i of [0, r.pts.length - 1]) if (r.pts[i].gnd) adj.push(r.pts[i]);
    let hs = adj.map(() => 0); try { if (adj.length && viewer.terrainProvider && !(viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider)) { const c = adj.map(p => Cesium.Cartographic.fromDegrees(p.lon, p.lat)); const out = await Cesium.sampleTerrain(viewer.terrainProvider, 11, c); hs = out.map(x => x.height || 0); } } catch {}
    adj.forEach((p, i) => p._h = hs[i] + 3);
    const air = [], gnd = [];
    for (const r of runs) {
      if (r.pts.length < 2) continue;
      if (r.gnd) { const pos = r.pts.map(p => [p.lon, p.lat]).flat(); gnd.push(new Cesium.GeometryInstance({ geometry: new Cesium.GroundPolylineGeometry({ positions: Cesium.Cartesian3.fromDegreesArray(pos), width: 4 }), attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#cbd5e1').withAlpha(.9)) } })); continue; }
      const pos = r.pts.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.gnd ? (p._h ?? 3) : Math.max(5, (p.alt || 0) * FT * k))); const cols = r.pts.map(p => altColor(p.gnd ? 0 : p.alt));
      air.push(new Cesium.GeometryInstance({ geometry: new Cesium.PolylineGeometry({ positions: pos, colors: cols, colorsPerVertex: true, width: 3.5, vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT, arcType: Cesium.ArcType.NONE }) }));
    }
    if (!this.shown.has(hex)) return;
    if (air.length) s.prims.push(scene.primitives.add(new Cesium.Primitive({ geometryInstances: air, appearance: new Cesium.PolylineColorAppearance({ translucent: false }), asynchronous: true, allowPicking: false })));
    if (gnd.length) s.prims.push(scene.primitives.add(new Cesium.GroundPolylinePrimitive({ geometryInstances: gnd, appearance: new Cesium.PolylineColorAppearance({ translucent: true }), asynchronous: true, allowPicking: false })));
  }
  redrawAll() { for (const h of this.shown.keys()) this.draw(h); }
  bounds(hex) { const d = this.data.get(hex); if (!d?.length) return null; let w = 180, e = -180, s = 90, n = -90; for (const p of d) { w = Math.min(w, p.lon); e = Math.max(e, p.lon); s = Math.min(s, p.lat); n = Math.max(n, p.lat); } return { w, e, s, n }; }
}
