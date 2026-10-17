// Robustness fuzz for js/flightpath.js: real traces (every segmented flight in /tmp/tr2 or docs fixtures) + synthetic odd cases (touch-and-go, no ground, tiny, NaN, dupes, stationary, antimeridian, huge gaps).  node tests/fuzz-path.mjs [dir]
import fs from 'fs'; import { buildPath } from '../js/flightpath.js';
const src = fs.readFileSync(new URL('../js/replay.js', import.meta.url), 'utf8'); const segSrc = src.slice(src.indexOf('export function segmentFlights'), src.indexOf('export class Replay')).replace('export function', 'function'); const segmentFlights = new Function(segSrc + '; return segmentFlights;')();
const parse = j => { const t0 = j.timestamp * 1000, pts = []; for (const p of j.trace || []) { if (p[1] == null) continue; const gnd = p[3] === 'ground'; pts.push({ t: t0 + p[0] * 1000, lat: p[1], lon: p[2], alt: gnd ? 0 : (typeof p[3] === 'number' ? p[3] : null), ag: gnd ? undefined : (typeof p[10] === 'number' ? p[10] : undefined), gnd, gs: p[4] ?? 0, trk: p[5] ?? 0, vr: p[7] ?? 0 }); } return pts; };
const fin = o => Object.values(o).every(v => typeof v !== 'number' || isFinite(v));
let bad = 0, n = 0; const report = (name, P, pts) => { n++; if (!P) { console.log('NULL path', name, 'pts', pts?.length); return; } const issues = []; let prev = null, maxJump = 0, maxH = 0, maxP = 0, minH = 1e9;
  for (let t = P.t0 - 5; t <= P.t1 + 5; t += Math.max(0.1, (P.t1 - P.t0) / 4000)) { const q = P.at(t); if (!q || !fin(q) || ![q.lat, q.lon, q.h, q.hdg, q.hdgU, q.pitch, q.bank, q.gear, q.spd, q.vz].every(Number.isFinite)) { issues.push('nonfinite@' + (t - P.t0).toFixed(1)); break; } if (Math.abs(q.lat) > 90 || Math.abs(q.lon) > 180.0001) { issues.push('range lat/lon'); break; } minH = Math.min(minH, q.h); if (prev) { const dt = t - prev.t; maxH = Math.max(maxH, Math.abs(((q.hdg - prev.hdg + 540) % 360) - 180) / dt); maxP = Math.max(maxP, Math.abs(q.pitch - prev.pitch) / dt); } prev = q; }
  if (issues.length) { bad++; console.log('FAIL', name, issues.join(','), JSON.stringify(P.stats)); } else console.log('ok  ', name.padEnd(46), 'N', P.N, 'lift', P.stats.liftoffs, 'td', P.stats.touchdowns, 'est%', P.stats.estPct, 'maxHdgRate', maxH.toFixed(1), 'maxPitchRate', maxP.toFixed(1), 'minH', minH.toFixed(0)); };
const dir = process.argv[2] || '/tmp/tr2';
for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : []) { let pts; try { pts = parse(JSON.parse(fs.readFileSync(dir + '/' + f))); } catch { continue; } if (pts.length < 2) continue; const fl = segmentFlights(pts); fl.forEach((fo, i) => { let P; try { P = buildPath(fo.pts, { ground: { dep: 100, arr: 100 }, geoidDefault: 30 }); } catch (e) { bad++; console.log('THROW', f, i, e.message); return; } report(`${f.replace('.json', '')}#${i} (${fo.pts.length} pts, ${fo.start}->${fo.end})`, P, fo.pts); }); }
// synthetic cases
const mk = (n, f) => Array.from({ length: n }, (_, i) => ({ t: 1.79e12 + i * 6000, lat: 37.06, lon: -88.77, alt: 0, gnd: false, gs: 100, trk: 90, vr: 0, ...f(i) }));
const C = {
  'pattern touch-and-go (no ground flags)': mk(300, i => { const ph = (i % 60) / 60; return { lat: 37.06 + 0.01 * Math.sin(ph * 6.28), lon: -88.77 + 0.02 * Math.cos(ph * 6.28), alt: 400 + 600 * Math.max(0, Math.sin(ph * 3.14)), gs: 80, trk: (ph * 360) % 360, vr: 0, gnd: false }; }),
  'pattern with ground flags each circuit': mk(300, i => { const ph = (i % 60) / 60, low = ph < 0.1; return { lat: 37.06 + 0.01 * Math.sin(ph * 6.28), lon: -88.77 + 0.02 * Math.cos(ph * 6.28), alt: low ? 0 : 400 + 600 * Math.sin(ph * 3.14), gnd: low, gs: low ? 40 : 80, trk: (ph * 360) % 360 }; }),
  'airborne only (no ground points)': mk(80, i => ({ lat: 37 + i * 0.0035, lon: -88 + i * 0.0035, alt: 3000 + i * 10, trk: 45, gs: 150 })),
  'all ground (never flew)': mk(40, i => ({ gnd: true, alt: 0, gs: 5, trk: 0 })),
  '6 points': mk(6, i => ({ lat: 37 + i * 0.004, alt: 1000 })),
  '3 points': mk(3, i => ({ lat: 37 + i * 0.01, alt: 1000 })),
  '2 points': mk(2, i => ({ lat: 37 + i * 0.01, alt: 1000 })),
  '1 point': mk(1, i => ({ alt: 1000 })),
  'null altitudes': mk(60, i => ({ alt: null, lat: 37 + i * 0.002 })),
  'NaN lat/lon/gs/trk': mk(60, i => i % 7 === 3 ? { lat: NaN, lon: NaN, gs: NaN, trk: NaN, alt: NaN } : { lat: 37 + i * 0.002, alt: 2000 }),
  'undefined gs/trk/vr': mk(60, i => ({ gs: undefined, trk: undefined, vr: undefined, lat: 37 + i * 0.002, alt: 2000 })),
  'duplicate timestamps': mk(60, i => ({ t: 1.79e12 + Math.floor(i / 3) * 6000, lat: 37 + i * 0.001, alt: 2000 })),
  'out-of-order timestamps': mk(60, i => ({ t: 1.79e12 + ((i * 37) % 60) * 6000, lat: 37 + ((i * 37) % 60) * 0.001, alt: 2000 })),
  'stationary (same pos, airborne)': mk(60, i => ({ alt: 2000, gs: 0 })),
  'stationary hover heli': mk(60, i => ({ alt: 500, gs: 0, trk: 0 })),
  'antimeridian crossing': mk(80, i => { const l = 179.8 + i * 0.01; return { lon: l > 180 ? l - 360 : l, alt: 30000, trk: 90, gs: 360 }; }),
  'poles-ish lat 89.9': mk(40, i => ({ lat: 89.9, lon: -88 + i, alt: 3000 })),
  'huge gap (3 h) in flight': mk(60, i => ({ t: 1.79e12 + i * 6000 + (i > 30 ? 3 * 3600e3 : 0), lat: 37 + i * 0.002, alt: 3000 })),
  'speed spike teleport': mk(60, i => ({ lat: 37 + (i === 30 ? 2 : i * 0.002), alt: 3000 })),
  'altitude spike': mk(60, i => ({ lat: 37 + i * 0.002, alt: i === 30 ? 60000 : 3000 })),
  'negative altitude (Dead Sea / bad baro)': mk(60, i => ({ lat: 37 + i * 0.002, alt: -1200 })),
  'ground start/end + 1 airborne pt': mk(20, i => ({ gnd: i !== 10, alt: i === 10 ? 800 : 0, gs: i === 10 ? 90 : 3, lat: 37 + i * 0.001 })),
  'sub-second timestamps (dense 50 Hz)': mk(400, i => ({ t: 1.79e12 + i * 20, lat: 37 + i * 0.00001, alt: 2000 })),
  '24 h flight': mk(1200, i => ({ t: 1.79e12 + i * 72000, lat: 37 + Math.sin(i / 40) * 2, lon: -88 + Math.cos(i / 40) * 2, alt: 30000 })),
};
for (const [name, pts] of Object.entries(C)) { let P; try { P = buildPath(pts, { ground: { dep: 100, arr: 100 }, geoidDefault: 30 }); } catch (e) { bad++; console.log('THROW', name, e.message.slice(0, 120)); continue; } if (!P) { console.log('null', name, '(no path -> UI must show a note)'); continue; } report('SYN ' + name, P, pts); }
console.log(`\n${n} paths checked, ${bad} failures`); process.exitCode = bad ? 1 : 0;
