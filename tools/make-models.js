// Generates the GA / turboprop / bizjet / helicopter / fighter glTF binaries (original geometry, CC0). Usage: node tools/make-models.js
// v2: smooth lofted fuselages, tapered airfoil wings, winglets, nacelles, spinners + propellers, windshield, cabin windows, livery stripe, retractable gear (named nodes),
// nav / strobe / beacon / landing light nodes. Animated at run time by js/models.js (node.matrix / node.show): nodes prop*, rotor*, gear*, nav*, strobe*, beacon, landing.
// Axes: +Z nose, +Y up, +X right wing. Metres, real size, origin on the ground between the main wheels (lowest point = y 0).
const fs = require('fs'), path = require('path'), OUT = path.join(__dirname, '..', 'assets', 'models');
const lin = h => [1, 3, 5].map(i => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2));
class Part { constructor(name, pivot = [0, 0, 0]) { this.name = name; this.pivot = pivot; this.p = []; this.m = []; }
  add(pts, idx, mat) { const base = this.p.length; for (const q of pts) this.p.push([...q]); (this.m[mat] ||= []).push(...idx.map(k => k + base)); } }
const M = { BODY: 0, ACC: 1, DARK: 2, GLASS: 3, DISC: 4, METAL: 5, NAVR: 6, NAVG: 7, WHITE: 8, BEACON: 9 };
function loft(part, rings, mat, caps = true) {
  const n = rings[0].length, pts = rings.flat(), idx = [];
  for (let r = 0; r < rings.length - 1; r++) for (let k = 0; k < n; k++) { const a = r * n + k, b = r * n + (k + 1) % n, c = (r + 1) * n + k, d = (r + 1) * n + (k + 1) % n; idx.push(a, c, b, b, c, d); }
  if (caps) for (const [r, flip] of [[0, 1], [rings.length - 1, 0]]) { const ctr = rings[r].reduce((s, q) => [s[0] + q[0] / n, s[1] + q[1] / n, s[2] + q[2] / n], [0, 0, 0]), ci = pts.length; pts.push(ctr); for (let k = 0; k < n; k++) { const a = r * n + k, b = r * n + (k + 1) % n; idx.push(...(flip ? [ci, a, b] : [ci, b, a])); } }
  part.add(pts, idx, mat);
}
const ring = (z, rx, ry, yc = 0, xc = 0, N = 20, pw = 2.3) => Array.from({ length: N }, (_, k) => { const t = k / N * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t); return [xc + rx * Math.sign(c) * Math.abs(c) ** (2 / pw), yc + ry * Math.sign(s) * Math.abs(s) ** (2 / pw), z]; });
const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
function smooth(prof, n) {   // Catmull-Rom resample of [z, rx, ry, yc] stations (z descending)
  const out = []; const P = i => prof[Math.max(0, Math.min(prof.length - 1, i))]; for (let s = 0; s < prof.length - 1; s++) for (let k = 0; k < n; k++) { const t = k / n; out.push([0, 1, 2, 3].map(c => c === 0 ? prof[s][0] + (prof[s + 1][0] - prof[s][0]) * t : Math.max(0.02, cr(P(s - 1)[c], P(s)[c], P(s + 1)[c], P(s + 2)[c], t)) * (c === 3 ? 1 : 1))); } out.push(prof[prof.length - 1]); return out;
}
const interp = (st, z, c) => { for (let i = 0; i < st.length - 1; i++) if ((z <= st[i][0] && z >= st[i + 1][0])) { const t = (z - st[i][0]) / (st[i + 1][0] - st[i][0] || 1); return st[i][c] + (st[i + 1][c] - st[i][c]) * t; } return st[st.length - 1][c]; };
// airfoil ring (closed), chord c, thickness t, at span position (x,y,z=LE+...), camber small
const foil = (x, y, zc, c, t) => { const pts = [[1, 0], [.75, .42], [.45, .8], [.15, 1], [0.01, .55], [0.02, -.2], [.15, -.65], [.45, -.75], [.75, -.4]]; return pts.map(([u, v]) => [x, y + v * t * c * 0.5, zc + c * (0.5 - u)]); };
function wing(part, { x0 = 0, y0 = 0, z0 = 0, span, cr: croot, ct, sweep = 0, dih = 0, th = .12, thTip, mat = 0, mirror = true, vertical = false }) {
  for (const s of mirror ? [1, -1] : [1]) {
    const f = (x, y, z, c, t) => { if (!vertical) return foil(x, y, z, c, t); return foil(x, y, z, c, t).map(([_, yy, zz], i) => [x + (yy - y), y, zz]); };
    const root = vertical ? foil(0, 0, z0, croot, th).map(([_, yy, zz]) => [x0 + yy, y0, zz]) : foil(s * x0, y0, z0, croot, th);
    const tip = vertical ? foil(0, 0, z0 - sweep, ct, thTip || th).map(([_, yy, zz]) => [x0 + yy, y0 + span, zz]) : foil(s * (x0 + span), y0 + dih, z0 - sweep, ct, thTip || th);
    loft(part, s > 0 ? [root, tip] : [tip, root], mat);
  }
}
const sphere = (part, c, r, mat) => { const rings = []; for (let i = 0; i <= 6; i++) { const a = Math.PI * i / 6; rings.push(ring(c[2] + r * Math.cos(a), r * Math.sin(a) + 0.001, r * Math.sin(a) + 0.001, c[1], c[0], 8, 2)); } loft(part, rings, mat, false); };
// ---------- builder ----------
function build(spec) {
  const parts = []; const mk = (n, pv) => { const p = new Part(n, pv); parts.push(p); return p; }; const body = mk('body'); const st = smooth(spec.fus, 5);
  loft(body, st.map(([z, rx, ry, yc]) => ring(z, rx, ry, yc, 0, 22)), M.BODY);
  // livery stripe (cheatline) along both sides + tail accent
  if (spec.stripe) { const [zA, zB, yo, w] = spec.stripe; for (const s of [-1, 1]) { const rings = []; for (let z = zA; z >= zB; z -= 0.35) { const rx = interp(st, z, 1) * 1.012, yc = interp(st, z, 3) + yo + (zA - z) * (spec.stripeSlope || 0); rings.push([[s * rx, yc - w / 2, z], [s * (rx + 0.02), yc - w / 2, z], [s * (rx + 0.02), yc + w / 2, z], [s * rx, yc + w / 2, z]]); } loft(body, s > 0 ? rings : rings.map(r => r.slice().reverse()), M.ACC, false); } }
  // windshield + cabin windows
  if (spec.glass) { const [zA, zB, yo, wx] = spec.glass; const rings = []; for (let z = zA; z >= zB; z -= 0.12) { const rx = interp(st, z, 1) * 0.8, ry = interp(st, z, 2), yc = interp(st, z, 3); rings.push(ring(z, rx, ry * 0.38, yc + ry * 0.62 + yo, 0, 12, 2.4).filter((_, k) => k < 7 || k > 12 ? true : true)); } loft(body, rings, M.GLASS, true); }
  if (spec.windows) { const { z0, z1, n, y, h = .26, w = .2 } = spec.windows; for (let i = 0; i < n; i++) { const z = z0 + (z1 - z0) * i / Math.max(1, n - 1), rx = interp(st, z, 1), yc = interp(st, z, 3); for (const s of [-1, 1]) { const x = s * (rx * 0.985), q = [[x, yc + y - h / 2, z - w / 2], [x + s * 0.03, yc + y - h / 2, z - w / 2], [x + s * 0.03, yc + y + h / 2, z - w / 2], [x, yc + y + h / 2, z - w / 2]], q2 = q.map(([a, b, c]) => [a, b, c + w]); loft(body, [q, q2], M.GLASS, true); } } }
  for (const w of spec.wings || []) wing(body, w);
  for (const w of spec.fins || []) wing(body, { ...w, vertical: true });
  if (spec.fin) { wing(body, { ...spec.fin, vertical: true, mat: 0 }); if (spec.finAcc) wing(body, { ...spec.finAcc, vertical: true, mat: 1 }); }
  for (const w of spec.winglets || []) wing(body, w);
  // nacelles / engines
  for (const n of spec.nacelles || []) { const { x, y, z0, z1, r, mat = 0 } = n; loft(body, [ring(z0, r * .5, r * .5, y, x, 14), ring(z0 + (z1 - z0) * .1, r * .95, r * .95, y, x, 14), ring(z0 + (z1 - z0) * .5, r, r, y, x, 14), ring(z1 - (z1 - z0) * .15, r * .9, r * .9, y, x, 14), ring(z1, r * .35, r * .35, y, x, 14)], mat); if (n.intake) loft(body, [ring(z1 - 0.01, r * .6, r * .6, y, x, 12), ring(z1 - 0.3, r * .55, r * .55, y, x, 12)], M.DARK); }
  // propellers (spin nodes) + spinner
  (spec.props || []).forEach((pr, i) => { const [x, y, z] = pr.pos, part = mk('prop' + i, [x, y, z]); loft(part, [ring(z - .05, .02, .02, y, x, 10), ring(z + .12, pr.hub, pr.hub, y, x, 10), ring(z + .38, pr.hub * .9, pr.hub * .9, y, x, 10), ring(z + .5, .02, .02, y, x, 10)], M.METAL);
    for (let b = 0; b < pr.blades; b++) { const a = b * 2 * Math.PI / pr.blades, c = Math.cos(a), s = Math.sin(a), q = (r, w) => [[x + c * r - s * w, y + s * r + c * w, z + .08], [x + c * r + s * w, y + s * r - c * w, z + .08], [x + c * r + s * w, y + s * r - c * w, z + .12], [x + c * r - s * w, y + s * r + c * w, z + .12]]; loft(part, [q(pr.hub, .06), q(pr.r * .55, .13), q(pr.r, .07)], M.DARK); loft(part, [q(pr.r * .93, .07), q(pr.r, .07)], M.WHITE, false); }
    const disc = mk('disc' + i, [x, y, z]); { const N = 24, pts = [[x, y, z + .1]], idx = []; for (let k = 0; k < N; k++) { const t = k / N * 2 * Math.PI; pts.push([x + Math.cos(t) * pr.r, y + Math.sin(t) * pr.r, z + .1]); } for (let k = 0; k < N; k++) idx.push(0, 1 + k, 1 + (k + 1) % N, 0, 1 + (k + 1) % N, 1 + k); disc.add(pts, idx, M.DISC); } });
  // helicopter rotors
  if (spec.rotor) { const { pos, R, blades, tail } = spec.rotor, part = mk('rotor0', pos); loft(part, [ring(pos[2], .12, .12, pos[1] - .35, pos[0], 8), ring(pos[2], .12, .12, pos[1] + .02, pos[0], 8)], M.DARK); for (let b = 0; b < blades; b++) { const a = b * 2 * Math.PI / blades, c = Math.cos(a), s = Math.sin(a), q = (r, w) => [[pos[0] + s * r - c * w, pos[1] + .03, pos[2] + c * r + s * w], [pos[0] + s * r + c * w, pos[1] + .03, pos[2] + c * r - s * w], [pos[0] + s * r + c * w, pos[1] - .02, pos[2] + c * r - s * w], [pos[0] + s * r - c * w, pos[1] - .02, pos[2] + c * r + s * w]]; loft(part, [q(.25, .1), q(R, .1)], M.DARK); } const dsk = mk('disc9', pos); { const N = 28, pts = [[pos[0], pos[1] + .03, pos[2]]], idx = []; for (let k = 0; k < N; k++) { const t = k / N * 2 * Math.PI; pts.push([pos[0] + Math.sin(t) * R, pos[1] + .03, pos[2] + Math.cos(t) * R]); } for (let k = 0; k < N; k++) idx.push(0, 1 + k, 1 + (k + 1) % N, 0, 1 + (k + 1) % N, 1 + k); dsk.add(pts, idx, M.DISC); }
    if (tail) { const tp = mk('rotor1', tail); for (let b = 0; b < 2; b++) { const a = b * Math.PI; const c = Math.cos(a), s = Math.sin(a), q = (r, w) => [[tail[0] + .12, tail[1] + s * r - c * w, tail[2] + c * r + s * w], [tail[0] + .12, tail[1] + s * r + c * w, tail[2] + c * r - s * w], [tail[0] + .15, tail[1] + s * r + c * w, tail[2] + c * r - s * w], [tail[0] + .15, tail[1] + s * r - c * w, tail[2] + c * r + s * w]]; loft(tp, [q(.1, .05), q(spec.rotor.tailR || .9, .05)], M.DARK); } } }
  // landing gear (named nodes; pivot at the hinge)
  const gearParts = []; for (const gr of spec.gear || []) { const { name, x, y, z, r, len, fixed } = gr, part = mk(name + (fixed ? '_fixed' : ''), [x, y, z]); loft(part, [ring(z, .035, .035, y, x, 8), ring(z, .035, .035, y - len, x, 8)], M.METAL, false); loft(part, [ring(z - .11, r, r, y - len, x, 14), ring(z + .11, r, r, y - len, x, 14)], M.DARK); if (gr.skid) { loft(part, [ring(z + 1.0, .03, .03, y - len, x, 6), ring(z - 1.2, .03, .03, y - len, x, 6)], M.METAL, false); } if (gr.fairing) loft(part, [ring(z + .25, .09, .06, y - len * .5, x, 8), ring(z - .35, .08, .05, y - len * .6, x, 8)], M.BODY); }
  // lights
  for (const l of spec.lights || []) { const part = mk(l.name, l.pos); sphere(part, l.pos, l.r || .05, l.mat); }
  if (spec.extra) spec.extra(body);
  // normalise: lowest point -> y = 0
  let minY = 1e9; for (const p of parts) for (const q of p.p) minY = Math.min(minY, q[1]); for (const p of parts) { for (const q of p.p) q[1] -= minY; p.pivot[1] -= minY; }
  return parts;
}
// ---------- aircraft data ----------
const PA = (pal) => pal;
const SPEC = {
  c172: { fus: [[4.1, .05, .05, .22], [3.7, .3, .32, .36], [2.7, .5, .56, .52], [1.3, .55, .66, .55], [-.8, .48, .55, .55], [-3.0, .26, .28, .62], [-4.2, .09, .1, .72]], stripe: [3.0, -3.6, .0, .1], glass: [2.0, .4, .0], windows: { z0: 1.5, z1: -.2, n: 3, y: .15, h: .3, w: .4 },
    wings: [{ x0: .52, y0: 1.28, z0: .3, span: 5.05, cr: 1.6, ct: 1.2, sweep: .0, dih: 0, th: .13 }, { x0: .2, y0: .66, z0: -3.55, span: 1.8, cr: 1.1, ct: .72, th: .09 }], fin: { x0: 0, y0: .62, z0: -3.4, span: 1.55, cr: 1.4, ct: .8, sweep: .8, th: .08 }, finAcc: { x0: 0, y0: 1.5, z0: -3.9, span: .6, cr: .5, ct: .4, sweep: .1, th: .06 },
    props: [{ pos: [0, .3, 4.0], r: .95, blades: 2, hub: .13 }], gear: [{ name: 'gearL', x: -1.05, y: .45, z: .65, r: .21, len: .6, fixed: true, fairing: true }, { name: 'gearR', x: 1.05, y: .45, z: .65, r: .21, len: .6, fixed: true, fairing: true }, { name: 'gearN', x: 0, y: .2, z: 2.75, r: .17, len: .45, fixed: true }],
    lights: [{ name: 'navL', pos: [-5.58, 1.3, -.1], mat: M.NAVR }, { name: 'navR', pos: [5.58, 1.3, -.1], mat: M.NAVG }, { name: 'strobeL', pos: [-5.58, 1.3, -.45], mat: M.WHITE }, { name: 'strobeR', pos: [5.58, 1.3, -.45], mat: M.WHITE }, { name: 'beacon', pos: [0, 2.2, -3.7], mat: M.BEACON, r: .06 }] },
  pa28: { fus: [[3.7, .05, .05, .12], [3.3, .28, .3, .26], [2.3, .5, .52, .36], [.9, .53, .6, .42], [-1.0, .45, .48, .42], [-3.0, .22, .23, .45], [-3.9, .08, .08, .5]], stripe: [3.0, -3.2, .02, .09], glass: [1.7, -.2, .0], windows: { z0: 1.1, z1: -.4, n: 3, y: .2, h: .28, w: .38 },
    wings: [{ x0: .5, y0: .18, z0: .25, span: 4.6, cr: 1.65, ct: 1.15, dih: .12, th: .13 }, { x0: .2, y0: .52, z0: -3.2, span: 1.7, cr: 1.0, ct: .65, th: .08 }], fin: { x0: 0, y0: .45, z0: -2.85, span: 1.4, cr: 1.5, ct: .75, sweep: .9, th: .08 }, finAcc: { x0: 0, y0: 1.2, z0: -3.35, span: .5, cr: .5, ct: .4, sweep: .1, th: .06 },
    props: [{ pos: [0, .22, 3.65], r: .95, blades: 2, hub: .12 }], gear: [{ name: 'gearL', x: -1.1, y: .22, z: .4, r: .2, len: .58, fixed: true }, { name: 'gearR', x: 1.1, y: .22, z: .4, r: .2, len: .58, fixed: true }, { name: 'gearN', x: 0, y: .14, z: 2.25, r: .17, len: .5, fixed: true }],
    lights: [{ name: 'navL', pos: [-5.06, .3, 0], mat: M.NAVR }, { name: 'navR', pos: [5.06, .3, 0], mat: M.NAVG }, { name: 'strobeL', pos: [-5.06, .3, -.3], mat: M.WHITE }, { name: 'strobeR', pos: [5.06, .3, -.3], mat: M.WHITE }, { name: 'beacon', pos: [0, 1.6, -3.4], mat: M.BEACON, r: .06 }] },
  pc12: { fus: [[7.3, .1, .1, .12], [6.7, .45, .5, .22], [5.4, .85, .92, .38], [3.2, .95, 1.05, .42], [-1.0, .93, 1.03, .45], [-4.5, .75, .82, .56], [-6.4, .42, .46, .75], [-7.3, .12, .15, .9]], stripe: [5.8, -6.6, .0, .16], stripeSlope: .0, glass: [5.0, 3.9, .02], windows: { z0: 3.0, z1: -3.2, n: 7, y: .32, h: .32, w: .3 },
    wings: [{ x0: .85, y0: -.1, z0: .6, span: 7.3, cr: 2.0, ct: 1.0, sweep: .5, dih: .25, th: .14 }, { x0: .2, y0: .85, z0: -5.8, span: 2.4, cr: 1.5, ct: .8, sweep: .7, th: .08 }], fin: { x0: 0, y0: .85, z0: -5.3, span: 2.2, cr: 2.5, ct: 1.1, sweep: 1.7, th: .09 }, finAcc: { x0: 0, y0: 2.3, z0: -6.5, span: .8, cr: 1.2, ct: .9, sweep: .6, th: .07 }, winglets: [{ x0: 8.0, y0: .15, z0: -.25, span: .55, cr: .6, ct: .3, sweep: .25, th: .07, vertical: true, mat: 0, mirror: false }],
    props: [{ pos: [0, .38, 7.3], r: 1.3, blades: 5, hub: .22 }], gear: [{ name: 'gearL', x: -1.75, y: .1, z: .6, r: .3, len: .95 }, { name: 'gearR', x: 1.75, y: .1, z: .6, r: .3, len: .95 }, { name: 'gearN', x: 0, y: .1, z: 5.0, r: .26, len: .9 }],
    lights: [{ name: 'navL', pos: [-8.2, .27, -.4], mat: M.NAVR }, { name: 'navR', pos: [8.2, .27, -.4], mat: M.NAVG }, { name: 'strobeL', pos: [-8.2, .27, -.7], mat: M.WHITE }, { name: 'strobeR', pos: [8.2, .27, -.7], mat: M.WHITE }, { name: 'beacon', pos: [0, 3.1, -6.8], mat: M.BEACON, r: .07 }, { name: 'landing', pos: [0, .2, 5.9], mat: M.WHITE, r: .08 }] },
  kingair: { fus: [[7.2, .1, .1, .12], [6.5, .5, .55, .22], [5.1, .85, .95, .4], [-.5, .9, 1.0, .44], [-4.6, .7, .76, .6], [-6.6, .32, .36, .95], [-7.2, .1, .12, 1.1]], stripe: [6.0, -6.8, .02, .16], glass: [4.9, 3.7, .02], windows: { z0: 3.0, z1: -3.8, n: 8, y: .34, h: .3, w: .3 },
    wings: [{ x0: .85, y0: -.15, z0: .5, span: 7.9, cr: 2.35, ct: 1.0, sweep: .3, dih: .22, th: .14 }, { x0: 0, y0: 2.6, z0: -6.2, span: 3.1, cr: 1.5, ct: .8, sweep: .6, th: .08 }], fin: { x0: 0, y0: .95, z0: -5.7, span: 1.9, cr: 2.3, ct: 1.2, sweep: 1.5, th: .09 }, finAcc: { x0: 0, y0: .95, z0: -5.7, span: .0001, cr: .01, ct: .01, th: .01 },
    nacelles: [{ x: -2.65, y: .3, z0: 0.0, z1: 2.8, r: .38 }, { x: 2.65, y: .3, z0: 0.0, z1: 2.8, r: .38 }], props: [{ pos: [-2.65, .3, 2.75], r: 1.25, blades: 4, hub: .18 }, { pos: [2.65, .3, 2.75], r: 1.25, blades: 4, hub: .18 }],
    gear: [{ name: 'gearL', x: -2.65, y: -.05, z: 1.2, r: .3, len: .8 }, { name: 'gearR', x: 2.65, y: -.05, z: 1.2, r: .3, len: .8 }, { name: 'gearN', x: 0, y: .05, z: 4.6, r: .24, len: .85 }],
    lights: [{ name: 'navL', pos: [-8.75, .2, -.4], mat: M.NAVR }, { name: 'navR', pos: [8.75, .2, -.4], mat: M.NAVG }, { name: 'strobeL', pos: [-8.75, .2, -.7], mat: M.WHITE }, { name: 'strobeR', pos: [8.75, .2, -.7], mat: M.WHITE }, { name: 'beacon', pos: [0, 2.9, -6.7], mat: M.BEACON, r: .07 }, { name: 'landing', pos: [0, .1, 6.2], mat: M.WHITE, r: .08 }] },
  bizjet: { fus: [[7.3, .08, .08, .06], [6.6, .4, .44, .16], [5.3, .72, .82, .32], [-.5, .76, .88, .36], [-4.9, .58, .64, .52], [-7.0, .26, .3, .72], [-7.6, .1, .14, .85]], stripe: [6.0, -6.5, .0, .15], glass: [5.2, 4.2, .0], windows: { z0: 3.5, z1: -3.5, n: 7, y: .3, h: .28, w: .28 },
    wings: [{ x0: .72, y0: -.18, z0: .3, span: 7.0, cr: 2.3, ct: 1.0, sweep: 1.7, dih: .35, th: .11 }, { x0: 0, y0: 2.6, z0: -6.9, span: 2.5, cr: 1.5, ct: .8, sweep: .8, th: .07 }], fin: { x0: 0, y0: .9, z0: -6.1, span: 2.2, cr: 2.2, ct: 1.0, sweep: 1.5, th: .08 }, finAcc: { x0: 0, y0: 1.6, z0: -6.9, span: 1.0, cr: 1.1, ct: .8, sweep: .5, th: .06 }, winglets: [{ x0: 7.7, y0: .15, z0: -1.4, span: .6, cr: .7, ct: .3, sweep: .4, th: .06, vertical: true, mat: 0, mirror: false }],
    nacelles: [{ x: -1.15, y: .5, z0: -5.6, z1: -2.9, r: .4, mat: 0, intake: true }, { x: 1.15, y: .5, z0: -5.6, z1: -2.9, r: .4, mat: 0, intake: true }],
    gear: [{ name: 'gearL', x: -1.25, y: -.1, z: .3, r: .27, len: .85 }, { name: 'gearR', x: 1.25, y: -.1, z: .3, r: .27, len: .85 }, { name: 'gearN', x: 0, y: .05, z: 4.9, r: .22, len: .85 }],
    lights: [{ name: 'navL', pos: [-7.7, .2, -1.2], mat: M.NAVR }, { name: 'navR', pos: [7.7, .2, -1.2], mat: M.NAVG }, { name: 'strobeL', pos: [-7.7, .2, -1.5], mat: M.WHITE }, { name: 'strobeR', pos: [7.7, .2, -1.5], mat: M.WHITE }, { name: 'beacon', pos: [0, 3.1, -7.1], mat: M.BEACON, r: .07 }, { name: 'landing', pos: [0, .2, 6.2], mat: M.WHITE, r: .08 }] },
  heli: { fus: [[2.7, .1, .1, .5], [2.2, .55, .55, .7], [1.0, .95, .95, .85], [-.8, .9, .95, .9], [-2.0, .5, .55, .95], [-3.0, .22, .26, 1.0]], stripe: [2.0, -1.5, -.15, .12], glass: [2.1, .6, .0],
    wings: [{ x0: .1, y0: 1.2, z0: -5.6, span: .9, cr: .7, ct: .45, th: .08 }], fin: { x0: 0, y0: 1.25, z0: -5.3, span: 1.2, cr: 1.1, ct: .6, sweep: .7, th: .09 }, finAcc: { x0: 0, y0: 1.3, z0: -5.3, span: .0001, cr: .01, ct: .01, th: .01 },
    extra(body) { loft(body, [ring(-2.4, .2, .22, 1.05, 0, 10), ring(-4.4, .14, .17, 1.15, 0, 10), ring(-5.9, .09, .11, 1.25, 0, 10)], 0); loft(body, [ring(.5, .3, .1, 1.78, 0, 8), ring(-.4, .35, .12, 1.78, 0, 8)], 2); },
    rotor: { pos: [0, 2.15, .2], R: 5.4, blades: 4, tail: [0, 1.4, -5.9], tailR: .95 },
    gear: [{ name: 'skidL', x: -.95, y: .55, z: .2, r: .001, len: .6, fixed: true, skid: true }, { name: 'skidR', x: .95, y: .55, z: .2, r: .001, len: .6, fixed: true, skid: true }],
    lights: [{ name: 'navL', pos: [-.95, .95, 1.6], mat: M.NAVR }, { name: 'navR', pos: [.95, .95, 1.6], mat: M.NAVG }, { name: 'strobeL', pos: [0, 2.3, .2], mat: M.WHITE }, { name: 'strobeR', pos: [0, 1.3, -5.9], mat: M.WHITE }, { name: 'beacon', pos: [0, .5, -1.2], mat: M.BEACON, r: .08 }] },
  fighter: { fus: [[8.4, .03, .03, .1], [7.2, .22, .22, .16], [5.0, .55, .5, .25], [1.0, .75, .62, .26], [-4.0, .72, .56, .22], [-7.2, .5, .42, .15]], glass: [4.6, 1.8, .12],
    wings: [{ x0: .6, y0: .1, z0: -.4, span: 4.4, cr: 4.8, ct: 1.2, sweep: 3.1, dih: -.1, th: .05 }, { x0: .55, y0: .1, z0: -5.8, span: 2.3, cr: 2.2, ct: .9, sweep: 1.4, th: .05 }],
    extra(body) { for (const s of [-1, 1]) { loft(body, [ring(-8.1, .38, .38, .1, s * .5, 12), ring(-6.0, .5, .5, .1, s * .5, 12), ring(-3, .48, .48, .1, s * .5, 12)], 2); } for (const s of [-1, 1]) wing(body, { x0: s * .75, y0: .6, z0: -5.0, span: 1.8, cr: 2.4, ct: 1.0, sweep: 1.7, th: .06, vertical: true, mat: 1, mirror: false }); },
    gear: [{ name: 'gearL', x: -1.4, y: .1, z: -.8, r: .24, len: .85 }, { name: 'gearR', x: 1.4, y: .1, z: -.8, r: .24, len: .85 }, { name: 'gearN', x: 0, y: .1, z: 4.6, r: .2, len: .8 }],
    lights: [{ name: 'navL', pos: [-5.0, .0, -3.6], mat: M.NAVR }, { name: 'navR', pos: [5.0, .0, -3.6], mat: M.NAVG }, { name: 'strobeL', pos: [-.75, 1.9, -6.0], mat: M.WHITE }, { name: 'strobeR', pos: [.75, 1.9, -6.0], mat: M.WHITE }, { name: 'beacon', pos: [0, .75, 1.0], mat: M.BEACON, r: .08 }] },
};
// ---------- GLB writer (one mesh per part, node per part with translation = pivot) ----------
function glb(parts, pal) {
  const mats = [{ n: 'body', c: lin(pal.body), r: .32, m: .15, cc: 1 }, { n: 'accent', c: lin(pal.accent), r: .38, m: .1, cc: .8 }, { n: 'dark', c: lin(pal.dark), r: .6, m: .2 }, { n: 'glass', c: lin('#1b2b3d'), r: .06, m: .7 }, { n: 'disc', c: lin('#d5dde3'), r: .8, a: .16 }, { n: 'metal', c: lin('#aeb4ba'), r: .35, m: 1 }, { n: 'navR', c: lin('#ff2d2d'), r: .5, e: lin('#ff2020') }, { n: 'navG', c: lin('#20e060'), r: .5, e: lin('#20e060') }, { n: 'white', c: lin('#ffffff'), r: .4, e: lin('#ffffff') }, { n: 'beacon', c: lin('#ff3030'), r: .5, e: lin('#ff3030') }];
  const chunks = [], views = [], accs = [], meshes = [], nodes = [{ name: pal.name, children: [] }]; let off = 0; const push = (buf, target) => { const pad = (4 - buf.length % 4) % 4; views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, ...(target ? { target } : {}) }); chunks.push(buf, Buffer.alloc(pad)); off += buf.length + pad; return views.length - 1; };
  for (const part of parts) {
    const P = []; for (const q of part.p) P.push(q[0] - part.pivot[0], q[1] - part.pivot[1], q[2] - part.pivot[2]); const nrm = new Float32Array(P.length), all = [], prims = [];
    part.m.forEach((idx, mi) => { if (idx && idx.length) { prims.push({ mi, start: all.length, n: idx.length }); all.push(...idx); } }); if (!all.length) continue;
    for (let t = 0; t < all.length; t += 3) { const [a, b, c] = [all[t], all[t + 1], all[t + 2]], A = P.slice(a * 3, a * 3 + 3), B = P.slice(b * 3, b * 3 + 3), C = P.slice(c * 3, c * 3 + 3), u = B.map((v, i) => v - A[i]), v = C.map((w, i) => w - A[i]), n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; for (const k of [a, b, c]) for (let i = 0; i < 3; i++) nrm[k * 3 + i] += n[i]; }
    for (let k = 0; k < nrm.length; k += 3) { const l = Math.hypot(nrm[k], nrm[k + 1], nrm[k + 2]) || 1; nrm[k] /= l; nrm[k + 1] /= l; nrm[k + 2] /= l; }
    const Pf = new Float32Array(P), mn = [0, 1, 2].map(i => Math.min(...Array.from({ length: Pf.length / 3 }, (_, k) => Pf[k * 3 + i]))), mx = [0, 1, 2].map(i => Math.max(...Array.from({ length: Pf.length / 3 }, (_, k) => Pf[k * 3 + i])));
    const vp = push(Buffer.from(Pf.buffer), 34962), vn = push(Buffer.from(nrm.buffer), 34962), vi = push(Buffer.from(new Uint16Array(all).buffer), 34963);
    accs.push({ bufferView: vp, componentType: 5126, count: Pf.length / 3, type: 'VEC3', min: mn, max: mx }); const ap = accs.length - 1; accs.push({ bufferView: vn, componentType: 5126, count: Pf.length / 3, type: 'VEC3' }); const an = accs.length - 1;
    const primitives = prims.map(p => { accs.push({ bufferView: vi, byteOffset: p.start * 2, componentType: 5123, count: p.n, type: 'SCALAR' }); return { attributes: { POSITION: ap, NORMAL: an }, indices: accs.length - 1, material: p.mi }; });
    meshes.push({ name: part.name, primitives }); nodes.push({ name: part.name, mesh: meshes.length - 1, ...(part.pivot.some(v => v) ? { translation: part.pivot.map(v => +v.toFixed(5)) } : {}) }); nodes[0].children.push(nodes.length - 1);
  }
  const j = { asset: { version: '2.0', generator: 'SkyDeck tools/make-models.js v2 (CC0)' }, extensionsUsed: ['KHR_materials_clearcoat'], scene: 0, scenes: [{ nodes: [0] }], nodes, meshes,
    materials: mats.map(m => ({ name: m.n, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [...m.c, m.a || 1], metallicFactor: m.m || 0, roughnessFactor: m.r }, ...(m.e ? { emissiveFactor: m.e } : {}), ...(m.a ? { alphaMode: 'BLEND' } : {}), ...(m.cc ? { extensions: { KHR_materials_clearcoat: { clearcoatFactor: m.cc, clearcoatRoughnessFactor: .08 } } } : {}) })), accessors: accs, bufferViews: views, buffers: [{ byteLength: off }] };
  let js = Buffer.from(JSON.stringify(j)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]); const bin = Buffer.concat(chunks);
  const h = Buffer.alloc(12); h.write('glTF'); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8); const c1 = Buffer.alloc(8); c1.writeUInt32LE(js.length, 0); c1.write('JSON', 4); const c2 = Buffer.alloc(8); c2.writeUInt32LE(bin.length, 0); c2.write('BIN\0', 4);
  return Buffer.concat([h, c1, js, c2, bin]);
}
const BASE = { body: '#f4f6f8', accent: '#2a4f8f', dark: '#2b3037' };
fs.mkdirSync(OUT, { recursive: true });
const LIV = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'liveries.json'), 'utf8'));
const jobs = Object.keys(SPEC).map(t => [t, t, BASE]); for (const [tail, l] of Object.entries(LIV.tails)) jobs.push([l.type, tail.toLowerCase() + '-' + l.type, { ...BASE, ...l.palette }]);
for (const [type, name, pal] of jobs) { const spec = SPEC[type]; const parts = build(spec); if (spec.extra) { /* extra geometry is built into the body part pre-normalisation */ } const b = glb(parts, { ...pal, name }); fs.writeFileSync(path.join(OUT, name + '.glb'), b); console.log(name, b.length, 'bytes', parts.length + ' parts', parts.reduce((s, p) => s + p.p.length, 0) + ' verts'); }
