// Lazy-loaded real glTF aircraft by ICAO type (GA/turboprop/bizjet/heli/fighter: original CC0 meshes from tools/make-models.js; airliners: amvlab, CC BY 4.0, see README).
// Each model is fetched the first time that type is shown (7-20 KB for GA, ~200 KB for airliners) and cached; a procedural placeholder shows meanwhile.
import { scene } from './globe.js';
import { buildAircraft } from './model3d.js';
const Cesium = window.Cesium;
const T = (re, m) => [new RegExp('^(' + re + ')$'), m];
const MAP = [
  T('A388', 'A380'), T('B744|B748|B74[A-Z]|A124|A225', 'A380:0.85'), T('A35[0-9K]|A359|A35K', 'A350'), T('B78[0-9X]|B77[0-9WL]|B76[0-9]|B75[0-9]|A33[0-9]|A34[0-9]|A30B|A306|A310|MD11|DC10|IL96', 'B787'),
  T('B73[0-9]|B3[789]M|B38M|B37M|B39M|B712|B72[0-9]|MD8[0-9]|MD9[0-9]|DC9.*', 'B737'), T('A31[89]|A32[01]|A20N|A21N|BCS[13]|A220.*', 'A320'), T('E1[79][0-9]|E[79]5[A-Z]|E75[LS]|E17[0-9]|E19[0-9]|E29[0-9]|CRJ[0-9XA-Z]*|CL[0-9]{2}|RJ[0-9]+|F100|F70|B461|B462|BAE.*|AT7[0-9]|DH8[A-D]|AT4[0-9]|SF34|E12[0-9]|JS[0-9]+', 'A320:0.62'),
  T('PC12|PC24|TBM[0-9]|P46T|PA46|M600|SR22|SR20|DA62|C208|C20T|C406|PAY[0-9]|BE10|M20[A-Z]|C77[RL]', 'pc12'),
  T('BE[0-9A-Z]{2}|B350|B190|AC9[0-9]|AC50|C441|C425|DHC[0-9]|SW[0-9]|P180|E110|E120|PA31|PA34|PA42|C340|C402|C414|C421|BE58|BE55|DA42|PA44|AEST|C310|C337', 'kingair'),
  T('C5[0-9]{2}|C25[ABCM]|C25[0-9]|C68[0-9A-Z]|C7[0-9]{2}|C56X|C750|LJ[0-9]+|E5[0-9]P|E55P|E50P|F2TH|F900|FA[0-9]+X?|GLF[0-9]|GL[0-9]{2}|G[0-9]{3}|H25[ABC]|CL[36]0|CL35|ASTR|WW24|HDJT|EA50|SF50|LJ[0-9]{2}|CRJ[0-9X]|FA[0-9]+', 'bizjet'),
  T('R22|R44|R66|B06|B06T|B407|B412|B429|B430|EC[0-9]{2}|AS[0-9]{2}|AS5[0-9]|H60|UH[0-9]+|S76|S92|S61|S70|A109|A119|A139|A189|H500|MD52|MD60|MD90|EN28|EN48|BK17|H125|H130|H135|H145|H160|H175|R4[4-9]|CH[0-9]+|AH[0-9]+|OH[0-9]+|MH[0-9]+|HH[0-9]+|V22', 'heli'),
  T('F[0-9]{1,2}[A-Z]?|FA18|F16|F15|F22|F35|T38|T-?38|A10|A-?10|EUFI|TORN|HAWK|M346|AJET|L39|T6|T45|PUMA|HUNT|C130|C17|K35R|KC[0-9]+|B52|B1B|B2', 'fighter'),
  T('C1[0-9]{2}|C2[0-9]{2}|P28[A-Z]|PA2[0-9]|PA3[0-9]|PA1[0-9]|DA[0-9]{2}|AA5|AA1|BE23|BE33|BE35|M[0-9]{2}|GA8|J3|RV[0-9]+|SR2[0-9]|COL[0-9]|TB[0-9]+|G115|AT3|PA18|CH7|STIN|BL8|LONG|LA4|RALL|P28|C172|C182|C152|C150|C177|C206|C210', 'c172'),
];
const PA = /^(P28[A-Z]|PA2[0-9]|PA3[0-9]|PA1[0-9]|PA44|DA[0-9]{2}|AA5|BE3[0-9]|BE23|SR2[0-9]|M20[A-Z]|COL[0-9]|TB[0-9]+|G115|PA24)$/;
export function modelFor(a = {}) {   // -> { key, scale }
  const t = String(a.type || '').toUpperCase(), reg = String(a.reg || '').toUpperCase(); const tail = TAILS[reg]; if (tail) return { key: tail.file, scale: 1, livery: reg };
  if (a.heli) return { key: 'heli', scale: 1 };
  for (const [re, m] of MAP) if (re.test(t)) { const [k, s] = m.split(':'); return { key: k === 'c172' && PA.test(t) ? 'pa28' : k, scale: +s || 1 }; }
  return { key: a.cat === 'mil' ? 'fighter' : a.gs > 250 ? 'A320' : 'c172', scale: 1 };
}
export const TAILS = { N864RJ: { file: 'n864rj-pc12' }, N291KY: { file: 'n291ky-pc12' }, N28027: { file: 'n28027-pa28' } };
function load(cache, pending, key) {   // per-Aircraft3D caches (a Cesium.Model can only be placed once); the browser HTTP cache makes repeat fetches free
  if (cache.has(key)) return Promise.resolve(cache.get(key)); if (pending.has(key)) return pending.get(key);
  const p = Cesium.Model.fromGltfAsync({ url: `assets/models/${key}.glb`, scene, shadows: Cesium.ShadowMode.DISABLED, incrementallyLoadTextures: false, allowPicking: false, backFaceCulling: false, upAxis: Cesium.Axis.Y, forwardAxis: Cesium.Axis.Z, show: false })
    .then(m => { m.lightColor = new Cesium.Cartesian3(2.4, 2.4, 2.4); index(m); scene.primitives.add(m); cache.set(key, m); pending.delete(key); return m; }).catch(e => { pending.delete(key); cache.set(key, null); console.warn('model', key, e.message); return null; });
  pending.set(key, p); return p;
}
// animated parts are glTF nodes named prop*/disc*/rotor*/gear*/nav*/strobe*/beacon/landing (see tools/make-models.js); airliner files have none and simply skip this
function index(m) {
  const n = { prop: [], disc: [], rotor: [], gear: [], lights: {} }; for (const nm of ['prop0', 'prop1', 'disc0', 'disc1', 'rotor0', 'rotor1', 'disc9', 'gearL', 'gearR', 'gearN', 'navL', 'navR', 'strobeL', 'strobeR', 'beacon', 'landing']) { let node = null; try { node = m.getNode(nm); } catch { } if (node) n.lights[nm] = node; }
  m._n = n.lights;
}
const rx = a => Cesium.Matrix4.fromRotationTranslation(Cesium.Matrix3.fromRotationX(a)), ry = a => Cesium.Matrix4.fromRotationTranslation(Cesium.Matrix3.fromRotationY(a)), rz = a => Cesium.Matrix4.fromRotationTranslation(Cesium.Matrix3.fromRotationZ(a)), _tmp = new Cesium.Matrix4();
function setRot(node, rot) { Cesium.Matrix4.multiply(node.originalMatrix, rot, _tmp); node.matrix = Cesium.Matrix4.clone(_tmp, node.matrix); }
const rotZ90 = Cesium.Matrix4.fromRotationTranslation(Cesium.Matrix3.fromRotationZ(Cesium.Math.PI_OVER_TWO));
// Same interface as the procedural primitive (show, modelMatrix) so replay/chase code needs no changes; swap the real model in with use(a).
export class Aircraft3D {
  constructor() { this.proc = buildAircraft(scene); this.cur = null; this._show = false; this._mm = new Cesium.Matrix4(); this.key = null; this.scale = 1; this.want = null; this.cache = new Map(); this.pending = new Map(); }
  use(a) {   // a: { type, reg, heli, cat, gs }
    const m = modelFor(a), id = m.key; this.scale = m.scale; if (this.want === id) return; this.want = id;
    load(this.cache, this.pending, id).then(model => { if (this.want !== id) return; this.cur = model; this.sync(); });
  }
  // st: { gear 0..1, gnd, spd (m/s), vz }   tMs: wall-clock ms (spin / blink phase)
  animate(tMs, st = {}) {
    const m = this.cur, n = m && m._n; if (!n) return; const t = tMs / 1000, moving = !(st.gnd && (st.spd || 0) < 1.5), ang = t * 38 % (2 * Math.PI), gear = st.gear ?? 1;
    for (const k of ['prop0', 'prop1']) if (n[k]) setRot(n[k], rz(moving ? ang * (k === 'prop1' ? -1 : 1) : 0.3));
    for (const k of ['disc0', 'disc1']) if (n[k]) n[k].show = moving;
    if (n.rotor0) { setRot(n.rotor0, ry(-(st.gnd && (st.spd || 0) < 1.5 ? t * 5 : t * 30) % (2 * Math.PI))); if (n.disc9) n.disc9.show = moving; } if (n.rotor1) setRot(n.rotor1, rx(t * 45 % (2 * Math.PI)));
    for (const k of ['gearL', 'gearR', 'gearN']) if (n[k]) { setRot(n[k], rx((1 - gear) * 1.65)); n[k].show = gear > 0.02; }
    if (n.navL) { n.navL.show = n.navR.show = true; }
    const ph = t % 1.3; if (n.strobeL) n.strobeL.show = n.strobeR.show = ph < 0.09 || (ph > 0.2 && ph < 0.29); if (n.beacon) n.beacon.show = (t % 1.0) < 0.45; if (n.landing) n.landing.show = gear > 0.5 && !st.gnd || (st.gnd && (st.spd || 0) > 12);
  }
  get show() { return this._show; } set show(v) { this._show = v; this.sync(); }
  get modelMatrix() { return this._mm; } set modelMatrix(m) { Cesium.Matrix4.clone(m, this._mm); this.sync(); }
  sync() {
    for (const m of this.cache.values()) if (m && m !== this.cur) m.show = false;
    if (this.cur && this._show) { const s = this.scale; Cesium.Matrix4.multiply(this._mm, rotZ90, this.cur.modelMatrix); if (s !== 1) Cesium.Matrix4.multiplyByUniformScale(this.cur.modelMatrix, s, this.cur.modelMatrix); this.cur.show = true; this.proc.show = false; }
    else { if (this.cur) this.cur.show = false; this.proc.modelMatrix = this._mm; this.proc.show = this._show; }
  }
}
