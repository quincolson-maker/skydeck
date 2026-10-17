// Generates the small GA / turboprop / bizjet / helicopter / fighter glTF binaries (original geometry, CC0). Usage: node tools/make-models.js
// Axes: +Z nose, +Y up, +X right wing (glTF). Units: metres, real size. Materials: 0 body, 1 accent, 2 dark, 3 glass, 4 prop disc (alpha).
const fs = require('fs'), path = require('path'), OUT = path.join(__dirname, '..', 'assets', 'models');
const hex = h => [1, 3, 5].map(i => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2));   // sRGB -> linear
class Mesh { constructor() { this.p = []; this.i = []; this.m = []; }   // per-material index lists
  add(pts, idx, mat) { const base = this.p.length / 3; for (const q of pts) this.p.push(...q); (this.m[mat] ||= []).push(...idx.map(k => k + base)); } }
// loft between rings of 3D points (all rings same length), optionally cap both ends
function loft(mesh, rings, mat, caps = true) {
  const n = rings[0].length, pts = rings.flat(), idx = [];
  for (let r = 0; r < rings.length - 1; r++) for (let k = 0; k < n; k++) { const a = r * n + k, b = r * n + (k + 1) % n, c = (r + 1) * n + k, d = (r + 1) * n + (k + 1) % n; idx.push(a, c, b, b, c, d); }
  if (caps) for (const [r, flip] of [[0, 1], [rings.length - 1, 0]]) { const ctr = rings[r].reduce((s, q) => [s[0] + q[0] / n, s[1] + q[1] / n, s[2] + q[2] / n], [0, 0, 0]), ci = pts.length / 3 | 0; pts.push(ctr); for (let k = 0; k < n; k++) { const a = r * n + k, b = r * n + (k + 1) % n; idx.push(...(flip ? [ci, a, b] : [ci, b, a])); } }
  mesh.add(pts, idx, mat);
}
const ring = (z, rx, ry, yc = 0, xc = 0, N = 14, pw = 2.4) => Array.from({ length: N }, (_, k) => { const t = k / N * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t); return [xc + rx * Math.sign(c) * Math.abs(c) ** (2 / pw), yc + ry * Math.sign(s) * Math.abs(s) ** (2 / pw), z]; });
function fuselage(mesh, prof, mat, N = 14) { loft(mesh, prof.map(([z, rx, ry, yc = 0]) => ring(z, Math.max(rx, 0.02), Math.max(ry, 0.02), yc, 0, N)), mat); }
// wing / stabiliser: root at (x0,y0,z0) chord cr, goes out along +x (mirrored when mirror) to tip: span, sweep (m aft shift of the LE), dihedral (m rise), chord ct, thickness fraction
function wing(mesh, { x0 = 0, y0 = 0, z0 = 0, span, cr, ct, sweep = 0, dih = 0, th = 0.1, mat = 0, mirror = true, vertical = false, thTip }) {
  const sec = (x, y, z, c, t) => { const h = c * t; return vertical ? [[x - h / 2, y, z], [x, y, z + c * 0.45], [x + h / 2, y, z], [x, y, z - c * 0.55]].map(q => q) : [[x, y + h * 0.25, z + c * 0.5], [x, y + h * 0.5, z + c * 0.1], [x, y + h * 0.1, z - c * 0.5], [x, y - h * 0.5, z - c * 0.3], [x, y - h * 0.5, z + c * 0.1], [x, y - h * 0.2, z + c * 0.5]]; };
  for (const s of mirror ? [1, -1] : [1]) {
    const root = vertical ? sec(x0, y0, z0, cr, th) : sec(s * x0, y0, z0, cr, th);
    const tip = vertical ? sec(x0, y0 + span, z0 - sweep, ct, thTip || th) : sec(s * (x0 + span), y0 + dih, z0 - sweep, ct, thTip || th);
    loft(mesh, s > 0 ? [root, tip] : [tip, root], mat);
  }
}
const nacelle = (mesh, x, y, z0, z1, r, mat = 0) => loft(mesh, [ring(z0, r * 0.6, r * 0.6, y, x, 10), ring(z0 + (z1 - z0) * 0.12, r, r, y, x, 10), ring(z1 - (z1 - z0) * 0.2, r, r, y, x, 10), ring(z1, r * 0.4, r * 0.4, y, x, 10)], mat);
const disc = (mesh, x, y, z, r) => { const pts = [], idx = []; const N = 20; pts.push([x, y, z]); for (let k = 0; k < N; k++) { const t = k / N * 2 * Math.PI; pts.push([x + Math.cos(t) * r, y + Math.sin(t) * r, z]); } for (let k = 0; k < N; k++) idx.push(0, 1 + k, 1 + (k + 1) % N, 0, 1 + (k + 1) % N, 1 + k); mesh.add(pts, idx, 4); };
const wheel = (mesh, x, y, z, r) => loft(mesh, [ring(z - 0.06, r, r, y, x, 10), ring(z + 0.06, r, r, y, x, 10)], 2);
const strut = (mesh, x, y, z, h) => loft(mesh, [ring(z, 0.03, 0.03, y, x, 6), ring(z, 0.03, 0.03, y - h, x, 6)], 2, false);
// ---------- aircraft ----------
const TYPES = {
  c172(m) { fuselage(m, [[4.0, .05, .05, .2], [3.6, .3, .35, .35], [2.6, .52, .6, .5], [1.2, .55, .65, .5], [-1.0, .45, .5, .5], [-3.2, .22, .26, .6], [-4.2, .08, .1, .65]], 0); fuselage(m, [[1.9, .2, .1, 1.15], [1.0, .52, .12, 1.22], [-0.5, .5, .1, 1.18], [-1.4, .3, .08, 1.1]], 3);
    wing(m, { x0: .5, y0: 1.2, z0: .35, span: 5.0, cr: 1.6, ct: 1.15, sweep: 0, dih: 0, th: .12, mat: 0 }); wing(m, { x0: .2, y0: .62, z0: -3.5, span: 1.8, cr: 1.1, ct: .7, th: .08 }); wing(m, { x0: 0, y0: .6, z0: -3.4, span: 1.5, cr: 1.3, ct: .8, sweep: .8, th: .08, vertical: true, mat: 1 });
    nacelleProp(m, 0, .25, 3.9); for (const s of [-1, 1]) { strut(m, s * 1.4, 1.2, .3, 0); loft(m, [ring(.3, .02, .02, .6, s * 1.4, 4), ring(.3, .02, .02, 1.2, s * 2.2, 4)], 2, false); wheel(m, s * 1.0, -.15, .7, .22); strut(m, s * 1.0, .45, .7, .5); } wheel(m, 0, -.15, 2.9, .2); strut(m, 0, .2, 2.9, .35); },
  pa28(m) { fuselage(m, [[3.6, .05, .05, .1], [3.2, .28, .3, .25], [2.2, .5, .52, .35], [.9, .52, .58, .4], [-1.0, .44, .46, .4], [-3.0, .2, .2, .42], [-3.8, .07, .07, .45]], 0); fuselage(m, [[1.7, .18, .1, .85], [.8, .5, .12, .93], [-.4, .48, .1, .9], [-1.2, .3, .06, .82]], 3);
    wing(m, { x0: .45, y0: .15, z0: .25, span: 4.5, cr: 1.6, ct: 1.15, dih: .1, th: .12 }); wing(m, { x0: .15, y0: .5, z0: -3.1, span: 1.7, cr: 1.0, ct: .65, th: .08 }); wing(m, { x0: 0, y0: .45, z0: -2.9, span: 1.35, cr: 1.5, ct: .7, sweep: .9, th: .08, vertical: true, mat: 1 });
    nacelleProp(m, 0, .2, 3.5); for (const s of [-1, 1]) { wheel(m, s * 1.1, -.55, .3, .21); strut(m, s * 1.1, .05, .3, .55); } wheel(m, 0, -.5, 2.2, .18); strut(m, 0, .1, 2.2, .5); },
  pc12(m) { fuselage(m, [[7.2, .1, .1, .1], [6.6, .45, .5, .2], [5.2, .85, .9, .35], [1.5, .95, 1.05, .4], [-3.0, .8, .85, .5], [-6.0, .4, .45, .7], [-7.2, .12, .14, .85]], 0, 16); fuselage(m, [[5.0, .3, .1, .9], [4.4, .75, .22, 1.05], [3.6, .8, .05, 1.25]], 3, 12);
    wing(m, { x0: .8, y0: -.05, z0: .55, span: 7.4, cr: 2.0, ct: 1.05, sweep: .5, dih: .25, th: .13 }); wing(m, { x0: .2, y0: .95, z0: -5.7, span: 2.4, cr: 1.5, ct: .8, sweep: .7, th: .08 }); wing(m, { x0: 0, y0: .8, z0: -5.3, span: 2.1, cr: 2.4, ct: 1.1, sweep: 1.6, th: .09, vertical: true, mat: 1 }); wing(m, { x0: 0, y0: .2, z0: -5.4, span: .5, cr: 1.4, ct: .9, sweep: 1.0, th: .07, vertical: true, mat: 0 });
    nacelleProp(m, 0, .4, 7.2, 1.2); for (const s of [-1, 1]) { wheel(m, s * 1.7, -.9, .7, .3); strut(m, s * 1.7, 0, .7, .9); } wheel(m, 0, -.85, 5.0, .26); strut(m, 0, .15, 5.0, .85); },
  kingair(m) { fuselage(m, [[7.1, .1, .1, .1], [6.4, .5, .55, .2], [5.0, .85, .95, .35], [-0.5, .9, 1.0, .4], [-4.5, .7, .75, .55], [-6.6, .3, .35, .9], [-7.1, .1, .12, 1.05]], 0, 16); fuselage(m, [[4.9, .3, .1, .95], [4.3, .72, .22, 1.1], [3.5, .75, .05, 1.3]], 3, 12);
    wing(m, { x0: .8, y0: -.1, z0: .4, span: 7.8, cr: 2.3, ct: 1.0, sweep: .3, dih: .2, th: .13 }); wing(m, { x0: 0, y0: 2.5, z0: -6.1, span: 3.0, cr: 1.5, ct: .8, sweep: .6, th: .08 }); wing(m, { x0: 0, y0: .9, z0: -5.6, span: 1.8, cr: 2.2, ct: 1.2, sweep: 1.4, th: .09, vertical: true, mat: 1 });
    for (const s of [-1, 1]) { nacelleProp(m, s * 2.6, .3, 2.2, 1.15, true); wheel(m, s * 2.6, -.85, 1.2, .3); strut(m, s * 2.6, -.05, 1.2, .8); } wheel(m, 0, -.9, 4.5, .24); strut(m, 0, .1, 4.5, .85); },
  bizjet(m) { fuselage(m, [[7.2, .08, .08, .05], [6.5, .4, .42, .15], [5.2, .72, .8, .3], [-0.5, .75, .85, .35], [-4.8, .55, .6, .5], [-7.0, .22, .25, .7], [-7.5, .1, .12, .8]], 0, 16); fuselage(m, [[5.2, .25, .08, .72], [4.6, .6, .2, .95], [3.8, .62, .04, 1.1]], 3, 12);
    wing(m, { x0: .7, y0: -.15, z0: .2, span: 7.0, cr: 2.3, ct: 1.0, sweep: 1.6, dih: .3, th: .1 }); wing(m, { x0: 0, y0: 2.55, z0: -6.9, span: 2.5, cr: 1.5, ct: .8, sweep: .8, th: .07 }); wing(m, { x0: 0, y0: .9, z0: -6.1, span: 2.1, cr: 2.2, ct: 1.0, sweep: 1.5, th: .08, vertical: true, mat: 1 });
    for (const s of [-1, 1]) { nacelle(m, s * 1.1, .45, -5.4, -2.9, .38, 2); wing(m, { x0: .5, y0: .45, z0: -4.2, span: .7, cr: 1.2, ct: 1, th: .08, mat: 0, mirror: false }); wheel(m, s * 1.2, -.95, .3, .27); strut(m, s * 1.2, -.1, .3, .85); } wheel(m, 0, -.95, 4.8, .22); strut(m, 0, .1, 4.8, .85); },
  heli(m) { fuselage(m, [[2.6, .1, .1, .2], [2.1, .55, .55, .35], [1.0, .95, .95, .5], [-.8, .9, .95, .55], [-2.0, .5, .55, .65], [-3.0, .22, .25, .75]], 0, 14); fuselage(m, [[2.0, .35, .28, .65], [1.6, .65, .5, .8], [1.0, .75, .15, 1.05]], 3, 12);
    fuselage(m, [[-2.5, .18, .2, .8], [-5.0, .12, .14, .85], [-6.0, .08, .1, .95]], 0, 10); wing(m, { x0: 0, y0: .9, z0: -5.7, span: 1.1, cr: 1.1, ct: .7, sweep: .5, th: .08, vertical: true, mat: 1 }); wing(m, { x0: .1, y0: .88, z0: -5.4, span: .9, cr: .6, ct: .4, th: .06 });
    loft(m, [ring(0.3, .12, .12, 1.15, 0, 6), ring(0.3, .12, .12, 1.7, 0, 6)], 2); disc(m, 0, 0, 0, 0); rotor(m, 0, 1.72, .3, 5.4); for (const s of [-1, 1]) { loft(m, [ring(1.2, .04, .04, -.55, s * .85, 6), ring(-1.6, .04, .04, -.55, s * .85, 6)], 2); strut(m, s * .85, -.55, 1.0, -.5); strut(m, s * .85, -.55, -1.0, -.5); } },
  fighter(m) { fuselage(m, [[8.2, .03, .03, .1], [6.5, .3, .28, .18], [4.2, .62, .55, .25], [0, .75, .6, .25], [-4, .7, .55, .2], [-7.0, .55, .45, .15]], 0, 14); fuselage(m, [[4.6, .1, .08, .55], [3.4, .38, .28, .75], [1.6, .4, .12, .7]], 3, 10);
    wing(m, { x0: .5, y0: .1, z0: -.5, span: 4.4, cr: 5.0, ct: 1.2, sweep: 3.2, dih: -.1, th: .05 }); wing(m, { x0: .5, y0: .1, z0: -5.8, span: 2.2, cr: 2.2, ct: .9, sweep: 1.5, th: .05 });
    for (const s of [-1, 1]) wing(m, { x0: s * .65, y0: .6, z0: -5.0, span: 1.6, cr: 2.4, ct: 1.0, sweep: 1.6, th: .06, vertical: true, mat: 1, mirror: false }); for (const s of [-1, 1]) nacelle(m, s * .45, .1, -8.0, -5.8, .42, 2); }
};
function nacelleProp(m, x, y, zNose, r = 1, turbo = false) { if (turbo) nacelle(m, x, y, zNose - 2.6, zNose + .6, .38); disc(m, x, y, zNose + (turbo ? .75 : .1), r * (turbo ? 1.35 : .95)); loft(m, [ring(zNose + (turbo ? .7 : .05), .12, .12, y, x, 8), ring(zNose + (turbo ? .85 : .18), .02, .02, y, x, 8)], 2); }
function rotor(m, x, y, z, R) { for (let b = 0; b < 4; b++) { const a = b * Math.PI / 2 + .3, c = Math.cos(a), s = Math.sin(a); const p = (r, w) => [[x + c * r - s * w, y, z + s * r + c * w], [x + c * r + s * w, y, z - s * r + c * w]]; loft(m, [[[x - s * .1, y + .02, z + c * .1], [x + s * .1, y + .02, z - c * .1], [x + s * .1, y - .02, z - c * .1], [x - s * .1, y - .02, z + c * .1]], [[x + c * R - s * .1, y + .01, z + s * R + c * .1], [x + c * R + s * .1, y + .01, z + s * R - c * .1], [x + c * R + s * .1, y - .01, z + s * R - c * .1], [x + c * R - s * .1, y - .01, z + s * R + c * .1]]], 2); } disc(m, x, y, z, R); }
// ---------- GLB writer ----------
function glb(mesh, pal) {
  const P = new Float32Array(mesh.p), nrm = new Float32Array(P.length), allIdx = [], prims = [];
  mesh.m.forEach((idx, mi) => { if (!idx || !idx.length) return; prims.push({ mi, start: allIdx.length, n: idx.length }); allIdx.push(...idx); });
  for (let t = 0; t < allIdx.length; t += 3) { const [a, b, c] = [allIdx[t], allIdx[t + 1], allIdx[t + 2]], A = [...P.slice(a * 3, a * 3 + 3)], B = [...P.slice(b * 3, b * 3 + 3)], C = [...P.slice(c * 3, c * 3 + 3)], u = B.map((v, i) => v - A[i]), v = C.map((w, i) => w - A[i]), n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; for (const k of [a, b, c]) for (let i = 0; i < 3; i++) nrm[k * 3 + i] += n[i]; }
  for (let k = 0; k < nrm.length; k += 3) { const l = Math.hypot(nrm[k], nrm[k + 1], nrm[k + 2]) || 1; nrm[k] /= l; nrm[k + 1] /= l; nrm[k + 2] /= l; }
  const I = new Uint16Array(allIdx), pb = Buffer.from(P.buffer), nb = Buffer.from(nrm.buffer), ib = Buffer.from(I.buffer); const ibp = Buffer.concat([ib, Buffer.alloc((4 - ib.length % 4) % 4)]);
  const mn = [0, 1, 2].map(i => Math.min(...Array.from({ length: P.length / 3 }, (_, k) => P[k * 3 + i]))), mx = [0, 1, 2].map(i => Math.max(...Array.from({ length: P.length / 3 }, (_, k) => P[k * 3 + i])));
  const mats = [{ name: 'body', c: hex(pal.body), r: .45 }, { name: 'accent', c: hex(pal.accent), r: .5 }, { name: 'dark', c: hex(pal.dark), r: .7 }, { name: 'glass', c: hex('#243447'), r: .12, m: .3 }, { name: 'prop', c: hex('#cfd6dc'), r: .8, a: .18 }];
  const j = { asset: { version: '2.0', generator: 'SkyDeck tools/make-models.js (CC0)' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: pal.name }], meshes: [{ primitives: prims.map(p => ({ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 + prims.indexOf(p), material: p.mi })) }],
    materials: mats.map(m => ({ name: m.name, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [...m.c, m.a || 1], metallicFactor: m.m || 0, roughnessFactor: m.r }, ...(m.a ? { alphaMode: 'BLEND' } : {}) })),
    accessors: [{ bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3', min: mn, max: mx }, { bufferView: 1, componentType: 5126, count: P.length / 3, type: 'VEC3' }, ...prims.map((p, k) => ({ bufferView: 2, byteOffset: p.start * 2, componentType: 5123, count: p.n, type: 'SCALAR' }))],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pb.length, target: 34962 }, { buffer: 0, byteOffset: pb.length, byteLength: nb.length, target: 34962 }, { buffer: 0, byteOffset: pb.length + nb.length, byteLength: ib.length, target: 34963 }], buffers: [{ byteLength: pb.length + nb.length + ibp.length }] };
  let js = Buffer.from(JSON.stringify(j)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]); const bin = Buffer.concat([pb, nb, ibp]);
  const h = Buffer.alloc(12); h.write('glTF'); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8); const c1 = Buffer.alloc(8); c1.writeUInt32LE(js.length, 0); c1.write('JSON', 4); const c2 = Buffer.alloc(8); c2.writeUInt32LE(bin.length, 0); c2.write('BIN\0', 4);
  return Buffer.concat([h, c1, js, c2, bin]);
}
const BASE = { body: '#f2f4f6', accent: '#2a4f8f', dark: '#2b3037' };
fs.mkdirSync(OUT, { recursive: true });
const LIV = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'liveries.json'), 'utf8'));
const jobs = Object.keys(TYPES).map(t => [t, t, BASE]); for (const [tail, l] of Object.entries(LIV.tails)) jobs.push([l.type, tail.toLowerCase() + '-' + l.type, { ...BASE, ...l.palette }]);
for (const [type, name, pal] of jobs) { const m = new Mesh(); TYPES[type](m); const b = glb(m, { ...pal, name }); fs.writeFileSync(path.join(OUT, name + '.glb'), b); console.log(name, b.length, 'bytes', (m.p.length / 3) + ' verts'); }
