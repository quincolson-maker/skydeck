// Map layers: 3D airspace (FAA AIS), runways + heliports + airports (FAA AIS), 3D TFRs, 3D AIRMET/SIGMET, animated radar.
import { ais, bboxQ, proxied, API } from './api.js';
import { viewer, scene, camera, exag, viewRect, cameraInfo } from './globe.js';
import { FT, toast, clamp, esc, fmtAlt } from './util.js';
import { state } from './store.js';
const Cesium = window.Cesium, C = s => Cesium.Color.fromCssColorString(s);
const ringsOf = g => !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
const flat = ring => ring.map(c => [c[0], c[1]]).flat();
export const status = {};            // layer -> {ok, msg}
const setStatus = (k, ok, msg) => { status[k] = { ok, msg }; document.dispatchEvent(new CustomEvent('layerstatus', { detail: { k, ok, msg } })); };
function extrudedPrimitive(items) {  // items: [{rings, lo, hi, color, edge, id}] heights in metres (already exaggerated)
  const fill = [], edges = [];
  for (const it of items) for (const ring of it.rings) {
    const pos = Cesium.Cartesian3.fromDegreesArray(flat(ring[0])); if (pos.length < 3) continue; const holes = ring.slice(1).map(h => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat(h))));
    const g = { polygonHierarchy: new Cesium.PolygonHierarchy(pos, holes), height: it.lo, extrudedHeight: Math.max(it.hi, it.lo + 30), perPositionHeight: false };
    try {
      fill.push(new Cesium.GeometryInstance({ id: it.id, geometry: new Cesium.PolygonGeometry({ ...g, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }), attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(it.color) } }));
      edges.push(new Cesium.GeometryInstance({ geometry: new Cesium.PolygonOutlineGeometry(g), attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(it.edge) } }));
    } catch (e) { /* degenerate polygon */ }
  }
  const out = [];
  if (fill.length) out.push(new Cesium.Primitive({ geometryInstances: fill, appearance: new Cesium.PerInstanceColorAppearance({ translucent: true, closed: true, flat: true }), asynchronous: true, releaseGeometryInstances: false }));
  if (edges.length) out.push(new Cesium.Primitive({ geometryInstances: edges, appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true, renderState: { lineWidth: 1 } }), asynchronous: true, allowPicking: false }));
  return out;
}
class Group { constructor() { this.prims = []; } set(ps) { this.clear(); this.prims = ps.map(p => scene.primitives.add(p)); } clear() { this.prims.forEach(p => scene.primitives.remove(p)); this.prims = []; } show(v) { this.prims.forEach(p => p.show = v); } }
// ------------------ airspace (Class B/C/D) ------------------
export const airspace = {
  on: false, g: new Group(), cells: new Map(), info: new Map(), ver: 0,
  async refresh() {
    if (!this.on) return; const ci = cameraInfo(); if (ci.h > 1.6e6) { setStatus('airspace', true, 'Zoom in (below ~1,600 km) to load airspace'); return; }
    const c = ci.ctr || { lat: ci.lat, lon: ci.lon }; const r = clamp(ci.h / 111000 * 0.9, 0.6, 5), w = c.lon - r * 1.4, e = c.lon + r * 1.4, s = c.lat - r, n = c.lat + r;
    const key = `${(w).toFixed(1)}_${(s).toFixed(1)}_${r.toFixed(1)}`; if (this.key === key) return; this.key = key; const my = ++this.ver;
    try {
      const j = await ais('Class_Airspace', { ...bboxQ(w, s, e, n), where: "LOCAL_TYPE IN ('CLASS_B','CLASS_C','CLASS_D')", outFields: 'IDENT,NAME,LOCAL_TYPE,UPPER_VAL,UPPER_UOM,UPPER_CODE,LOWER_VAL,LOWER_UOM,LOWER_CODE', maxAllowableOffset: 0.0006, resultRecordCount: 1500 });
      if (my !== this.ver) return; this.features = j.features; this.build(); setStatus('airspace', true, `${j.features.length} airspace volumes (FAA AIS)`);
    } catch (e) { this.key = null; setStatus('airspace', false, 'FAA AIS airspace unavailable: ' + e.message); }
  },
  build() {
    if (!this.features) return; const k = exag(); this.info.clear();
    const ft = (v, u) => (u === 'FL' ? v * 100 : v) * FT;
    const items = this.features.map((f, i) => { const p = f.properties, t = p.LOCAL_TYPE; const lo = p.LOWER_VAL > 0 ? ft(p.LOWER_VAL, p.LOWER_UOM) : 0, hi = p.UPPER_VAL > 0 ? ft(p.UPPER_VAL, p.UPPER_UOM) : 18000 * FT;
      const col = t === 'CLASS_B' ? '#2f7bff' : t === 'CLASS_C' ? '#d946ef' : '#38bdf8'; const id = 'asp:' + i;
      this.info.set(id, `Class ${t.slice(-1)} · ${p.NAME || p.IDENT} · ${Math.round(lo / FT)}–${Math.round(hi / FT)} ft ${p.UPPER_CODE || 'MSL'}${p.LOWER_CODE === 'AGL' ? ' (floor AGL, drawn as MSL)' : ''}`);
      return { id, rings: ringsOf(f.geometry), lo: lo * k, hi: hi * k, color: C(col).withAlpha(t === 'CLASS_D' ? 0.10 : 0.14), edge: C(col).withAlpha(0.9) }; });
    this.g.set(extrudedPrimitive(items));
  },
  toggle(v) { this.on = v; if (!v) { this.g.clear(); this.key = null; setStatus('airspace', true, 'off'); } else { this.key = null; this.refresh(); } }
};
// ------------------ airports / runways / heliports ------------------
export const airports = {
  on: false, key: null, ver: 0, prims: [], bb: null, lb: null, rw: null,
  async refresh() {
    if (!this.on) return; const ci = cameraInfo(); if (ci.h > 450000) { this.clear(); setStatus('airports', true, 'Zoom in (below ~450 km) to load runways & heliports'); return; }
    const c = ci.ctr || { lat: ci.lat, lon: ci.lon }; const r = clamp(ci.h / 111000 * 0.8, 0.12, 2.2), w = c.lon - r * 1.3, e = c.lon + r * 1.3, s = c.lat - r, n = c.lat + r;
    const key = `${c.lon.toFixed(1)}_${c.lat.toFixed(1)}_${r.toFixed(1)}`; if (key === this.key) return; this.key = key; const my = ++this.ver;
    try {
      const [rw, ap] = await Promise.all([ais('Runways', { ...bboxQ(w, s, e, n), where: '1=1', outFields: 'DESIGNATOR,LENGTH,WIDTH', resultRecordCount: 1500 }), ais('US_Airport', { ...bboxQ(w, s, e, n), where: "TYPE_CODE IN ('AD','HP') AND OPERSTATUS='OPERATIONAL'", outFields: 'IDENT,NAME,TYPE_CODE,ELEVATION,ICAO_ID', resultRecordCount: 1500 })]);
      if (my !== this.ver) return; this.build(rw.features, ap.features); setStatus('airports', true, `${rw.features.length} runways, ${ap.features.filter(f => f.properties.TYPE_CODE === 'HP').length} heliports, ${ap.features.filter(f => f.properties.TYPE_CODE === 'AD').length} airports (FAA AIS)`);
    } catch (e) { this.key = null; setStatus('airports', false, 'FAA AIS runways/heliports unavailable: ' + e.message); }
  },
  clear() { this.prims.forEach(p => scene.primitives.remove(p)); this.prims = []; this.key = null; },
  build(rw, ap) {
    this.clear(); const inst = [];
    for (const f of rw) for (const ring of ringsOf(f.geometry)) { try { inst.push(new Cesium.GeometryInstance({ geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat(ring[0]))), vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }), attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(C('#e5e7eb').withAlpha(.92)) }, id: 'rwy:' + f.properties.DESIGNATOR + ' · ' + f.properties.LENGTH + '×' + f.properties.WIDTH + ' ft' })); } catch {} }
    if (inst.length) this.prims.push(scene.primitives.add(new Cesium.GroundPrimitive({ geometryInstances: inst, appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }), asynchronous: true })));
    const bb = scene.primitives.add(new Cesium.BillboardCollection({ scene })), lb = scene.primitives.add(new Cesium.LabelCollection({ scene })); this.prims.push(bb, lb);
    const mk = (t, col) => { const c = document.createElement('canvas'); c.width = c.height = 40; const g = c.getContext('2d'); g.fillStyle = col; g.strokeStyle = '#111'; g.lineWidth = 3; g.beginPath(); g.arc(20, 20, 15, 0, 7); g.stroke(); g.fill(); g.fillStyle = '#111'; g.font = '700 22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 20, 21); return c.toDataURL(); };
    const iH = mk('H', '#fbbf24'), iA = mk('✈', '#e5e7eb');
    for (const f of ap) { const p = f.properties, [lon, lat] = f.geometry.coordinates, hp = p.TYPE_CODE === 'HP';
      bb.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, 0), image: hp ? iH : iA, scale: hp ? 0.5 : 0.42, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, id: 'apt:' + (hp ? 'Heliport ' : 'Airport ') + (p.ICAO_ID || p.IDENT) + ' · ' + p.NAME + ' · elev ' + Math.round(p.ELEVATION) + ' ft', scaleByDistance: new Cesium.NearFarScalar(3e3, 1.4, 4e5, 0.5), disableDepthTestDistance: 0 });
      lb.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, 0), text: p.IDENT, font: '600 11px system-ui', fillColor: C(hp ? '#fde68a' : '#e5e7eb'), outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(12, -2), horizontalOrigin: Cesium.HorizontalOrigin.LEFT, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, translucencyByDistance: new Cesium.NearFarScalar(5e3, 1, 1.5e5, 0) }); }
  },
  toggle(v) { this.on = v; if (!v) { this.clear(); setStatus('airports', true, 'off'); } else { this.key = null; this.refresh(); } }
};
// ------------------ weather: TFR, AIRMET/SIGMET, radar ------------------
export const tfr = {
  on: false, g: new Group(), info: new Map(), feats: null,
  async toggle(v) { this.on = v; if (!v) { this.g.clear(); setStatus('tfr', true, 'off'); return; } await this.load(); },
  async load() {
    try { const j = this.feats = await proxied('tfr'); this.build(); setStatus('tfr', true, `${j.features.length} TFRs (FAA tfr.faa.gov)`); }
    catch (e) { this.g.clear(); setStatus('tfr', false, e.message.includes('proxy') ? 'TFRs need the SkyDeck proxy' : 'FAA TFR feed unavailable: ' + e.message); }
  },
  build() {
    if (!this.feats) return; const k = exag(); this.info.clear();
    const items = this.feats.features.filter(f => f.geometry).map((f, i) => { const p = f.properties, lo = (p.loFt || 0) * FT, hi = (p.hiFt != null ? p.hiFt : 18000) * FT, id = 'tfr:' + i;
      this.info.set(id, `TFR ${p.NOTAM_KEY?.split('-')[0] || ''} · ${p.TITLE || ''} · ${p.loFt || 0}–${p.hiFt != null ? p.hiFt : 'unspecified (drawn to 18,000)'} ft ${p.upperRef || ''}${p.eff ? ' · ' + p.eff + ' → ' + (p.exp || '') : ''}`);
      return { id, rings: ringsOf(f.geometry), lo: lo * k, hi: hi * k, color: C('#ef4444').withAlpha(.22), edge: C('#ef4444').withAlpha(.95) }; });
    this.g.set(extrudedPrimitive(items));
  }
};
export const wx = {
  on: false, g: new Group(), info: new Map(), data: null,
  async toggle(v) { this.on = v; if (!v) { this.g.clear(); setStatus('wx', true, 'off'); return; } await this.load(); },
  async load() {
    try {
      const [s, g] = await Promise.all([proxied('wx/airsigmet').catch(e => { if (e.message.includes('proxy')) throw e; return []; }), proxied('wx/gairmet').catch(() => [])]);
      this.data = { s, g }; this.build(); setStatus('wx', true, `${this.n} SIGMET/AIRMET areas (aviationweather.gov)`);
    } catch (e) { this.g.clear(); setStatus('wx', false, e.message.includes('proxy') ? 'AIRMET/SIGMET need the SkyDeck proxy' : 'aviationweather.gov unavailable: ' + e.message); }
  },
  build() {
    if (!this.data) return; const k = exag(); this.info.clear(); const items = []; let i = 0;
    const HC = { TURB: '#fb923c', 'TURB-HI': '#fb923c', 'TURB-LO': '#fb923c', ICE: '#22d3ee', CONVECTIVE: '#f43f5e', IFR: '#94a3b8', MT_OBSC: '#a8a29e', 'M_FZLVL': '#60a5fa', ASH: '#78716c', LLWS: '#facc15', SFC_WND: '#facc15' };
    for (const a of this.data.s) { const co = (a.coords || []).map(c => [c.lon, c.lat]); if (co.length < 4) continue; const hi = (a.altitudeHi2 || a.altitudeHi1 || 45000) * FT, lo = (a.altitudeLow1 || a.altitudeLow2 || 0) * FT, id = 'wx:' + i++;
      this.info.set(id, `${a.airSigmetType} ${a.hazard}${a.severity ? ' sev ' + a.severity : ''} · ${Math.round(lo / FT)}–${Math.round(hi / FT)} ft · valid until ${new Date(a.validTimeTo * 1000).toUTCString().slice(5, 22)}Z`);
      items.push({ id, rings: [[co]], lo: lo * k, hi: hi * k, color: C(HC[a.hazard] || '#f59e0b').withAlpha(.2), edge: C(HC[a.hazard] || '#f59e0b').withAlpha(.9) }); }
    const num = v => v && /^\d+$/.test(v) ? +v * 100 : null; const seen = new Set();
    for (const a of this.data.g) { if (a.geometryType !== 'AREA' || !['TURB-HI', 'TURB-LO', 'ICE', 'IFR', 'MT_OBSC', 'LLWS', 'SFC_WND', 'M_FZLVL'].includes(a.hazard) || a.forecastHour !== 3 && a.forecastHour !== 0) continue; const co = (a.coords || []).map(c => [+c.lon, +c.lat]); if (co.length < 4) continue;
      const dedupe = a.hazard + a.tag + a.base + a.top; if (seen.has(dedupe)) continue; seen.add(dedupe); const defHi = { IFR: 10000, MT_OBSC: 14000, LLWS: 2000, SFC_WND: 2000 }[a.hazard] || 18000; const lo = (num(a.base) ?? 0) * FT, hi = (num(a.top) ?? defHi) * FT, id = 'wx:' + i++;
      this.info.set(id, `G-AIRMET ${a.hazard} (${a.product || ''}) · ${Math.round(lo / FT)}–${Math.round(hi / FT)} ft${a.base === 'FZL' ? ' (from freezing level, drawn from SFC)' : ''} · valid ${a.validTime?.slice(11, 16)}Z`);
      items.push({ id, rings: [[co]], lo: lo * k, hi: hi * k, color: C(HC[a.hazard] || '#f59e0b').withAlpha(.14), edge: C(HC[a.hazard] || '#f59e0b').withAlpha(.8) }); }
    this.n = items.length; this.g.set(extrudedPrimitive(items));
  }
};
export const radar = {
  on: false, layers: [], idx: 0, timer: null, src: 'rainviewer', alpha: 0.7, frames: [],
  async toggle(v) { this.on = v; if (!v) { this.stop(); setStatus('radar', true, 'off'); return; } await this.load(); },
  stop() { clearInterval(this.timer); this.timer = null; this.layers.forEach(l => viewer.imageryLayers.remove(l, true)); this.layers = []; },
  async load() {
    this.stop();
    try {
      let provs = [];
      if (this.src === 'rainviewer') {
        const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json(); const fr = [...j.radar.past.slice(-8), ...(j.radar.nowcast || []).slice(0, 3)]; this.frames = fr.map(f => f.time * 1000);
        provs = fr.map(f => new Cesium.UrlTemplateImageryProvider({ url: `${j.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, maximumLevel: 6, credit: 'Radar © RainViewer' }));
      } else {
        const off = [50, 40, 30, 20, 10, 0]; this.frames = off.map(m => Date.now() - m * 60000);
        provs = off.map(m => new Cesium.UrlTemplateImageryProvider({ url: `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913${m ? '-m' + String(m).padStart(2, '0') + 'm' : ''}/{z}/{x}/{y}.png`, maximumLevel: 9, credit: 'NEXRAD © Iowa Environmental Mesonet', rectangle: Cesium.Rectangle.fromDegrees(-130, 20, -60, 55) }));
      }
      this.layers = provs.map(p => { const l = viewer.imageryLayers.addImageryProvider(p); l.alpha = 0; return l; }); this.idx = this.layers.length - 1; this.step(0);
      this.timer = setInterval(() => this.step(1), 700); setStatus('radar', true, `${this.layers.length} radar frames (${this.src === 'rainviewer' ? 'RainViewer' : 'IEM NEXRAD, US only'}) — animating`);
    } catch (e) { setStatus('radar', false, 'Radar unavailable: ' + e.message); }
  },
  step(d) { if (!this.layers.length) return; this.layers[this.idx].alpha = 0; this.idx = (this.idx + d + this.layers.length) % this.layers.length; this.layers[this.idx].alpha = this.alpha; document.dispatchEvent(new CustomEvent('radarframe', { detail: { t: this.frames[this.idx] } })); },
};
export const infoHooks = [];
export const layerInfo = id => infoHooks.map(f => f(id)).find(Boolean) || airspace.info.get(id) || tfr.info.get(id) || wx.info.get(id) || (id.startsWith('rwy:') ? 'Runway ' + id.slice(4) : id.startsWith('apt:') ? id.slice(4) : null);
export const rebuildExag = () => { airspace.build(); tfr.build(); wx.build(); };
