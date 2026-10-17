// Before/after smoothness metrics of the replay pipeline on real ADS-B Exchange traces.  node tests/replay-metrics.mjs   (traces fetched through the local proxy)
import fs from 'fs';
import { buildPath } from '../js/flightpath.js';
const B = process.env.BASE || 'http://127.0.0.1:8080/', FT = 0.3048, rad = x => x * Math.PI / 180, deg = x => x * 180 / Math.PI;
const parse = j => { const t0 = j.timestamp * 1000, pts = []; for (const p of j.trace) { if (p[1] == null) continue; const gnd = p[3] === 'ground'; pts.push({ t: t0 + p[0] * 1000, lat: p[1], lon: p[2], alt: gnd ? 0 : (typeof p[3] === 'number' ? p[3] : null), ag: gnd ? undefined : (typeof p[10] === 'number' ? p[10] : undefined), gnd, gs: p[4] ?? 0, trk: p[5] ?? 0, vr: p[7] ?? 0 }); } return pts; };
const bearing = (la1, lo1, la2, lo2) => { const f1 = rad(la1), f2 = rad(la2), dl = rad(lo2 - lo1); return (deg(Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl))) + 360) % 360; };
function oldSample(pts, t) { if (t < pts[0].t || t > pts[pts.length - 1].t) return null; let lo = 0, hi = pts.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].t <= t) lo = m; else hi = m; } const a = pts[lo], b = pts[hi], f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t); let dl = b.lon - a.lon; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
  const alt = a.gnd && b.gnd ? 0 : ((a.gnd ? b.alt : a.alt) ?? 0) * (1 - f) + ((b.gnd ? a.alt : b.alt) ?? 0) * f; const trk = (Math.hypot(b.lat - a.lat, dl) > 1e-5) ? bearing(a.lat, a.lon, b.lat, b.lon) : a.trk;
  const gnd = a.gnd && b.gnd; return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + dl * f, h: Math.max(gnd ? 0 : 3, alt * FT), hdg: trk, pitch: Math.max(-8, Math.min(12, (a.vr || 0) / 60)) * 0.8, bank: 0, gnd }; }
const dist = (a, b) => { const k = 111320, dx = (b.lon - a.lon) * k * Math.cos(rad(a.lat)), dy = (b.lat - a.lat) * 110574, dz = b.h - a.h; return { h: Math.hypot(dx, dy), z: dz }; };
function metrics(fn, t0, t1, dt) {
  let prev = null, uh = 0, m = { maxHdgRate: 0, hdgSpikes: 0, maxPitchRate: 0, pitchMin: 99, pitchMax: -99, maxVz: 0, maxAltStep: 0, maxBankRate: 0, maxBank: 0, maxGroundSpeed: 0 }; let ph = null;
  for (let t = t0; t <= t1; t += dt) { const s = fn(t); if (!s) continue; if (prev) { let dh = ((s.hdg - prev.hdg + 540) % 360) - 180; const r = Math.abs(dh) / dt; m.maxHdgRate = Math.max(m.maxHdgRate, r); if (r > 30) m.hdgSpikes++; m.maxPitchRate = Math.max(m.maxPitchRate, Math.abs(s.pitch - prev.pitch) / dt); const d = dist(prev, s); m.maxVz = Math.max(m.maxVz, Math.abs(d.z) / dt); m.maxAltStep = Math.max(m.maxAltStep, Math.abs(d.z)); m.maxBankRate = Math.max(m.maxBankRate, Math.abs(s.bank - prev.bank) / dt); m.maxGroundSpeed = Math.max(m.maxGroundSpeed, d.h / dt); } m.pitchMin = Math.min(m.pitchMin, s.pitch); m.pitchMax = Math.max(m.pitchMax, s.pitch); m.maxBank = Math.max(m.maxBank, Math.abs(s.bank)); prev = s; }
  for (const k in m) m[k] = +m[k].toFixed(2); return m;
}
async function get(hex, day) { const r = await fetch(`${B}api/trace/${hex}?kind=day&day=${day}`); return parse(await r.json()); }
function flights(pts) { const out = []; let i = 0; while (i < pts.length - 1) { if (pts[i].gnd && !pts[i + 1].gnd) { let j = i + 1; while (j < pts.length && !pts[j].gnd) j++; if (j < pts.length) out.push([Math.max(0, i - 8), Math.min(pts.length, j + 8)]); i = j; } else i++; } return out; }
const CASES = [['N291KY PC-12 (KPAH-KDTO)', 'a2fa29', '2026-10-12', 0], ['N28027 PA-28 (pattern work)', 'a2d0b9', '2026-10-15', 0], ['N8537Z B738 airline', 'abb5e2', '2026-10-16', 0]];
const res = []; for (const [name, hex, day] of CASES) {
  const pts = await get(hex, day); const fl = flights(pts).filter(([a, b]) => b - a > 20); const [a, b] = name.includes('B738') ? fl[0] : name.includes('PA-28') ? fl.find(([a, b]) => b - a > 60) || fl[0] : fl[0]; const seg = pts.slice(a, b);
  const P = buildPath(seg, { ground: { dep: 120, arr: 120 } }); const o = t => oldSample(seg, t * 1000), n = t => P.at(t);
  const T0 = seg[0].t / 1000, T1 = seg[seg.length - 1].t / 1000, ev = P.events; const tl = ev.lift[0], tt = ev.td[ev.td.length - 1];
  const wins = { takeoff: [tl - 60, tl + 120], landing: [tt - 150, tt + 60], whole: [T0, T1] };
  for (const [wn, [w0, w1]] of Object.entries(wins)) for (const dt of [1 / 30, 1]) { res.push({ case: name, window: wn, dt: dt < 0.5 ? '1x (33 ms)' : '30x (1 s/frame)', before: metrics(o, Math.max(T0, w0), Math.min(T1, w1), dt), after: metrics(n, Math.max(T0, w0), Math.min(T1, w1), dt) }); }
  res.push({ case: name, stats: P.stats });
  { const ser = { name, raw: seg.map(p => ({ t: p.t / 1000, h: p.gnd ? 0 : (p.alt ?? 0) * FT, gs: p.gs * 0.514444, vr: (p.vr || 0) * FT / 60, gnd: p.gnd })), clean: [], old: [], lift: P.events.lift, td: P.events.td }; for (let t = T0; t <= T1; t += 0.5) { const q = P.at(t), o2 = oldSample(seg, t * 1000); if (q) ser.clean.push({ t, h: q.h, spd: q.spd, pitch: q.pitch, bank: q.bank, hdg: q.hdg }); if (o2) ser.old.push({ t, h: o2.h, pitch: o2.pitch, hdg: o2.hdg }); } if (!name.includes('B738') && !name.includes('PA-28')) fs.writeFileSync(new URL('../docs/replay-series.json', import.meta.url), JSON.stringify(ser)); }
}
fs.writeFileSync(new URL('../docs/replay-metrics.json', import.meta.url), JSON.stringify(res, null, 1));
for (const r of res) { if (r.stats) { console.log(r.case, JSON.stringify(r.stats)); continue; } console.log(`${r.case} | ${r.window} | ${r.dt}\n  before ${JSON.stringify(r.before)}\n  after  ${JSON.stringify(r.after)}`); }
