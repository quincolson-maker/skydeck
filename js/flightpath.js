// Flight-path pipeline for replay: clean raw ADS-B points -> resample at a fixed rate with Hermite/PCHIP splines -> derive heading / pitch / bank / gear from the
// smoothed path (never from the raw track field), anchor altitude to the terrain at take-off and landing, snap ground roll to the runway. Pure functions (no Cesium).
// Honesty: every sample inside a reporting gap (> 20 s airborne / > 60 s on the ground) is flagged `est` (interpolated); nothing is invented outside the first/last point.
const D2R = Math.PI / 180, KT = 0.514444, FT = 0.3048, G = 9.80665, MLAT = 110574, MLON = 111320;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), sstep = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const hav = (a, b) => { const dl = (b.lon - a.lon) * D2R, p1 = a.lat * D2R, p2 = b.lat * D2R, x = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(x)); };
function gauss(arr, sig) {   // sig in samples
  if (sig < 0.3) return Float64Array.from(arr); const R = Math.ceil(sig * 3), k = [], n = arr.length; let s = 0; for (let i = -R; i <= R; i++) { const w = Math.exp(-i * i / (2 * sig * sig)); k.push(w); s += w; }
  const out = new Float64Array(n); for (let i = 0; i < n; i++) { let a = 0; for (let j = -R; j <= R; j++) a += k[j + R] * arr[clamp(i + j, 0, n - 1)]; out[i] = a / s; } return out;
}
function pchip(ts, ys) {   // monotone cubic slopes (Fritsch-Carlson)
  const n = ts.length, d = new Array(n).fill(0), h = [], del = []; for (let i = 0; i < n - 1; i++) { h.push(ts[i + 1] - ts[i]); del.push((ys[i + 1] - ys[i]) / h[i]); }
  if (n === 1) return d; if (n === 2) { d[0] = d[1] = del[0]; return d; }
  for (let i = 1; i < n - 1; i++) { if (del[i - 1] * del[i] <= 0) d[i] = 0; else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; d[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i]); } }
  d[0] = del[0]; d[n - 1] = del[n - 2]; return d;
}
const herm = (t0, t1, p0, p1, m0, m1, t) => { const h = t1 - t0, s = (t - t0) / h, s2 = s * s, s3 = s2 * s; return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * h * m1; };
// ---------- 1. clean ----------
export function cleanPoints(raw) {
  const st = { raw: raw.length, dupes: 0, posOutliers: 0, altOutliers: 0, altSrc: 'baro' };
  const pts = raw.filter(p => p && isFinite(p.lat) && isFinite(p.lon) && isFinite(p.t)).sort((a, b) => a.t - b.t).map(p => ({ ...p }));
  const out = []; for (const p of pts) { const l = out[out.length - 1]; if (l && p.t - l.t < 300) { st.dupes++; continue; } if (l) { const dt = (p.t - l.t) / 1000, d = hav(l, p), vmax = Math.max(l.gs || 0, p.gs || 0, 40) * KT * 1.8 + 120 / Math.max(dt, 1); if (d / dt > vmax && d > 250) { st.posOutliers++; continue; } } out.push(p); }
  // altitude source: geometric (ellipsoid) when present for most airborne points, else baro. Points lacking the preferred source get baro + local (geom-baro) offset so the series never steps.
  const air = out.filter(p => !p.gnd && p.alt != null), nag = air.filter(p => p.ag != null).length; const useG = air.length && nag / air.length > 0.5; st.altSrc = useG ? 'geometric' : 'baro';
  if (useG) { const dd = out.filter(p => p.ag != null && p.alt != null).map(p => ({ t: p.t, d: p.ag - p.alt })); for (const p of out) if (!p.gnd) { if (p.ag != null) p.h = p.ag; else if (p.alt != null && dd.length) { let j = 0; while (j < dd.length - 1 && dd[j].t < p.t) j++; p.h = p.alt + dd[j].d; } else p.h = null; } }
  else for (const p of out) if (!p.gnd) p.h = p.alt;
  // Hampel filter on altitude (feet)
  const idx = out.map((p, i) => i).filter(i => !out[i].gnd && out[i].h != null);
  for (let k = 0; k < idx.length; k++) { const w = idx.slice(Math.max(0, k - 3), k + 4).map(i => out[i].h === undefined ? 0 : out[i].h), m = med(w), mad = med(w.map(v => Math.abs(v - m))), p = out[idx[k]]; if (Math.abs(p.h - m) > Math.max(400, 5 * mad)) { p.h = m; st.altOutliers++; } }
  for (const p of out) { if (!p.gnd && p.h == null) p.h = null; }
  return { pts: out, st };
}
// ---------- 2-5. build ----------
// opts: { ground: {dep, arr} metres (terrain/airport height in the rendered frame), groundFn(lat,lon)->m|null, runways:[{a:[lat,lon], b:[lat,lon], halfW}], hz, geoidDefault }
export function buildPath(raw, opts = {}) {
  const { pts, st } = cleanPoints(raw); if (pts.length < 2) return null;
  const t0 = pts[0].t / 1000, t1 = pts[pts.length - 1].t / 1000, dur = t1 - t0, dt = Math.max(1 / (opts.hz || 10), dur / 60000), N = Math.floor(dur / dt) + 1;
  // unwrap lon
  let lonU = [pts[0].lon]; for (let i = 1; i < pts.length; i++) { let d = pts[i].lon - pts[i - 1].lon; d = ((d + 540) % 360) - 180; lonU.push(lonU[i - 1] + d); }
  const T = pts.map(p => p.t / 1000), la = pts.map(p => p.lat), lo = lonU;
  // tangents (deg/s) from reported gs+track where consistent with finite differences
  const mLa = [], mLo = []; for (let i = 0; i < pts.length; i++) {
    const a = Math.max(0, i - 1), b = Math.min(pts.length - 1, i + 1), fdLa = (la[b] - la[a]) / (T[b] - T[a] || 1), fdLo = (lo[b] - lo[a]) / (T[b] - T[a] || 1); let vLa = fdLa, vLo = fdLo; const p = pts[i];
    if (p.gs > 8 && p.trk != null) { const v = p.gs * KT, rLa = v * Math.cos(p.trk * D2R) / MLAT, rLo = v * Math.sin(p.trk * D2R) / (MLON * Math.cos(p.lat * D2R)), fm = Math.hypot(fdLa * MLAT, fdLo * MLON * Math.cos(p.lat * D2R)); if (Math.hypot((rLa - fdLa) * MLAT, (rLo - fdLo) * MLON * Math.cos(p.lat * D2R)) < 0.5 * fm + 4) { vLa = rLa; vLo = rLo; } }
    mLa.push(vLa); mLo.push(vLo);
  }
  // liftoff / touchdown events (from ground<->air transitions; the transition lies somewhere in the gap, assume the middle, bounded to 8 s before the first airborne fix)
  const ev = { lift: [], td: [] }; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; if (a.gnd && !b.gnd) ev.lift.push({ i, t: Math.max(T[i - 1], T[i] - Math.min(8, (T[i] - T[i - 1]) / 2)) }); if (!a.gnd && b.gnd) ev.td.push({ i, t: Math.min(T[i], T[i - 1] + Math.min(8, (T[i] - T[i - 1]) / 2) + 0) }); }
  // altitude knots (metres, un-anchored): airborne fixes + synthetic knot at each event time at "ground" level extrapolated with the reported vertical rate
  const kt = [], kh = [];
  const addK = (t, h) => { if (kt.length && t <= kt[kt.length - 1] + 0.05) return; kt.push(t); kh.push(h); };
  for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (p.gnd || p.h == null) continue; const L = ev.lift.find(e => e.i === i), prevG = i > 0 && pts[i - 1].gnd; if (prevG && L) { const vz = (p.vr || 0) * FT / 60, hb = p.h * FT, h0 = Math.min(hb, hb - vz * (T[i] - L.t)); addK(L.t, h0); } addK(T[i], p.h * FT); const nextG = i < pts.length - 1 && pts[i + 1].gnd, Tt = ev.td.find(e => e.i === i + 1); if (nextG && Tt) { const vz = (p.vr || 0) * FT / 60, h1 = Math.min(p.h * FT, p.h * FT + vz * (Tt.t - T[i])); addK(Tt.t, h1); } }
  const airborneAny = kt.length > 0, sl = kt.length ? pchip(kt, kh) : [];
  // anchors: terrain height at first liftoff and last touchdown
  const g = opts.ground || {}, first = ev.lift[0], last = ev.td[ev.td.length - 1]; const h0k = first && kt.length ? kh[kt.findIndex(t => Math.abs(t - first.t) < 0.06)] : null, h1k = last && kt.length ? kh[kt.findIndex(t => Math.abs(t - last.t) < 0.06)] : null;
  let offDep = (g.dep != null && h0k != null) ? g.dep - h0k : null, offArr = (g.arr != null && h1k != null) ? g.arr - h1k : null;
  const dflt = st.altSrc === 'geometric' ? (opts.geoidDefault ?? 30) : 0; if (offDep == null && offArr == null) { offDep = offArr = dflt; } else if (offDep == null) offDep = offArr; else if (offArr == null) offArr = offDep;
  const tA = first ? first.t : t0, tB = last ? last.t : t1; const offAt = t => tB <= tA ? offDep : offDep + (offArr - offDep) * clamp((t - tA) / (tB - tA), 0, 1);
  // sample grid
  const lat = new Float64Array(N), lon = new Float64Array(N), hA = new Float64Array(N), gnd = new Uint8Array(N), est = new Uint8Array(N), tg = new Float64Array(N); let seg = 0, ks = 0;
  const groundAt = (la_, lo_) => opts.groundFn ? opts.groundFn(la_, lo_) : null;
  for (let n = 0; n < N; n++) {
    const t = t0 + n * dt; tg[n] = t; while (seg < pts.length - 2 && T[seg + 1] < t) seg++; const i = seg, j = seg + 1, gap = T[j] - T[i];
    lat[n] = herm(T[i], T[j], la[i], la[j], clamp(mLa[i], -1e3, 1e3), clamp(mLa[j], -1e3, 1e3), clamp(t, T[i], T[j])); lon[n] = herm(T[i], T[j], lo[i], lo[j], mLo[i], mLo[j], clamp(t, T[i], T[j]));
    const bothG = pts[i].gnd && pts[j].gnd; est[n] = gap > (bothG ? 60 : 20) ? 1 : 0;
    // ground state: on ground until the liftoff event of this gap, airborne after; reverse for touchdown
    let onG; if (pts[i].gnd && pts[j].gnd) onG = 1; else if (pts[i].gnd && !pts[j].gnd) { const L = ev.lift.find(e => e.i === j); onG = t < (L ? L.t : T[i]) ? 1 : 0; } else if (!pts[i].gnd && pts[j].gnd) { const Tt = ev.td.find(e => e.i === j); onG = t >= (Tt ? Tt.t : T[j]) ? 1 : 0; } else onG = 0; gnd[n] = onG;
    if (!onG && airborneAny) { while (ks < kt.length - 2 && kt[ks + 1] < t) ks++; const a = ks, b = Math.min(kt.length - 1, ks + 1); hA[n] = kt.length === 1 ? kh[0] : herm(kt[a], kt[b], kh[a], kh[b], sl[a], sl[b], clamp(t, kt[a], kt[b])) + offAt(t); } else hA[n] = NaN;
  }
  // ground height profile (terrain) and final height
  const h = new Float64Array(N), gh = new Float64Array(N), known = new Uint8Array(N); for (let n = 0; n < N; n++) { const gg = groundAt(lat[n], lon[n]); known[n] = gg != null ? 1 : 0; gh[n] = gg != null ? gg : (n ? gh[n - 1] : (g.dep ?? 0)); }
  const ghs = gauss(gh, 2.5 / dt); for (let n = 0; n < N; n++) h[n] = gnd[n] || isNaN(hA[n]) ? (gnd[n] ? ghs[n] : (n ? h[n - 1] : ghs[n])) : hA[n];
  // smooth altitude of airborne stretch lightly, never below terrain+gear
  const hs = gauss(h, 2.0 / dt); for (let n = 0; n < N; n++) h[n] = gnd[n] ? h[n] : Math.max(hs[n], known[n] ? ghs[n] + 1.5 : -1e9);
  // ---- runway snap (position + heading) on the ground roll ----
  let rwyHdg = new Float64Array(N).fill(NaN), snapW = new Float64Array(N);
  if (opts.runways?.length) for (let n = 0; n < N; n++) {
    if (!gnd[n]) continue; const cl = Math.cos(lat[n] * D2R); let best = null;
    for (const r of opts.runways) { const ax = r.a[1] * MLON * cl, ay = r.a[0] * MLAT, bx = r.b[1] * MLON * cl, by = r.b[0] * MLAT, px = lon[n] * MLON * cl, py = lat[n] * MLAT, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, s = clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1), qx = ax + s * dx, qy = ay + s * dy, d = Math.hypot(px - qx, py - qy); if (d < (r.halfW || 20) + 12 && (!best || d < best.d)) best = { d, qx, qy, hdg: Math.atan2(dx, dy) / D2R, r, cl }; }
    if (best) { rwyHdg[n] = best.hdg; snapW[n] = 1 - sstep((best.d - (best.r.halfW || 20) * 0.6) / 20); best.pull = best; lon[n] = lon[n] + (best.qx / (MLON * best.cl) - lon[n]) * 0.0; /* position pull applied after speed is known */ rwyHdg._q = rwyHdg._q || []; rwyHdg._q[n] = best; }
  }
  // speed along path (m/s) from lightly smoothed lat/lon
  const sLa = gauss(lat, 1.0 / dt), sLo = gauss(lon, 1.0 / dt), spd = new Float64Array(N), vE = new Float64Array(N), vN = new Float64Array(N);
  for (let n = 0; n < N; n++) { const a = Math.max(0, n - 1), b = Math.min(N - 1, n + 1), dtt = (b - a) * dt, cl = Math.cos(sLa[n] * D2R); vN[n] = (sLa[b] - sLa[a]) / dtt * MLAT; vE[n] = (sLo[b] - sLo[a]) / dtt * MLON * cl; spd[n] = Math.hypot(vE[n], vN[n]); }
  if (rwyHdg._q) for (let n = 0; n < N; n++) { const q = rwyHdg._q[n]; if (q && spd[n] > 8) { const w = 0.85 * snapW[n]; lon[n] += (q.qx / (MLON * q.cl) - lon[n]) * w; lat[n] += (q.qy / MLAT - lat[n]) * w; } }
  const sLa2 = gauss(lat, 0.6 / dt), sLo2 = gauss(lon, 0.6 / dt); for (let n = 0; n < N; n++) { lat[n] = sLa2[n]; lon[n] = sLo2[n]; }
  // heading: from the smoothed path; hold when (nearly) stationary; back-fill the start; runway-aligned on a fast ground roll; unwrap; low-pass
  const hdgRaw = new Float64Array(N); let lastH = NaN; const gs2 = gauss(lat, 2.0 / dt), go2 = gauss(lon, 2.0 / dt);
  for (let n = 0; n < N; n++) { const a = Math.max(0, n - 1), b = Math.min(N - 1, n + 1), dtt = (b - a) * dt, cl = Math.cos(gs2[n] * D2R), e = (go2[b] - go2[a]) / dtt * MLON * cl, nn = (gs2[b] - gs2[a]) / dtt * MLAT, v = Math.hypot(e, nn); const thr = gnd[n] ? 2.5 : 5; let hd = v > thr ? Math.atan2(e, nn) / D2R : NaN; if (!isNaN(hd) && gnd[n] && !isNaN(rwyHdg[n]) && v > 6) { let d = ((rwyHdg[n] - hd + 540) % 360) - 180; if (Math.abs(d) > 90) d = ((rwyHdg[n] + 180 - hd + 540) % 360) - 180; hd += d * 0.9 * snapW[n]; } if (!isNaN(hd)) lastH = hd; hdgRaw[n] = isNaN(hd) ? lastH : hd; }
  let firstValid = hdgRaw.findIndex(v => !isNaN(v)); if (firstValid < 0) hdgRaw.fill(0); else for (let n = 0; n < firstValid; n++) hdgRaw[n] = hdgRaw[firstValid];
  for (let n = 1; n < N; n++) { let d = ((hdgRaw[n] - hdgRaw[n - 1] + 540) % 360) - 180; hdgRaw[n] = hdgRaw[n - 1] + d; }
  let hdg = gauss(hdgRaw, 1.5 / dt);
  // rate limit (deg/s): 12 airborne, 25 on the ground
  for (let n = 1; n < N; n++) { const lim = (gnd[n] ? 25 : 12) * dt, d = hdg[n] - hdg[n - 1]; if (Math.abs(d) > lim) hdg[n] = hdg[n - 1] + Math.sign(d) * lim; }
  // vertical speed / path angle
  const vzs = new Float64Array(N), hsm = gauss(h, 2.5 / dt); for (let n = 0; n < N; n++) { const a = Math.max(0, n - 1), b = Math.min(N - 1, n + 1); vzs[n] = (hsm[b] - hsm[a]) / ((b - a) * dt); }
  // pitch
  const pitch = new Float64Array(N); const evT = { lift: ev.lift.map(e => e.t), td: ev.td.map(e => e.t) };
  const aoa = v => clamp(8.5 - v / KT / 22, 1.5, 7);
  for (let n = 0; n < N; n++) { const v = Math.max(spd[n], 25); let p = gnd[n] ? 0 : Math.atan2(vzs[n], v) / D2R + aoa(spd[n]); pitch[n] = clamp(p, -12, 16); }
  for (const tl of evT.lift) { const n0 = Math.round((tl - t0) / dt), R = 4 / dt, tgt = (n) => pitch[clamp(n, 0, N - 1)]; const pl = clamp(Math.max(tgt(n0 + Math.round(1 / dt)), 6), 6, 14); for (let n = Math.max(0, n0 - R); n <= n0; n++) if (gnd[n] && spd[n] > 15) pitch[n] = pl * sstep((n - (n0 - R)) / R); }
  for (const tt of evT.td) { const n0 = Math.round((tt - t0) / dt), Rf = 7 / dt, Rd = 3 / dt; for (let n = Math.max(0, n0 - Rf); n < n0 && n < N; n++) { const w = sstep((n - (n0 - Rf)) / Rf); pitch[n] = pitch[n] * (1 - w) + 4.5 * w; } for (let n = n0; n <= Math.min(N - 1, n0 + Rd); n++) pitch[n] = 4.5 * (1 - sstep((n - n0) / Rd)); }
  const pitchS = gauss(pitch, 0.9 / dt);
  // bank from turn rate
  const bank = new Float64Array(N), hr = new Float64Array(N); for (let n = 0; n < N; n++) { const a = Math.max(0, n - 1), b = Math.min(N - 1, n + 1); hr[n] = (hdg[b] - hdg[a]) / ((b - a) * dt) * D2R; }
  const airFade = new Float64Array(N).fill(1); for (const tl of evT.lift) { const n0 = Math.round((tl - t0) / dt); for (let n = n0; n < N && n < n0 + 4 / dt; n++) airFade[n] = Math.min(airFade[n], sstep((n - n0) / (4 / dt))); } for (const tt of evT.td) { const n0 = Math.round((tt - t0) / dt); for (let n = Math.max(0, n0 - 4 / dt); n < N; n++) airFade[n] = Math.min(airFade[n], 1 - sstep((n - (n0 - 4 / dt)) / (4 / dt))); }
  for (let n = 0; n < N; n++) bank[n] = gnd[n] ? 0 : clamp(Math.atan(spd[n] * hr[n] / G) / D2R, -35, 35) * airFade[n];
  const bankS = gauss(bank, 1.2 / dt);
  // gear: down on the ground; retracts 3-9 s after liftoff, extends from 35-29 s before touchdown
  const gear = new Float64Array(N).fill(1); const tl0 = evT.lift[0], tt1 = evT.td[evT.td.length - 1];
  for (let n = 0; n < N; n++) { const t = tg[n]; let v = 1; if (!gnd[n]) { if (tl0 != null && t >= tl0) v = Math.min(v, 1 - sstep((t - tl0 - 3) / 6)); if (tt1 != null && t <= tt1) { const tu = tt1 - 35; v = Math.max(tl0 != null && t >= tl0 ? v : 1, sstep((t - tu) / 6) * (t >= tu ? 1 : 0)); } if (tl0 == null && tt1 == null) v = 1; } gear[n] = v; if (tl0 != null && tt1 != null && tt1 - tl0 < 60) gear[n] = 1; }
  const stats = { ...st, cleaned: pts.length, hz: +(1 / dt).toFixed(2), samples: N, altAnchor: { dep: offDep, arr: offArr }, estPct: +(100 * est.reduce((a, b) => a + b, 0) / N).toFixed(1), liftoffs: evT.lift.length, touchdowns: evT.td.length, maxGapS: Math.max(...pts.slice(1).map((p, i) => T[i + 1] - T[i])) };
  const pack = { t0, t1, dt, N, lat, lon, h, gnd, est, hdg, pitch: pitchS, bank: bankS, gear, spd, vz: vzs, stats, events: evT };
  pack.at = tt => atTime(pack, tt); return pack;
}
export function atTime(P, tSec) {
  const f = clamp((tSec - P.t0) / P.dt, 0, P.N - 1), i = Math.floor(f), j = Math.min(P.N - 1, i + 1), w = f - i, L = a => a[i] + (a[j] - a[i]) * w;
  return { t: tSec, lat: L(P.lat), lon: L(P.lon), h: L(P.h), hdg: ((L(P.hdg) % 360) + 360) % 360, hdgU: L(P.hdg), pitch: L(P.pitch), bank: L(P.bank), gear: L(P.gear), gnd: !!P.gnd[w < 0.5 ? i : j], est: !!(P.est[i] || P.est[j]), spd: L(P.spd), vz: L(P.vz) };
}
// runway polygon (FAA AIS ring of lon/lat) -> centreline segment
export function runwayAxis(ring) {
  if (!ring || ring.length < 4) return null; const p = ring.slice(0, 4), cl = Math.cos(p[0][1] * D2R), m = ([lo, la]) => [lo * MLON * cl, la * MLAT], P = p.map(m), d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]); const long01 = d(P[0], P[1]) >= d(P[1], P[2]);
  const mid = (a, b) => [(p[a][1] + p[b][1]) / 2, (p[a][0] + p[b][0]) / 2]; const A = long01 ? mid(1, 2) : mid(0, 1), B = long01 ? mid(3, 0) : mid(2, 3), W = long01 ? d(P[1], P[2]) : d(P[0], P[1]), L = long01 ? d(P[0], P[1]) : d(P[1], P[2]);
  return L > 300 && L / W > 5 ? { a: A, b: B, halfW: W / 2, len: L } : null;
}
