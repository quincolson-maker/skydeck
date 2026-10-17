// Per-flight replay (scrubber, adjustable speed, 3D aircraft model, optional chase-cam) + Time Travel (tracked aircraft on a past date) + live chase-cam.
import { viewer, scene, camera, exag } from './globe.js';
import { placeAircraft } from './model3d.js';
import { Aircraft3D } from './models.js';
import { loadTraceDay, ais, bboxQ } from './api.js';
import { buildPath, runwayAxis } from './flightpath.js';
import { mergePts, altColor } from './traces.js';
import { FT, rad, deg, bearing, clamp, dayStr, toast } from './util.js';
import { COLORS } from './traffic.js';
import { MINE, state } from './store.js';
const Cesium = window.Cesium;
const state_hi = () => { const q = state.settings.quality || 'auto'; return q === 'high' || (q === 'auto' && !/iPhone|iPad|Android/i.test(navigator.userAgent)); };
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
  toggle() { this.playing = !this.playing; if (this.playing && this.clock >= this.t1) { this.clock = this.t0; this.jumped = true; this.gl = null; } this.ui(); }
  seek(t) { this.clock = clamp(+t || this.t0, this.t0, this.t1); this.jumped = true; this.gl = null; this.update(); this.ui(); }
  startFlight(hex, pts, label) {
    this.stop(); pts = (pts || []).filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.t));
    let P = null; try { P = pts.length >= 2 ? buildPath(pts, { geoidDefault: 30 }) : null; } catch (e) { console.warn('replay buildPath', e); }
    if (!P || !(P.N > 1) || !P.at(P.t0)) { toast(`Not enough usable position data to replay this flight (${pts.length} point${pts.length === 1 ? '' : 's'}).`, 'warn', 6000); this.ui(true); return false; }
    { const r = this.traffic.recs.get(hex)?.a, mine = MINE.find(x => x.hex === hex); this.model.use(r || { reg: mine?.reg, type: /PA-28/.test(mine?.label || '') ? 'P28A' : /PC-12/.test(mine?.label || '') ? 'PC12' : '', gs: 150 }); }
    this.mode = 'flight'; this.tracks = new Map([[hex, pts]]); this.hex = hex; this.label = label; this.t0 = P.t0 * 1000; this.t1 = P.t1 * 1000; this.clock = this.t0; this.playing = true; this.traffic.setFrozen(false); this.pts = pts; this.gl = null; this.cs = null; this.jumped = false;
    this.trail = this.lines.add({ positions: [], width: 4, material: Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString('#7fd6ff') }) });
    this.setPath(P); { const q = P.at(this.t0 / 1000); this.fly(q ? { lon: q.lon, lat: q.lat, alt: q.h / FT, trk: q.hdg } : null); }; this.ui(true);
    const st = P.stats; if (st.cleaned < 25 || st.estPct > 35) toast(`Sparse data: only ${st.cleaned} position reports${st.estPct > 0 ? `, ${Math.round(st.estPct)}% interpolated between real points` : ''} — the replay is approximate.`, 'warn', 7000);
    const tok = this.tok = (this.tok || 0) + 1; this.refine(pts, tok).catch(e => console.warn('replay refine', e)); return true;
  }
  setPath(P) { this.path = P; this.pathInfo = P ? P.stats : null; this.trailPos = null; }
  // second pass: terrain heights at take-off/landing (altitude anchor) + FAA runway centrelines (ground-roll snap)
  async refine(pts, tok) {
    const gp = pts.filter(p => p.gnd), first = pts[0], last = pts[pts.length - 1], dep = gp.find(p => p === first) || gp[0], arr = gp.length ? gp[gp.length - 1] : null, samples = [];
    const step = Math.max(1, Math.ceil(gp.length / 250)); gp.forEach((p, i) => { if (i % step === 0) samples.push(p); }); if (dep) samples.push(dep); if (arr) samples.push(arr);
    const hs = await this.terrainAt(samples.map(p => [p.lat, p.lon])); const grid = samples.map((p, i) => ({ lat: p.lat, lon: p.lon, h: hs[i] })).filter(g => g.h != null);
    const groundFn = (la, lo) => { let b = null, bd = 1e9; for (const g of grid) { const d = (g.lat - la) ** 2 + ((g.lon - lo) * Math.cos(la * Math.PI / 180)) ** 2; if (d < bd) { bd = d; b = g; } } return b && bd < (0.03) ** 2 ? b.h : null; };
    const near = p => p ? { lat: p.lat, lon: p.lon } : null, runways = []; const ends = [dep, arr].filter(Boolean);
    await Promise.all(ends.map(async p => { try { const d = 0.04, j = await ais('Runways', { ...bboxQ(p.lon - d, p.lat - d, p.lon + d, p.lat + d), where: '1=1', outFields: 'DESIGNATOR', resultRecordCount: 60 }); for (const f of j.features || []) { const g = f.geometry, rg = g?.type === 'Polygon' ? g.coordinates[0] : g?.type === 'MultiPolygon' ? g.coordinates[0][0] : null; const a = runwayAxis(rg); if (a) runways.push(a); } } catch (e) { console.warn('runways', e.message); } }));
    if (tok !== this.tok || this.mode !== 'flight') return;
    const dh = dep && grid.length ? groundFn(dep.lat, dep.lon) : null, ah = arr && grid.length ? groundFn(arr.lat, arr.lon) : null;
    const P = buildPath(pts, { ground: { dep: dh, arr: ah }, groundFn: grid.length ? groundFn : null, runways, geoidDefault: 30 }); if (P) { P.stats.runways = runways.length; P.stats.terrainSamples = grid.length; this.setPath(P); }
  }
  async terrainAt(list) {
    const out = list.map(() => null); try { const tp = viewer.terrainProvider; if (tp && !(tp instanceof Cesium.EllipsoidTerrainProvider)) { const lvl = (state_hi() ? 13 : 11), c = list.map(([la, lo]) => Cesium.Cartographic.fromDegrees(lo, la)); const r = await Cesium.sampleTerrain(tp, lvl, c); r.forEach((q, i) => { if (q && isFinite(q.height)) out[i] = q.height; }); } } catch (e) { console.warn('sampleTerrain', e.message); }
    list.forEach(([la, lo], i) => { if (out[i] == null) { const h = scene.globe.getHeight(Cesium.Cartographic.fromDegrees(lo, la)); if (h != null) out[i] = h; } }); return out;
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
  fly(p) { if (!p || ![p.lon, p.lat, p.trk].every(isFinite)) return; const c = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, (p.alt || 0) * FT * exag()); camera.flyToBoundingSphere(new Cesium.BoundingSphere(c, 1), { offset: new Cesium.HeadingPitchRange(rad(p.trk + 180), rad(-25), 2500), duration: 1.5 }); }
  stop() {
    if (this.mode === 'travel') this.traffic.setFrozen(false); this.mode = null; this.playing = false; this.model.show = false; this.mk.forEach(m => { this.bbs.remove(m.bb); this.lbs.remove(m.lb); }); this.mk.clear(); this.lines.removeAll(); this.endChase(); this.tracks.clear(); this.ui(true);
  }
  // chase-cam: camera follows from behind and above
  startChase() { this.chase = true; this.hdg = null; this.cs = null; document.body.classList.add('chasing'); try { window.SkyDeck?.collapseSheet?.(); } catch { } }   // phones: drop the bottom sheet to its peek height so the aircraft isn't behind it
  endChase() { { const r0 = this.followLive && this.traffic.recs.get(this.followLive); if (r0) { this.traffic.style(r0); } } if (this.chase || this.followLive) { camera.lookAtTransform(Cesium.Matrix4.IDENTITY); } if (this.followLive && this.mode !== 'flight') this.model.show = false; this.chase = false; this.followLive = null; document.body.classList.remove('chasing'); }
  startLiveChase(hex) { this.endChase(); this.followLive = hex; this.hdg = null; this.cs = null; this.live = null; this.range = 110; document.body.classList.add('chasing'); }
  // critically-damped chase camera: heading / pitch / range ease with exp smoothing (frame-rate independent); target is the (already smooth) path point; never below terrain
  chaseTo(p, hMeters, hdgU) {
    const fin = Number.isFinite, dt = clamp(this.dtS || 0.016, 0.001, 0.1), target = fin(hdgU) ? hdgU : p.trk;
    if (!fin(p.lat) || !fin(p.lon) || !fin(hMeters) || !fin(target)) return;   // never feed NaN to the camera: keep the last good view
    const tgt = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, hMeters + 3); let cs = this.cs; if (cs && !(fin(cs.hdg) && fin(cs.pitch) && fin(cs.range))) cs = this.cs = null;
    const wrap = d => ((d % 360) + 540) % 360 - 180, ex = w => 1 - Math.exp(-dt * w), sp = clamp(this.speed || 1, 1, 600);
    if (!cs) cs = this.cs = { hdg: target, pitch: rad(-11), range: this.range };
    else if (this.jumped) { cs.hdg = target; this.jumped = false; }   // scrub / restart: snap instead of swinging through the whole turn
    // heading: shortest-angle critically damped follow; the follow rate scales with playback speed (so the camera keeps up at 30x) but the slew rate is capped so it never spins
    const rate = clamp(2.2 * Math.sqrt(sp), 2.2, 9), maxSlew = sp <= 30 ? 140 : sp <= 120 ? 90 : 55;
    let dh = wrap(target - cs.hdg) * ex(rate); dh = clamp(dh, -maxSlew * dt, maxSlew * dt); cs.hdg = wrap(cs.hdg + dh);
    cs.range += (clamp(this.range, 20, 8000) - cs.range) * ex(4); if (!fin(cs.range) || cs.range < 5) cs.range = clamp(this.range, 20, 8000);
    const look = () => camera.lookAt(tgt, new Cesium.HeadingPitchRange(rad(cs.hdg), cs.pitch, cs.range));
    cs.pitch += (rad(-11) - cs.pitch) * ex(cs.pitch < rad(-11) ? 1.5 : 6); look();
    // terrain clearance: look at where the camera actually is now; if it is closer than 14 m to the ground, raise the pitch right away (second pass, no smoothing) so it never sits inside terrain
    for (let i = 0; i < 2; i++) {
      const cam = Cesium.Cartographic.fromCartesian(camera.positionWC), gh = scene.globe.getHeight(new Cesium.Cartographic(cam.longitude, cam.latitude)); if (gh == null || !fin(gh)) break;
      const need = (gh + 14 - (hMeters + 3)) / Math.max(10, cs.range); if (cam.height >= gh + 14 && need <= Math.sin(-cs.pitch)) break;
      cs.pitch = -Math.asin(clamp(Math.max(need, Math.sin(-cs.pitch)), 0.19, 0.97)); look();
    }
    this.frameInView(cs, dt);
  }
  // iPhone: the replay bar and the bottom sheet sit right over the screen centre, which is where lookAt puts the aircraft. Tilt the view a little so the aircraft sits in the middle of the part of the globe that is actually visible.
  frameInView(cs, dt) {
    let shift = 0; const cvh = scene.canvas.clientHeight || 1;
    if (document.body.classList.contains('mobile')) { let vb = cvh; for (const id of ['replaybar', 'side']) { const e = document.getElementById(id); if (e && !e.hidden) { const r = e.getBoundingClientRect(); if (r.height > 0 && r.top > cvh * 0.3) vb = Math.min(vb, r.top); } } const want = (112 + vb) / 2; shift = clamp((cvh / 2 - want) / cvh, 0, 0.45) * (camera.frustum.fovy || 1); }
    cs.shift = Number.isFinite(cs.shift) ? cs.shift + (shift - cs.shift) * (1 - Math.exp(-dt * 6)) : shift; if (cs.shift > 0.002) camera.lookDown(cs.shift);
  }
  // camera heading target: the aircraft's own path heading at normal speeds; at fast-forward (>30x) the direction of travel over the last ~0.8 s of *screen* time (a long chord), so the camera
  // doesn't try to follow every wiggle/turn of the flight at 100x+ (it would orbit); falls back to the path heading when the chord is short (circuits, hover, taxi)
  camHdg(P, q) {
    const sp = this.speed || 1; if (sp <= 30) return q.hdgU; const t = this.clock / 1000, a = P.at(clamp(t - sp * 0.8, P.t0, P.t1)); if (!a) return q.hdgU;
    const dl = (q.lon - a.lon) * Math.cos(rad(q.lat)) * 111320, dn = (q.lat - a.lat) * 110574; if (Math.hypot(dl, dn) < 500) return q.hdgU;
    const chord = (deg(Math.atan2(dl, dn)) + 360) % 360, w = clamp((sp - 30) / 90, 0, 1); return q.hdgU + w * ((((chord - q.hdgU) % 360) + 540) % 360 - 180);
  }
  update() {
    const k = exag();
    if (this.mode === 'flight') {
      const P = this.path; if (!P) return; const q = P.at(clamp(this.clock / 1000, P.t0, P.t1)); if (!q || !Number.isFinite(q.lat + q.lon + q.h + q.hdg + q.pitch + q.bank)) return; let h = q.h * k; const gl = scene.globe.getHeight(Cesium.Cartographic.fromDegrees(q.lon, q.lat));
      if (gl != null) { const g = gl * k; this.gl = this.gl == null ? g : this.gl + (g - this.gl) * Math.min(1, (this.dtS || 0.016) * 8); if (q.gnd) h = this.gl; else h = Math.max(h, this.gl + 1.5); }   // live terrain: never sink / hover on the ground
      const cd = Cesium.Cartesian3.distance(camera.positionWC, Cesium.Cartesian3.fromDegrees(q.lon, q.lat, h)), scale = clamp(cd / 70, 1, 220);
      placeAircraft(this.model, q.lon, q.lat, h, q.hdg, q.pitch, scale, q.bank); this.model.animate?.(performance.now(), { gear: q.gear, gnd: q.gnd, spd: q.spd, vz: q.vz });
      if (!this.trailPos) { const stp = Math.max(1, Math.ceil(P.N / 1500)); this.trailPos = []; for (let n = 0; n < P.N; n += stp) this.trailPos.push([n, Cesium.Cartesian3.fromDegrees(P.lon[n], P.lat[n], Math.max(P.h[n] * k, 2) + 1)]); }
      const fi = this.trailPos.findIndex(x => x[0] > (this.clock / 1000 - P.t0) / P.dt), idx = fi < 0 ? this.trailPos.length : Math.max(2, fi); this.trail.positions = this.trailPos.slice(0, idx).map(x => x[1]);
      this.cur = { lat: q.lat, lon: q.lon, alt: q.h / FT, gs: q.spd / 0.514444, trk: q.hdg, gnd: q.gnd, est: q.est, vr: q.vz * 196.85, pitch: q.pitch, bank: q.bank, gear: q.gear, h }; if (this.chase) this.chaseTo(q, h, this.camHdg(P, q));
    } else if (this.mode === 'travel') {
      for (const [hex, m] of this.mk) { const p = sample(this.tracks.get(hex), this.clock); m.bb.show = m.lb.show = !!p; if (!p) { m.h.status = 'no data at this time'; continue; } const pos = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.gnd ? 0 : Math.max(5, p.alt * FT * k)); m.bb.position = pos; m.bb.rotation = -rad(p.trk); m.bb.heightReference = p.gnd ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE; m.lb.position = pos; m.lb.text = `${m.h.reg || hex}\n${p.gnd ? 'GND' : Math.round(p.alt).toLocaleString() + ' ft'} · ${Math.round(p.gs)} kt${p.gap ? ' (gap)' : ''}`; m.cur = p; }
    }
  }
  frame() {   // an exception inside a Cesium preRender listener stops ALL rendering, so contain it: leave replay/chase and say so instead
    try { this.frame0(); this.errN = 0; } catch (e) { console.warn('replay frame', e); if ((this.errN = (this.errN || 0) + 1) >= 5) { this.errN = 0; try { this.stop(); } catch { } toast('Replay stopped: the camera hit an unexpected error. Try the flight again, or use Replay without chase cam.', 'warn', 8000); } }
  }
  frame0() {
    const n = performance.now(), dt = Math.min(100, n - this.last); this.last = n; this.dtS = dt / 1000;
    if (this.mode && this.playing) { this.clock += dt * this.speed; if (this.clock >= this.t1) { this.clock = this.t1; this.playing = false; this.ui(true); } this.update(); if (n - this._ui > 120) { this._ui = n; this.ui(); } }
    else if (this.mode === 'flight') this.update();
    if (this.followLive) { const r = this.traffic.recs.get(this.followLive); if (r) { const p = this.traffic.posOf(r), a = r.a, dt = this.dtS || 0.016, k = exag(); if (r.bb) r.bb.show = false; this.model.use(a);
      const gl0 = scene.globe.getHeight(Cesium.Cartographic.fromDegrees(p[1], p[0])), hh = a.gnd ? (gl0 != null ? gl0 * k : 0) : Math.max(10, p[2] * FT * k) + 0, L = this.live || (this.live = { hdg: a.trk, pitch: 0, bank: 0 }), ex = w => 1 - Math.exp(-dt * w);
      const dh = ((a.trk - L.hdg + 540) % 360) - 180; L.hdg += dh * ex(1.6); const tgtBank = a.gnd ? 0 : clamp(dh * 0.9, -25, 25), tgtPitch = a.gnd ? 0 : clamp(Math.atan2((a.vr || 0) * FT / 60, Math.max(20, a.gs * 0.514)) * 180 / Math.PI + 2.5, -10, 14); L.bank += (tgtBank - L.bank) * ex(1.2); L.pitch += (tgtPitch - L.pitch) * ex(1.5);
      this.chaseTo({ lat: p[0], lon: p[1], trk: a.trk }, hh, L.hdg); placeAircraft(this.model, p[1], p[0], hh + (gl0 != null && !a.gnd ? Math.max(0, gl0 * k + 2 - hh) : 0), L.hdg, L.pitch, 1, L.bank); this.model.animate?.(performance.now(), { gear: a.gnd || p[2] * FT < 450 ? 1 : 0, gnd: a.gnd, spd: a.gs * 0.514, vz: (a.vr || 0) * FT / 60 }); } }
  }
  ui(force) { document.dispatchEvent(new CustomEvent('replayui', { detail: { force } })); }
}
