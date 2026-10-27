// Traffic layer: BillboardCollection + LabelCollection + PointPrimitiveCollection (no Entities), dead-reckoned between polls,
// throttled updates and label level-of-detail so several thousand aircraft stay smooth.
import { state } from './store.js';
import { viewer, scene, camera, exag } from './globe.js';
import { rad, deg, R_EARTH, KT, FT, clamp, fmtAlt, destPoint } from './util.js';
const Cesium = window.Cesium;
export const COLORS = { com: '#e4ecf7', pvt: '#7ea6d6', mil: '#ff7a59', masked: '#9a8fc0', mine: '#7fd6ff', emg: '#ff3b3b' };
const SC = new Cesium.Cartesian3();
const css = c => Cesium.Color.fromCssColorString(c);
function icon(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.translate(32, 32); g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = 3; g.lineJoin = 'round';
  g.beginPath();
  if (kind === 'heli') { g.ellipse(0, 4, 7, 14, 0, 0, 7); g.rect(-2, 14, 4, 16); g.moveTo(-22, -14); g.lineTo(22, 14); g.moveTo(22, -14); g.lineTo(-22, 14); g.stroke(); g.fill(); g.beginPath(); g.moveTo(-10, 30); g.lineTo(10, 30); g.stroke(); }
  else { g.moveTo(0, -28); g.quadraticCurveTo(4, -22, 4, -10); g.lineTo(27, 6); g.lineTo(27, 11); g.lineTo(4, 3); g.lineTo(3, 18); g.lineTo(11, 25); g.lineTo(11, 29); g.lineTo(0, 26); g.lineTo(-11, 29); g.lineTo(-11, 25); g.lineTo(-3, 18); g.lineTo(-4, 3); g.lineTo(-27, 11); g.lineTo(-27, 6); g.lineTo(-4, -10); g.quadraticCurveTo(-4, -22, 0, -28); g.closePath(); g.stroke(); g.fill(); }
  return c.toDataURL();
}
export class Traffic {
  constructor(onChange) {
    this.recs = new Map(); this.onChange = onChange; this.sel = null; this.hover = null; this.visible = { com: true, pvt: true, mil: true, masked: true };
    this.bbs = scene.primitives.add(new Cesium.BillboardCollection({ scene })); this.labels = scene.primitives.add(new Cesium.LabelCollection({ scene }));
    this.pts = scene.primitives.add(new Cesium.PointPrimitiveCollection()); this.lines = scene.primitives.add(new Cesium.PolylineCollection());
    this.iPlane = icon('plane'); this.iHeli = icon('heli'); this.lbl = new Map(); this.fwd = new Map(); this.watch = new Map(); this.frozen = false;
    this._last = 0; this._lastLod = 0; this._lastFwd = 0; this.tickMs = 100; this.stats = { n: 0, ground: 0 };
    scene.preRender.addEventListener(() => this.frame());
  }
  get size() { return this.recs.size; }
  setWatch(map) { this.watch = map; for (const r of this.recs.values()) this.style(r); }
  colorOf(r) {
    const a = r.a; if (a.emg) return css(COLORS.emg); if (this.watch.has(a.hex)) return css(COLORS.mine);
    if (state.settings.colorBy === 'alt') { const t = a.gnd ? 0 : clamp((a.alt || 0) / 40000, 0, 1); return Cesium.Color.fromHsl(0.38 - 0.38 * t + (t > 0.85 ? 0.83 : 0), 0.85, 0.58); }
    return css(COLORS[a.cat] || COLORS.pvt);
  }
  style(r) {
    const a = r.a, w = this.watch.has(a.hex), b = r.bb; b.color = this.colorOf(r); b.image = a.heli ? this.iHeli : this.iPlane; const s = w || a.emg ? 0.62 : a.heli ? 0.42 : 0.4; b.scale = s;
    b.show = (this.visible[a.cat] !== false || w || a.hex === this.sel) && !this.frozen; b.id = a.hex; b.heightReference = a.gnd ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE;
    b.disableDepthTestDistance = w || a.hex === this.sel ? Number.POSITIVE_INFINITY : 0; b.eyeOffset = new Cesium.Cartesian3(0, 0, w ? -30 : 0);
    b.translucencyByDistance = undefined; b.scaleByDistance = new Cesium.NearFarScalar(2e3, 1.6, 6e6, 0.55);
  }
  // group: 'std' | 'mil' | 'watch' — each poll replaces that group's membership
  ingest(list, group, now = Date.now()) {
    const seen = new Set();
    for (const a of list) {
      seen.add(a.hex); let r = this.recs.get(a.hex);
      if (!r) { r = { a, groups: new Set(), bb: this.bbs.add({ position: Cesium.Cartesian3.ZERO, image: this.iPlane, id: a.hex, alignedAxis: Cesium.Cartesian3.UNIT_Z, verticalOrigin: Cesium.VerticalOrigin.CENTER }), ox: 0, oy: 0, oalt: 0, dl: null, born: now }; this.recs.set(a.hex, r); }
      else if (a.t >= r.a.t || !r.groups.has(group)) {
        // blend: remember where we were drawing it, decay the offset toward the new dead-reckoned position
        if (r.dl) { const p = this.project(a, now); r.ox = r.dl[0] - p[0]; r.oy = r.dl[1] - p[1]; r.oalt = r.dl[2] - p[2]; if (Math.abs(r.ox) + Math.abs(r.oy) > 0.2) { r.ox = r.oy = r.oalt = 0; } }
        r.a = a;
      }
      r.groups.add(group); r.seen = now; this.style(r);
    }
    for (const [hex, r] of this.recs) if (r.groups.has(group) && !seen.has(hex)) { r.groups.delete(group); }
    this.sweep(now); this.dirty = true; this.onChange && this.onChange();
  }
  retag(from, to) { for (const r of this.recs.values()) if (r.groups.delete(from)) r.groups.add(to); }
  sweep(now) { for (const [hex, r] of this.recs) if (!r.groups.size || now - r.seen > 120000) { if (hex === this.sel && r.groups.size) continue; this.bbs.remove(r.bb); this.recs.delete(hex); this.dropLabel(hex); this.dropFwd(hex); } }
  clear() { for (const r of this.recs.values()) this.bbs.remove(r.bb); this.recs.clear(); for (const h of [...this.lbl.keys()]) this.dropLabel(h); for (const h of [...this.fwd.keys()]) this.dropFwd(h); this.sel = null; this.onChange && this.onChange(); }
  setFrozen(f) { this.frozen = f; for (const r of this.recs.values()) this.style(r); }
  // ---- motion ----
  project(a, now) { // returns [dlat, dlon, alt(ft)] extrapolated to `now`
    let dt = clamp((now - a.t) / 1000, 0, 90); if (a.gnd && a.gs < 3) dt = 0;
    const d = a.gs * KT * dt; const lat = a.lat + deg(d * Math.cos(rad(a.trk)) / R_EARTH), lon = a.lon + deg(d * Math.sin(rad(a.trk)) / (R_EARTH * Math.cos(rad(a.lat))));
    return [lat, lon, a.gnd ? 0 : (a.alt ?? 0) + (a.vr || 0) * Math.min(dt, 20) / 60];
  }
  posOf(r, now = Date.now()) { const p = this.project(r.a, now); const k = r.dl ? 1 : 0; return [p[0] + r.oy, p[1] + r.ox, p[2] + r.oalt]; }
  frame() {
    const now = performance.now(); if (now - this._last < this.tickMs) return; this._last = now; const t = Date.now(), k = exag(); const decay = Math.exp(-this.tickMs / 1200);
    this.tickMs = (this.recs.size > 4000 ? 200 : this.recs.size > 1500 ? 140 : 90) + (document.body.classList.contains('mobile') ? 60 : 0);
    let g = 0;
    for (const r of this.recs.values()) {
      const a = r.a; if (this.frozen) continue; const p = this.project(a, t);
      const lat = p[0] + r.oy, lon = p[1] + r.ox, alt = p[2] + r.oalt; r.ox *= decay; r.oy *= decay; r.oalt *= decay; r.dl = [lat, lon, alt];
      const b = r.bb; if (!b.show) continue;
      Cesium.Cartesian3.fromRadians(rad(lon), rad(lat), a.gnd ? 0 : Math.max(0, alt * FT * k), undefined, SC); b.position = SC; b.rotation = -rad(a.trk); if (a.gnd) g++;
    }
    this.stats = { n: this.recs.size, ground: g }; this.syncLabels();
    if (now - this._lastLod > 450) { this._lastLod = now; this.lod(t); }
    if (now - this._lastFwd > 500) { this._lastFwd = now; this.updateFwd(t); }
  }
  // ---- label LOD: only watched/selected/hovered + nearest few when zoomed in ----
  lod(t) {
    const camH = Cesium.Cartographic.fromCartesian(camera.positionWC).height; const want = new Map();
    if (state.settings.labels) {
      for (const [hex, r] of this.recs) if (r.bb.show && (this.watch.has(hex) || hex === this.sel || hex === this.hover)) want.set(hex, r);
      if (camH < 900000) { // nearest-to-screen-centre candidates
        const cv = scene.canvas, cx = cv.clientWidth / 2, cy = cv.clientHeight / 2, cand = []; const mob = document.body.classList.contains('mobile'), max = (camH < 80000 ? 70 : camH < 300000 ? 40 : 18) >> (mob ? 1 : 0);
        for (const [hex, r] of this.recs) { if (want.has(hex) || !r.bb.show) continue; const sp = Cesium.SceneTransforms.worldToWindowCoordinates(scene, r.bb.position, new Cesium.Cartesian2()); if (!sp || sp.x < 0 || sp.y < 0 || sp.x > cv.clientWidth || sp.y > cv.clientHeight) continue; cand.push([(sp.x - cx) ** 2 + (sp.y - cy) ** 2, hex, r]); }
        cand.sort((a, b) => a[0] - b[0]); for (const c of cand.slice(0, max)) want.set(c[1], c[2]);
      }
    }
    for (const hex of [...this.lbl.keys()]) if (!want.has(hex)) this.dropLabel(hex);
    for (const [hex, r] of want) {
      const a = r.a, text = `${a.fl || a.reg || a.hex.toUpperCase()}\n${a.gnd ? 'GND' : fmtAlt(a.alt)}${a.gs ? ' · ' + Math.round(a.gs) + ' kt' : ''}`; let l = this.lbl.get(hex);
      if (!l) { l = this.labels.add({ text, font: '600 12px system-ui,sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK.withAlpha(.85), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(14, -4), horizontalOrigin: Cesium.HorizontalOrigin.LEFT, disableDepthTestDistance: this.watch.has(hex) ? Infinity : 0, translucencyByDistance: new Cesium.NearFarScalar(1e5, 1, 2e6, 0.0) }); this.lbl.set(hex, l); }
      if (l.text !== text) l.text = text; l.fillColor = this.watch.has(hex) ? css(COLORS.mine) : Cesium.Color.WHITE; l.position = r.bb.position;
    }
  }
  dropLabel(hex) { const l = this.lbl.get(hex); if (l) { this.labels.remove(l); this.lbl.delete(hex); } }
  // labels track the dead-reckoned billboard positions each tick
  syncLabels() { for (const [hex, l] of this.lbl) { const r = this.recs.get(hex); if (r) l.position = r.bb.position; } }
  // ---- forward-position markers (+1/+2/+5 min along current track & climb rate) ----
  updateFwd(t) {
    const hexes = new Set(); if (state.settings.fwdAll) { let n = 0; for (const [h, r] of this.recs) { if (r.bb.show && !r.a.gnd && r.a.gs > 60 && n < 300) { hexes.add(h); n++; } } }
    for (const h of this.watch.keys()) if (this.recs.has(h)) hexes.add(h); if (this.sel) hexes.add(this.sel); if (this.hover) hexes.add(this.hover);
    for (const h of [...this.fwd.keys()]) if (!hexes.has(h)) this.dropFwd(h); const k = exag();
    for (const h of hexes) {
      const r = this.recs.get(h); if (!r || r.a.gnd || r.a.gs < 30) { this.dropFwd(h); continue; } const a = r.a, cur = r.dl || this.project(a, t); const col = css(this.watch.has(h) ? COLORS.mine : COLORS[a.cat] || '#fff');
      const pos = [Cesium.Cartesian3.fromDegrees(cur[1], cur[0], Math.max(0, cur[2] * FT * k))], dots = [];
      for (const m of [1, 2, 5]) { const [la, lo] = destPoint(cur[0], cur[1], a.trk, a.gs * KT * m * 60); const hh = Math.max(0, (cur[2] + (a.vr || 0) * m) * FT * k); const p = Cesium.Cartesian3.fromDegrees(lo, la, hh); pos.push(p); dots.push(p); }
      let f = this.fwd.get(h); if (!f) { f = { line: this.lines.add({ positions: pos, width: 1.5, material: Cesium.Material.fromType('PolylineDash', { color: col.withAlpha(.8), dashLength: 12 }) }), dots: dots.map(p => this.pts.add({ position: p, pixelSize: 6, color: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 })) }; this.fwd.set(h, f); }
      else { f.line.positions = pos; f.dots.forEach((d, i) => { d.position = dots[i]; d.color = col; }); }
    }
  }
  dropFwd(h) { const f = this.fwd.get(h); if (f) { this.lines.remove(f.line); f.dots.forEach(d => this.pts.remove(d)); this.fwd.delete(h); } }
  // ---- queries ----
  get(hex) { return this.recs.get(hex)?.a; }
  find(q) { q = q.trim().toLowerCase(); if (!q) return []; const out = []; for (const r of this.recs.values()) { const a = r.a; if (a.hex.includes(q) || a.fl.toLowerCase().includes(q) || a.reg.toLowerCase().includes(q) || a.type.toLowerCase() === q) { out.push(a); if (out.length > 60) break; } } return out; }
  all() { return [...this.recs.values()].map(r => r.a); }
  pick(pos) { const p = scene.pick(pos); return p && p.primitive && typeof p.id === 'string' && this.recs.has(p.id) ? p.id : null; }
  setSelected(hex) { const old = this.sel; this.sel = hex; for (const h of [old, hex]) if (h && this.recs.has(h)) this.style(this.recs.get(h)); this.dirty = true; }
  position(hex) { const r = this.recs.get(hex); return r ? this.posOf(r) : null; }
}
