// Per-flight replay (scrubber, adjustable speed, 3D aircraft model, optional chase-cam) + Time Travel (tracked aircraft on a past date) + live chase-cam.
import { viewer, scene, camera, exag } from './globe.js';
import { placeAircraft } from './model3d.js';
import { Aircraft3D } from './models.js';
import { loadTraceDay } from './api.js';
import { mergePts, altColor } from './traces.js';
import { FT, rad, deg, bearing, clamp, dayStr, toast } from './util.js';
import { COLORS } from './traffic.js';
import { MINE } from './store.js';
const Cesium = window.Cesium;
export function sample(pts, t) {
  if (!pts.length || t < pts[0].t || t > pts[pts.length - 1].t) return null; let lo = 0, hi = pts.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].t <= t) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t); if (b.t - a.t > 900000) return { ...a, gap: true };
  let dl = b.lon - a.lon; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
  const alt = a.gnd && b.gnd ? 0 : ((a.gnd ? b.alt : a.alt) ?? 0) * (1 - f) + ((b.gnd ? a.alt : b.alt) ?? 0) * f;
  const trk = (Math.hypot(b.lat - a.lat, dl) > 1e-5) ? bearing(a.lat, a.lon, b.lat, b.lon) : a.trk;
  return { t, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + dl * f, alt, gnd: a.gnd && b.gnd, gs: a.gs + (b.gs - a.gs) * f, trk, vr: a.vr };
}
export function segmentFlights(pts) {
  const flights = []; let cur = null; const air = p => !p.gnd && (p.gs > 45 || (p.alt || 0) > 800);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], gap = cur && p.t - cur.pts[cur.pts.length - 1].t > 20 * 60000;
    if (cur && gap) { cur.end = 'gap'; flights.push(cur); cur = null; }
    if (air(p)) { if (!cur) { let j = i; while (j > 0 && pts[j - 1].gnd && p.t - pts[j - 1].t < 180000) j--; cur = { pts: [], start: j < i ? 'ground' : 'airborne-at-first-contact' }; for (let k = j; k < i; k++) cur.pts.push(pts[k]); } cur.pts.push(p); }
    else if (cur) { cur.pts.push(p); if (p.gnd) { cur.end = 'ground'; flights.push(cur); cur = null; } }
  }
  if (cur) { cur.end = cur.end || 'data-end'; flights.push(cur); }
  return flights.filter(f => f.pts.length > 5);
}
export class Replay {
  constructor(traffic) {
    this.traffic = traffic; this.mode = null; this.speed = 30; this.playing = false; this.clock = 0; this.t0 = 0; this.t1 = 0; this.tracks = new Map(); this.chase = false; this.model = new Aircraft3D();
    this.bbs = scene.primitives.add(new Cesium.BillboardCollection({ scene })); this.lbs = scene.primitives.add(new Cesium.LabelCollection({ scene })); this.lines = scene.primitives.add(new Cesium.PolylineCollection()); this.mk = new Map(); this._ui = 0; this.hdg = 0;
    this.icon = traffic.iPlane; this.followLive = null; this.range = 260;
    scene.preRender.addEventListener(() => this.frame());
    scene.canvas.addEventListener('wheel', e => { if (this.chase || this.followLive) { this.range = clamp(this.range * (e.deltaY > 0 ? 1.12 : 0.89), 30, 6000); e.preventDefault(); } }, { passive: false });
    this.last = performance.now();
  }
  get active() { return !!this.mode; }
  setSpeed(s) { this.speed = s; }
  toggle() { this.playing = !this.playing; if (this.playing && this.clock >= this.t1) this.clock = this.t0; this.ui(); }
  seek(t) { this.clock = clamp(t, this.t0, this.t1); this.update(); this.ui(); }
  startFlight(hex, pts, label) {
    this.stop(); { const r = this.traffic.recs.get(hex)?.a, mine = MINE.find(x => x.hex === hex); this.model.use(r || { reg: mine?.reg, type: /PA-28/.test(mine?.label || '') ? 'P28A' : /PC-12/.test(mine?.label || '') ? 'PC12' : '', gs: 150 }); } this.mode = 'flight'; this.tracks = new Map([[hex, pts]]); this.hex = hex; this.label = label; this.t0 = pts[0].t; this.t1 = pts[pts.length - 1].t; this.clock = this.t0; this.playing = true; this.traffic.setFrozen(false); this.range = 260;
    this.trail = this.lines.add({ positions: [], width: 4, material: Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString('#7fd6ff') }) }); this.pts = pts;
    const p = sample(pts, this.t0); this.fly(p); this.ui(true);
  }
  async startTravel(hexes, localDateStr, startHour = 6) {
    this.stop(); this.mode = 'travel'; const [Y, M, D] = localDateStr.split('-').map(Number); const t0 = new Date(Y, M - 1, D, 0, 0, 0).getTime(), t1 = t0 + 86400000;
    const days = [...new Set([dayStr(t0), dayStr(t1 - 1)])]; this.tracks = new Map(); let n = 0;
    await Promise.all(hexes.map(async h => { try { const parts = await Promise.all(days.map(d => loadTraceDay(h.hex, d))); const pts = mergePts(parts.map(p => p.pts)).filter(p => p.t >= t0 - 3600000 && p.t <= t1 + 3600000); if (pts.length) { this.tracks.set(h.hex, pts); n++; } } catch (e) { console.warn(e); } }));
    if (!n) { this.mode = null; toast('No history found for the tracked aircraft on that date (ADS-B Exchange returned nothing, or the proxy is offline).', 'warn', 7000); return false; }
    this.t0 = t0; this.t1 = t1; const firsts = [...this.tracks.values()].map(p => p[0].t).sort((a, b) => a - b); this.clock = clamp(Math.max(t0 + startHour * 3600000, firsts[0] - 600000), t0, t1); this.playing = false; this.traffic.setFrozen(true); this.hexes = hexes;
    for (const h of hexes) if (this.tracks.has(h.hex)) { this.mk.set(h.hex, { bb: this.bbs.add({ image: this.icon, scale: 0.7, color: Cesium.Color.fromCssColorString(COLORS.mine), alignedAxis: Cesium.Cartesian3.UNIT_Z, disableDepthTestDistance: Infinity }), lb: this.lbs.add({ text: h.reg || h.hex, font: '600 12px system-ui', style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, pixelOffset: new Cesium.Cartesian2(14, -4), horizontalOrigin: Cesium.HorizontalOrigin.LEFT, disableDepthTestDistance: Infinity }), h }); }
    this.update(); this.ui(true); return true;
  }
  fly(p) { if (!p) return; const c = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, (p.alt || 0) * FT * exag()); camera.flyToBoundingSphere(new Cesium.BoundingSphere(c, 1), { offset: new Cesium.HeadingPitchRange(rad(p.trk + 180), rad(-25), 2500), duration: 1.5 }); }
  stop() {
    if (this.mode === 'travel') this.traffic.setFrozen(false); this.mode = null; this.playing = false; this.model.show = false; this.mk.forEach(m => { this.bbs.remove(m.bb); this.lbs.remove(m.lb); }); this.mk.clear(); this.lines.removeAll(); this.endChase(); this.tracks.clear(); this.ui(true);
  }
  // chase-cam: camera follows from behind and above
  startChase() { this.chase = true; this.hdg = null; document.body.classList.add('chasing'); }
  endChase() { if (this.chase || this.followLive) { camera.lookAtTransform(Cesium.Matrix4.IDENTITY); } if (this.followLive && this.mode !== 'flight') this.model.show = false; this.chase = false; this.followLive = null; document.body.classList.remove('chasing'); }
  startLiveChase(hex) { this.endChase(); this.followLive = hex; this.hdg = null; this.range = 260; document.body.classList.add('chasing'); }
  chaseTo(p, hMeters) {
    const tgt = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, hMeters); if (this.hdg == null) this.hdg = p.trk; let d = ((p.trk - this.hdg + 540) % 360) - 180; this.hdg += d * 0.08;
    camera.lookAt(tgt, new Cesium.HeadingPitchRange(rad(this.hdg), rad(-11), this.range));
  }
  update() {
    const k = exag();
    if (this.mode === 'flight') {
      const p = sample(this.pts, this.clock); if (!p) return; const h = Math.max(p.gnd ? 0 : 3, (p.alt || 0) * FT * k); const cd = Cesium.Cartesian3.distance(camera.positionWC, Cesium.Cartesian3.fromDegrees(p.lon, p.lat, h));
      const scale = clamp(cd / 70, 1, 220); placeAircraft(this.model, p.lon, p.lat, h + (p.gnd ? 2 * scale : 0), p.trk, clamp((p.vr || 0) / 60, -8, 12) * 0.8, scale);
      let idx = this.pts.findIndex(q => q.t > this.clock); if (idx < 0) idx = this.pts.length; idx = Math.max(2, idx); const seg = this.pts.slice(0, idx); const step = Math.ceil(seg.length / 600);
      this.trail.positions = seg.filter((_, i) => i % step === 0 || i === seg.length - 1).map(q => Cesium.Cartesian3.fromDegrees(q.lon, q.lat, q.gnd ? 4 : Math.max(5, (q.alt || 0) * FT * k)));
      this.cur = p; if (this.chase) this.chaseTo(p, h);
    } else if (this.mode === 'travel') {
      for (const [hex, m] of this.mk) { const p = sample(this.tracks.get(hex), this.clock); m.bb.show = m.lb.show = !!p; if (!p) { m.h.status = 'no data at this time'; continue; } const pos = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.gnd ? 0 : Math.max(5, p.alt * FT * k)); m.bb.position = pos; m.bb.rotation = -rad(p.trk); m.bb.heightReference = p.gnd ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE; m.lb.position = pos; m.lb.text = `${m.h.reg || hex}\n${p.gnd ? 'GND' : Math.round(p.alt).toLocaleString() + ' ft'} · ${Math.round(p.gs)} kt${p.gap ? ' (gap)' : ''}`; m.cur = p; }
    }
  }
  frame() {
    const n = performance.now(), dt = Math.min(100, n - this.last); this.last = n;
    if (this.mode && this.playing) { this.clock += dt * this.speed; if (this.clock >= this.t1) { this.clock = this.t1; this.playing = false; this.ui(true); } this.update(); if (n - this._ui > 120) { this._ui = n; this.ui(); } }
    else if (this.mode === 'flight') this.update();
    if (this.followLive) { const r = this.traffic.recs.get(this.followLive); if (r) { const p = this.traffic.posOf(r); const a = r.a; const hh = a.gnd ? 20 : Math.max(10, p[2] * FT * exag()); this.model.use(a); this.chaseTo({ lat: p[0], lon: p[1], trk: a.trk }, hh); placeAircraft(this.model, p[1] === undefined ? 0 : p[1], p[0], hh + (a.gnd ? 1.5 : 0), a.trk, 0, 1); } }
  }
  ui(force) { document.dispatchEvent(new CustomEvent('replayui', { detail: { force } })); }
}
