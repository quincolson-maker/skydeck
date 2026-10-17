// Flight Planning mode: route builder (ICAO dep/dest/via/alternates, cruise alt + TAS, departure time), 3D route with time scrubber,
// weather at each position/time (MRMS nowcast -> HRRR/GFS forecast, labelled), along-route cross-section, icing/convective/turbulence summary, METAR/TAF.
import { app } from './app.js';
import { store, isMobile, state } from './store.js';
import * as G from './globe.js';
import * as W from './wxdata.js';
import * as X from './wx3d.js';
import { $, $$, esc, clamp, toast, distM, bearing, destPoint, FT, NM, pad } from './util.js';
const Cesium = window.Cesium, C = s => Cesium.Color.fromCssColorString(s);
const DEF = { dep: 'KPAH', dest: 'KHNB', via: '', alts: '', cruise: '8000', tas: 200, depMin: 15 };
const P = { traffic: false, cfg: { ...DEF, ...store.get('plan', {}) }, active: false, built: null, pos: 0, playing: false, speed: 30, follow: false, busy: false, ents: [], pc: null, src: [] };
const zt = ms => { const d = new Date(ms); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`; };
const lt = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fl = ft => ft >= 17950 ? 'FL' + String(Math.round(ft / 100)).padStart(3, '0') : Math.round(ft).toLocaleString() + ' ft';
const parseAlt = s => { s = String(s).trim().toUpperCase().replace(/,/g, ''); const m = s.match(/^FL?\s*(\d{2,3})$/); return m ? +m[1] * 100 : +s || 0; };
const roundDepLocal = ms => { const d = new Date(ms); d.setSeconds(0, 0); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5); return d; };
const toLocalInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const srcLine = (k, ok, msg) => { P.src = P.src.filter(s => s.k !== k); P.src.push({ k, ok, msg }); renderSrc(); };
// ---------- tab UI ----------
function renderTab() {
  const c = P.cfg, d = roundDepLocal(Date.now() + c.depMin * 60e3), L = X.W3.on;
  const chk = (id, label, on) => `<label class="chk"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span>${label}</span></label>`;
  $('#tab-plan').innerHTML = `<div class="plan-note">PLANNING AID — not an official weather briefing. Get a standard briefing (1800wxbrief.com / Leidos) before flight.</div>
  <h3>Route</h3>
  <div class="grid2"><label>DEP<input id="pDep" value="${esc(c.dep)}" autocapitalize="characters" spellcheck="false"></label><label>DEST<input id="pDest" value="${esc(c.dest)}" autocapitalize="characters" spellcheck="false"></label></div>
  <label>VIA <span class="mut">(ICAO or lat,lon · space-separated)</span><input id="pVia" value="${esc(c.via)}" autocapitalize="characters" spellcheck="false" placeholder="optional waypoints"></label>
  <label>ALTERNATES <span class="mut">(ICAO)</span><input id="pAlts" value="${esc(c.alts)}" autocapitalize="characters" spellcheck="false" placeholder="e.g. KSDF KBWG"></label>
  <div class="grid2"><label>CRUISE<input id="pAlt" value="${esc(c.cruise)}" inputmode="text" placeholder="8000 / FL250"></label><label>TAS KT<input id="pTas" type="number" inputmode="numeric" value="${c.tas}" min="60" max="600"></label></div><label>DEPART <span class="mut">(local time)</span><input id="pDepT" type="datetime-local" value="${toLocalInput(d)}"></label>
  <div class="row" style="margin:8px 0"><button class="btn on grow" id="pBuild">Build route + weather</button><button class="btn" id="pEx1" title="Paducah → Huntingburg">KPAH–KHNB</button><button class="btn" id="pEx2" title="Paducah → Denver">KPAH–KDEN</button></div>
  <div id="pMsg" class="st" style="margin-left:0"></div>
  <h3>3D weather layers</h3>
  ${chk('lTraf', 'Show other live traffic (My Planes always shown)', P.traffic)}
  ${chk('lRadar', 'Radar volume + echo tops (MRMS)', L.radar)}${chk('lCloud', 'Cloud layers (model RH + cover)', L.clouds)}${chk('lIce', 'Icing potential (0 to −20 °C, RH ≥ 80 %)', L.icing)}${chk('lFzl', 'Freezing level 0 / −10 / −20 °C surfaces', L.fzl)}
  ${chk('lWind', 'Winds aloft (animated)', L.wind)}<div class="row" id="windRow" style="margin:-2px 0 6px 26px"><span class="mut">Level</span><input id="windAlt" type="range" min="2000" max="38000" step="1000" value="${X.W3.windFt}" class="grow"><output id="windOut">${fl(X.W3.windFt)}</output></div>
  ${chk('lTurb', 'Turbulence potential (model wind shear)', L.turb)}${chk('lHaz', 'AIRMET / SIGMET / G-AIRMET / CWA areas', L.haz)}${chk('lPirep', 'PIREPs (icing + turbulence, last 6 h)', L.pirep)}${chk('lMetar', 'METAR flight categories + ceilings', L.metar)}
  <h3>Along-route cross-section</h3><div id="xsecHome"><canvas id="xsec" height="200"></canvas><canvas id="xcur"></canvas></div><div class="st" id="xsecNote" style="margin-left:0">Build a route to see altitude vs distance: route, freezing levels, icing, clouds and echo tops.</div>
  <h3>Summary</h3><div id="pSum" class="mut" style="font-size:12px">—</div>
  <h3>Airport weather</h3><div id="pAp" class="mut" style="font-size:12px">—</div>
  <h3>Data sources &amp; times</h3><div id="pSrc" class="mono" style="font-size:11px;line-height:1.6"></div>
  <div class="row" style="margin-top:12px"><button class="btn bad" id="pClose">Exit flight planning</button></div>`;
  renderSrc(); drawChart();
}
function renderSrc() { const e = $('#pSrc'); if (!e) return; e.innerHTML = P.src.length ? P.src.map(s => `<div class="${s.ok === false ? 'bad' : s.ok ? 'ok' : ''}">${s.ok === false ? '✗' : s.ok ? '✓' : '…'} ${esc(s.msg)}</div>`).join('') : '<div class="mut">Nothing loaded yet.</div>'; }
const msg = (t, bad) => { const e = $('#pMsg'); if (e) { e.textContent = t; e.classList.toggle('bad', !!bad); } };
function readCfg() { const g = id => $('#' + id)?.value ?? ''; P.cfg = { dep: g('pDep').trim().toUpperCase(), dest: g('pDest').trim().toUpperCase(), via: g('pVia').trim().toUpperCase(), alts: g('pAlts').trim().toUpperCase(), cruise: g('pAlt').trim() || '8000', tas: clamp(+g('pTas') || 200, 60, 600), depMin: P.cfg.depMin }; store.set('plan', P.cfg); const dt = g('pDepT'); P.depT = dt ? new Date(dt).getTime() : Date.now() + 15 * 60e3; return P.cfg; }
// ---------- route geometry + timeline ----------
async function resolvePoints(c) {
  const ll = s => { const m = s.match(/^(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)$/); return m ? [+m[1], +m[2]] : null; };
  const viaRaw = c.via.replace(/([A-Z]),\s*/g, '$1 ').replace(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/g, '$1_$2').split(/\s+/).filter(Boolean).map(s => s.replace('_', ',')), names = [c.dep, ...viaRaw, c.dest], alts = c.alts.split(/[\s,;]+/).filter(Boolean);
  const icao = s => /^[A-Z]{3,4}$/.test(s) ? (s.length === 3 ? 'K' + s : s) : null, ids = [...new Set([...names.map(icao), ...alts.map(icao)].filter(Boolean))];
  const st = ids.length ? await W.loadStations(ids) : new Map(), pts = [];
  for (const n of names) { const l = ll(n); if (l) { pts.push({ id: n, lat: l[0], lon: l[1], elev: 0, wp: true }); continue; } const k = icao(n), s = k && st.get(k); if (!s) throw new Error(`Unknown identifier "${n}" (use 4-letter ICAO, e.g. KPAH, or lat,lon)`); pts.push({ id: k, name: s.name, lat: s.lat, lon: s.lon, elev: s.elev }); }
  const altPts = alts.map(a => { const s = st.get(icao(a)); return s ? { id: s.id, name: s.name, lat: s.lat, lon: s.lon, elev: s.elev } : null; }).filter(Boolean);
  return { pts, altPts, ids };
}
function geometry(pts, tas, cruiseFt) {
  const legs = []; let tot = 0; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], d = distM(a.lat, a.lon, b.lat, b.lon); legs.push({ a, b, d, brg: bearing(a.lat, a.lon, b.lat, b.lon), d0: tot }); tot += d; }
  const totNm = tot / NM, N = clamp(Math.ceil(totNm / 1.5), 60, 420), dep = pts[0].elev || 0, arr = pts[pts.length - 1].elev || 0, roc = cruiseFt > 20000 ? 1800 : 1500, ktClimb = tas * 0.75;
  let alt = cruiseFt, climbNm = (alt - dep) / roc * ktClimb / 60, descNm = Math.max(0, (alt - arr) / 318); if (climbNm + descNm > totNm * 0.98) { const f = totNm * 0.98 / (climbNm + descNm); alt = Math.max(dep, arr) + (alt - Math.max(dep, arr)) * f; climbNm *= f; descNm *= f; }
  const S = []; for (let i = 0; i <= N; i++) { const dm = tot * i / N; let L = legs.find(l => dm <= l.d0 + l.d + 1) || legs[legs.length - 1]; const p = (([la, lo]) => ({ lat: la, lon: lo }))(destPoint(L.a.lat, L.a.lon, L.brg, Math.min(L.d, dm - L.d0))), dn = dm / NM, hd = i < N ? bearing(p.lat, p.lon, ...destPoint(L.a.lat, L.a.lon, L.brg, Math.min(L.d, dm - L.d0 + 2000))) : L.brg; S.push({ i, dm, lat: p.lat, lon: p.lon, alt: climbNm > 0 ? Math.min(alt, dep + dn * (alt - dep) / climbNm, arr + (totNm - dn) * (alt - arr) / Math.max(0.1, descNm), alt) : alt, hdg: hd }); }
  return { S, legs, totNm, tocNm: climbNm, todNm: totNm - descNm, alt };
}
function timeline(g, tas, t0, model) {   // gs with winds aloft from HRRR/GFS when available
  const S = g.S; let t = t0; for (let i = 0; i < S.length; i++) {
    const s = S[i]; s.t = t; const phase = s.alt < g.alt - 200 ? (s.dm / NM < g.tocNm + 1 ? 0.8 : 0.9) : 1; let gs = tas * phase;
    if (model) { const col = model.column(s.lat, s.lon, t), w = W.atAlt(col, s.alt); if (w && !w.above) { const h = s.hdg * Math.PI / 180, par = w.u * Math.sin(h) + w.v * Math.cos(h), cr = -w.u * Math.cos(h) + w.v * Math.sin(h); gs = Math.sqrt(Math.max(100, gs * gs - cr * cr)) + par; s.wu = w.u; s.wv = w.v; } }
    s.gs = Math.max(50, gs); if (i < S.length - 1) t += (S[i + 1].dm - s.dm) / (s.gs * 0.514444) * 1000;
  }
  return { t0, t1: S[S.length - 1].t };
}
const bboxOf = (S, extra = []) => { const all = [...S, ...extra]; let w = 180, e = -180, s = 90, n = -90; for (const p of all) { w = Math.min(w, p.lon); e = Math.max(e, p.lon); s = Math.min(s, p.lat); n = Math.max(n, p.lat); } const mx = Math.max(0.55, (e - w) * 0.12), my = Math.max(0.45, (n - s) * 0.12); return { w: +(w - mx).toFixed(2), e: +(e + mx).toFixed(2), s: +(s - my).toFixed(2), n: +(n + my).toFixed(2) }; };
// ---------- analysis ----------
function nearRadar(R, lat, lon, t, rNm) { let best = null; const dl = rNm / 60, dn = dl / Math.cos(lat * Math.PI / 180); for (const [a, b] of [[0, 0], [dl, 0], [-dl, 0], [0, dn], [0, -dn], [dl * .7, dn * .7], [-dl * .7, dn * .7], [dl * .7, -dn * .7], [-dl * .7, -dn * .7]]) { const s = R.sample(lat + a, lon + b, t); if (s && s.dbz != null && (!best || s.dbz > best.dbz)) best = s; } return best; }
function analyse(B) {
  const { S, g, model, radar, haz, pireps } = B, N = S.length, nCol = Math.min(110, N), cols = [], sum = { ice: { min: 0, mod: 0, high: 0, total: 0, maxScore: 0, segs: [] }, conv: { thru: 0, near: [], worst: null }, turb: { maxShear: 0, at: null }, belowFz: 0, abvFz: 0, fz: [], hazHit: new Map(), pirep: [], modelEnd: false };
  let iceOpen = null;
  for (let i = 0; i < N; i++) {
    const s = S[i], dt = i < N - 1 ? (S[i + 1].t - s.t) / 60000 : 0, col = model ? model.column(s.lat, s.lon, s.t) : null; s.col = col; if (!col) continue; if (col.tOut === 'after') sum.modelEnd = true;
    const w = W.atAlt(col, s.alt); if (w && !w.above) { const sc = W.icingScore(w.T, w.rh); s.T = w.T; s.rh = w.rh; s.ice = sc; sum.ice.total += dt; if (sc >= 0.2) { sum.ice.min += dt; if (sc >= 0.45) sum.ice.mod += dt; if (sc >= 0.7) sum.ice.high += dt; sum.ice.maxScore = Math.max(sum.ice.maxScore, sc); if (!iceOpen) iceOpen = { d0: s.dm / NM, t0: s.t, max: sc }; iceOpen.max = Math.max(iceOpen.max, sc); iceOpen.d1 = s.dm / NM; iceOpen.t1 = S[Math.min(N - 1, i + 1)].t; } else if (iceOpen) { sum.ice.segs.push(iceOpen); iceOpen = null; } if (w.T < 0) sum.abvFz += dt; else sum.belowFz += dt; }
    const sh = W.shearKt1k(col, s.alt); s.sh = sh; if (sh > sum.turb.maxShear) sum.turb = { maxShear: sh, at: s };
    if (col.fzl != null) sum.fz.push(col.fzl / FT);
    // radar (obs / nowcast) or model-derived reflectivity
    let rd = radar ? radar.at(s.t) : null, rs = null; if (rd) { rs = nearRadar(radar, s.lat, s.lon, s.t, 10); if (rs) rs.kind = rd.kind; } else { const mp = W.modelPrecip(col); if (mp) rs = { kind: 'model', dbz: mp.dbz, topFt: mp.topFt }; }
    s.rad = rs; if (rs && rs.dbz >= 30) { const top = rs.topFt || 12000; if (top >= s.alt - 1000) { sum.conv.thru += dt; if (!sum.conv.worst || rs.dbz > sum.conv.worst.dbz) sum.conv.worst = { ...rs, t: s.t, d: s.dm / NM, alt: s.alt }; } else if (!sum.conv.worst || rs.dbz > sum.conv.worst.dbz) sum.conv.below = { ...rs, t: s.t, d: s.dm / NM }; }
    for (const h of haz) { if (!X.hazardActive(h, s.t) || s.alt < (h.lo === 'FZL' ? (col.fzl != null ? col.fzl / FT : 0) : h.lo) - 500 || s.alt > h.hi + 500) continue; if (pip(s.lon, s.lat, h.co)) { const k = `${h.kind} ${h.hazard}`; const e = sum.hazHit.get(k) || { n: 0, t0: s.t, t1: s.t, h }; e.n++; e.t1 = s.t; sum.hazHit.set(k, e); } }
  }
  if (iceOpen) sum.ice.segs.push(iceOpen);
  for (let k = 0; k < nCol; k++) { const i = Math.round(k * (N - 1) / (nCol - 1)), s = S[i]; cols.push({ i, d: s.dm / NM, t: s.t, col: s.col, rad: s.rad, lat: s.lat, lon: s.lon }); }
  for (const p of pireps) { let best = 1e9, bi = -1; for (let i = 0; i < N; i += 2) { const d = distM(p.lat, p.lon, S[i].lat, S[i].lon) / NM; if (d < best) { best = d; bi = i; } } if (best <= 30) sum.pirep.push({ ...p, nm: best, d: S[bi].dm / NM }); }
  // cells near the track (within 20 nm) tall enough to matter
  if (radar) for (let i = 0; i < N; i += 3) { const s = S[i], rs = nearRadar(radar, s.lat, s.lon, s.t, 20); if (rs && rs.dbz >= 40 && (rs.topFt || 0) > s.alt - 3000 && (!sum.conv.near.length || i - sum.conv.near[sum.conv.near.length - 1].i > 12)) sum.conv.near.push({ i, ...rs, t: s.t, d: s.dm / NM }); }
  return { cols, sum, N };
}
function pip(x, y, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
// ---------- build pipeline ----------
async function build() {
  if (P.busy) return; P.busy = true; const btn = $('#pBuild'); if (btn) btn.disabled = true; P.src = []; renderSrc(); stopPlay(); clearRoute(); X.clearAll(); msg('Resolving airports…');
  try {
    const c = readCfg(), cruise = parseAlt(c.cruise); if (cruise < 500 || cruise > 60000) throw new Error('Cruise altitude must be between 500 ft and FL600');
    const { pts, altPts, ids } = await resolvePoints(c); if (pts.length < 2) throw new Error('Need a departure and a destination'); srcLine('apts', true, `Airports: ${[...pts, ...altPts].map(p => p.id).join(' → ')} (aviationweather.gov station info)`);
    let g = geometry(pts, c.tas, cruise), est = timeline(g, c.tas, P.depT, null), bb = bboxOf(g.S, altPts);
    if (bb.e - bb.w > 38 || bb.n - bb.s > 38) throw new Error('Route spans more than ~38° — too large for the weather grid. Try a shorter route.');
    const mobile = isMobile(); msg('Loading radar, model, METAR, PIREPs and hazard areas…');
    const hours = clamp(Math.ceil((est.t1 - Math.floor(P.depT / 36e5) * 36e5) / 36e5) + 2, 3, 30), now = Date.now(), t0 = Math.floor(Math.min(P.depT, now) / 36e5) * 36e5;
    srcLine('radar', null, 'MRMS radar composite + echo tops: loading…'); srcLine('model', null, 'HRRR model columns: loading…');
    const inMrms = bb.w > -130 && bb.e < -60 && bb.s > 20 && bb.n < 55;
    const [rad, mod, hz, pir, met] = await Promise.allSettled([inMrms ? W.loadRadar(bb, mobile) : Promise.reject(new Error('route is outside the MRMS radar domain (CONUS + border areas)')), W.loadModel(bb, t0, Math.max(hours, Math.ceil((est.t1 - t0) / 36e5) + 2), mobile), W.loadHazards(bb), W.loadPireps(bb), W.loadMetars(bb)]);
    const radar = rad.status === 'fulfilled' ? rad.value : null, model = mod.status === 'fulfilled' ? mod.value : null;
    if (radar) { const mk = radar.motionKt; srcLine('radar', true, `Radar: NOAA MRMS composite reflectivity ~1 km, observed ${zt(radar.t)} (${Math.round((now - radar.t) / 60000)} min old)${radar.et ? ' · echo tops 18 dBZ' : ''}${radar.et50 ? ' + 50 dBZ' : ''} · ${mk ? `nowcast to +2 h by motion ${Math.round(mk.kt)} kt from ${Math.round(mk.from)}°` : 'no trackable motion → no nowcast; later times use model precipitation'}`); } else srcLine('radar', false, 'Radar unavailable: ' + (rad.reason?.message || 'unknown') + ' — radar layer shows no data');
    if (model) srcLine('model', true, `Model: ${model.label} · ${model.nx}×${model.ny} grid, ${model.levels.length} pressure levels (1000–200 hPa), hourly ${zt(model.times[0])}–${zt(model.times[model.times.length - 1])} · fetched ${zt(model.fetched)}`); else srcLine('model', false, 'Model data unavailable: ' + (mod.reason?.message || 'unknown') + (mod.reason?.detail ? ' (' + mod.reason.detail + ')' : '') + ' — clouds / icing / freezing level / winds not shown');
    const hzR = hz.status === 'fulfilled' ? hz.value : { items: [], status: {} }; if (hz.status !== 'fulfilled') srcLine('haz', false, 'AIRMET/SIGMET/CWA unavailable: ' + hz.reason?.message); else for (const [k, v] of Object.entries(hzR.status)) srcLine('haz' + k, v.ok, v.ok ? `${k}: ${v.n} area(s) near route (aviationweather.gov)` : `${k} unavailable: ${v.msg}`);
    const pirs = pir.status === 'fulfilled' ? pir.value : []; srcLine('pirep', pir.status === 'fulfilled' ? true : false, pir.status === 'fulfilled' ? `PIREPs: ${pirs.length} icing/turbulence report(s) in the last 6 h (aviationweather.gov)` : 'PIREPs unavailable: ' + pir.reason?.message);
    let mets = met.status === 'fulfilled' ? met.value : []; srcLine('metar', met.status === 'fulfilled', met.status === 'fulfilled' ? `METAR: ${mets.length} stations in area (aviationweather.gov)` : 'METAR unavailable: ' + met.reason?.message);
    if (!model && !radar) throw new Error('Neither radar nor model data could be loaded — try again in a minute.');
    // second pass with winds aloft
    const tl = timeline(g, c.tas, P.depT, model); const B = { cfg: c, pts, altPts, g, S: g.S, tl, bb, model, radar, haz: hzR.items, pireps: pirs, metars: mets, cruise: g.alt, mobile };
    B.an = analyse(B); P.built = B; P.pos = 0;
    // 3D
    X.setArea(bb, mobile); X.setData({ radar, model, haz: hzR.items, pireps: pirs, metars: mets.filter(m => nearTrack(m, g.S) <= 45 || [...pts, ...altPts].some(p => p.id === m.id)) }); applyLayerState(); X.setTime(P.depT, true);
    draw3D(); drawChart(); renderSummary(); showBar(); seek(0); flyToRoute(); msg(`Route ${Math.round(g.totNm)} nm · ${fmtDur(tl.t1 - tl.t0)} · ${zt(tl.t0)} → ${zt(tl.t1)}`);
    airportWx(B).catch(e => { $('#pAp').textContent = 'Airport weather unavailable: ' + e.message; });
  } catch (e) { msg(e.message, true); toast('Flight plan: ' + e.message, 'warn', 6000); }
  P.busy = false; if (btn) btn.disabled = false;
}
const nearTrack = (m, S) => { let b = 1e9; for (let i = 0; i < S.length; i += 3) { const d = distM(m.lat, m.lon, S[i].lat, S[i].lon) / NM; if (d < b) b = d; } return b; };
const fmtDur = ms => { const m = Math.round(ms / 60000); return Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm'; };
function applyLayerState() { for (const k of Object.keys(X.W3.on)) X.setLayer(k, X.W3.on[k]); }
// ---------- summary + airports ----------
function renderSummary() {
  const B = P.built, e = $('#pSum'); if (!B || !e) return; const { sum } = B.an, { g, tl } = B, ic = sum.ice, m = v => Math.round(v);
  const li = [];
  li.push(`<div><b>${m(g.totNm)} nm</b> · ${fmtDur(tl.t1 - tl.t0)} · cruise <b>${fl(g.alt)}</b> · ${zt(tl.t0)} → ${zt(tl.t1)} (${lt(tl.t0)} → ${lt(tl.t1)} local)</div>`);
  if (B.model) {
    const fz = sum.fz.length ? [Math.min(...sum.fz), Math.max(...sum.fz)] : null;
    li.push(`<div class="sumh">ICING <span class="${ic.min > 0 ? 'warn' : 'ok'}">${ic.min > 0 ? 'POTENTIAL' : 'NONE INDICATED'}</span></div><div>Model icing potential (T 0…−20 °C with RH ≥ 80 %) along route: <b>${m(ic.min)} min</b> of ${m(ic.total)} min${ic.min ? ` — moderate+ ${m(ic.mod)} min, high ${m(ic.high)} min` : ''}. ${ic.segs.length ? 'Segments: ' + ic.segs.slice(0, 4).map(s => `${m(s.d0)}–${m(s.d1)} nm (${zt(s.t0)}, ${W.iceLabel(s.max)})`).join('; ') : ''}</div>`);
    li.push(`<div>Freezing level along route: ${fz ? `<b>${m(fz[0]).toLocaleString()}–${m(fz[1]).toLocaleString()} ft</b> MSL` : 'not indicated'}${B.cruise > (fz?.[0] ?? 1e9) ? ` · route is above the freezing level for ${m(sum.abvFz)} min` : fz ? ' · route stays below the freezing level' : ''}. Potential is derived from forecast temperature + humidity, not an icing forecast product.</div>`);
  } else li.push('<div class="mut">Icing/cloud/freezing-level analysis unavailable (model data failed).</div>');
  const cv = sum.conv; li.push(`<div class="sumh">CONVECTION / PRECIPITATION</div>`);
  if (B.radar || B.model) li.push(cv.worst ? `<div>Route passes through ≥ 30 dBZ echoes at altitude for ~${m(cv.thru)} min. Strongest: <b>${m(cv.worst.dbz)} dBZ</b>${cv.worst.topFt ? ', top ' + fl(cv.worst.topFt) : ''} at ${m(cv.worst.d)} nm (${zt(cv.worst.t)}, ${cv.worst.kind === 'obs' ? 'observed' : cv.worst.kind === 'nowcast' ? 'radar nowcast +' + Math.round((cv.worst.t - B.radar.t) / 60000) + ' min' : 'model-derived'}).</div>` : `<div>No ≥ 30 dBZ echo on the route at altitude${cv.below ? ` (${m(cv.below.dbz)} dBZ echoes pass beneath, tops ${fl(cv.below.topFt || 0)})` : ''}.</div>`);
  if (cv.near.length) li.push(`<div>Strong cells (≥ 40 dBZ) within 20 nm: ${cv.near.slice(0, 4).map(n => `${m(n.dbz)} dBZ${n.topFt ? ' top ' + fl(n.topFt) : ''} @ ${m(n.d)} nm / ${zt(n.t)}`).join('; ')}</div>`);
  li.push(`<div class="sumh">TURBULENCE / HAZARDS</div><div>Peak model wind shear along route: <b>${sum.turb.maxShear.toFixed(1)} kt/1000 ft</b>${sum.turb.at ? ` at ${m(sum.turb.at.dm / NM)} nm` : ''} (CAT proxy; &gt; ~8 suggests moderate chop possible).</div>`);
  const hh = [...sum.hazHit.entries()]; li.push(`<div>${hh.length ? 'Route intersects: ' + hh.map(([k, v]) => `<b>${esc(k)}</b> (${zt(v.t0)}–${zt(v.t1)})`).join(', ') : 'No AIRMET/SIGMET/G-AIRMET/CWA area intersects the route at altitude and time.'}</div>`);
  li.push(`<div>PIREPs within 30 nm of track: ${sum.pirep.length ? sum.pirep.slice(0, 5).map(p => `${p.ice ? 'ICE ' + p.ice : 'TURB ' + p.tb} ${fl(p.alt || 0)} (${p.nm.toFixed(0)} nm off, ${Math.round((Date.now() - p.t) / 60000)} min ago)`).join('; ') : 'none reported'}.</div>`);
  if (sum.modelEnd) li.push('<div class="warn">Part of the flight is later than the loaded model hours; the last model hour is used.</div>');
  e.innerHTML = li.join('');
}
async function airportWx(B) {
  const ids = [...new Set([...B.pts.filter(p => !p.wp).map(p => p.id), ...B.altPts.map(p => p.id)])], [mm, tt] = await Promise.allSettled([W.loadMetarIds(ids), W.loadTafs(ids)]), M = mm.status === 'fulfilled' ? mm.value : new Map(), T = tt.status === 'fulfilled' ? tt.value : new Map(), out = [];
  const role = id => id === B.pts[0].id ? 'DEP' : id === B.pts[B.pts.length - 1].id ? 'DEST' : B.altPts.some(a => a.id === id) ? 'ALTN' : 'VIA', eta = id => id === B.pts[0].id ? B.tl.t0 : B.tl.t1;
  for (const id of ids) {
    const m = M.get(id), t = T.get(id), cat = m?.fltCat || '', cc = { VFR: '#22c55e', MVFR: '#3b82f6', IFR: '#ef4444', LIFR: '#d946ef' }[cat] || '#9ca3af'; let tf = '';
    if (t) { const e = eta(id) / 1000, f = (t.fcsts || []).filter(x => x.timeFrom <= e && e < x.timeTo).slice(-2); tf = f.length ? `<div class="mut">TAF at ${zt(eta(id))}: ${f.map(x => `${x.fcstChange || 'BASE'} ${x.wdir ?? '—'}°/${x.wspd ?? '—'}kt${x.wgst ? 'G' + x.wgst : ''} vis ${x.visib ?? '—'} ${(x.clouds || []).map(c => c.cover + (c.base ?? '')).join(' ')}${x.wxString ? ' ' + x.wxString : ''}`).join(' → ')}</div>` : `<div class="mut">TAF has no period covering ${zt(eta(id))}</div>`; }
    let chk = ''; if (id === B.pts[0].id && m && B.model) { const c = B.model.column(m.lat, m.lon, Date.now()), tm = c.lev[0]?.T; if (tm != null && m.temp != null) chk = `<div class="mut">Model check: HRRR/GFS 2 m T ${tm.toFixed(1)} °C vs METAR ${m.temp} °C (Δ ${(tm - m.temp).toFixed(1)}) · model freezing level ${c.fzl != null ? Math.round(c.fzl / FT).toLocaleString() + ' ft' : '—'}</div>`; }
    out.push(`<div class="card"><div class="row sp"><b>${role(id)} ${id}</b><span style="color:${cc}">● ${cat || 'NO METAR'}</span></div>${m ? `<div class="mono" style="font-size:11px;word-break:break-word">${esc(m.rawOb)}</div><div class="mut">observed ${zt(m.obsTime * 1000)} (${Math.round((Date.now() - m.obsTime * 1000) / 60000)} min ago)</div>` : '<div class="mut">No METAR in the last 3 h.</div>'}${t ? `<div class="mono" style="font-size:11px;word-break:break-word;margin-top:4px">${esc(t.rawTAF)}</div>${tf}` : '<div class="mut">No TAF.</div>'}${chk}</div>`);
  }
  $('#pAp').innerHTML = out.join('') || 'No airports.';
  srcLine('mt', true, `Airport METAR/TAF: ${M.size} METAR, ${T.size} TAF (aviationweather.gov)`);
}
// ---------- 3D route graphics ----------
function clearRoute() { for (const e of P.ents) G.viewer.entities.remove(e); P.ents = []; if (P.pc) { G.scene.primitives.remove(P.pc); P.pc = null; } P.marker = null; }
function draw3D() {
  clearRoute(); const B = P.built; if (!B) return; const k = G.exag(), { S } = B, V = G.viewer, pc = G.scene.primitives.add(new Cesium.PolylineCollection()); P.pc = pc;
  for (let i = 0; i < S.length - 1; i++) { const a = S[i], b = S[i + 1], sc = Math.max(a.ice || 0, b.ice || 0), cv = (a.rad && a.rad.dbz >= 40 && (a.rad.topFt || 12000) > a.alt - 1000), col = cv ? '#ff5a4f' : sc >= 0.45 ? '#3b82f6' : sc >= 0.2 ? '#7fe9ff' : '#ffffff'; pc.add({ positions: [Cesium.Cartesian3.fromDegrees(a.lon, a.lat, a.alt * FT * k), Cesium.Cartesian3.fromDegrees(b.lon, b.lat, b.alt * FT * k)], width: 3, material: Cesium.Material.fromType('Color', { color: C(col) }) }); }
  P.ents.push(V.entities.add({ wall: { positions: Cesium.Cartesian3.fromDegreesArray(S.filter((_, i) => i % 3 === 0 || i === S.length - 1).flatMap(s => [s.lon, s.lat])), maximumHeights: S.filter((_, i) => i % 3 === 0 || i === S.length - 1).map(s => s.alt * FT * k), minimumHeights: S.filter((_, i) => i % 3 === 0 || i === S.length - 1).map(() => 0), material: C('#ffffff').withAlpha(0.06), outline: false } }));
  for (const p of [...B.pts, ...B.altPts]) { const alt = B.pts.includes(p); P.ents.push(V.entities.add({ position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, (p.elev || 0) * FT * k + 30), point: { pixelSize: 8, color: alt ? C('#ffffff') : C('#9ca3af'), outlineColor: C('#000'), outlineWidth: 2, disableDepthTestDistance: 1e7 }, label: { text: (p.wp ? 'WPT ' : '') + p.id, font: '12px Barlow, sans-serif', fillColor: C('#fff'), outlineColor: C('#000'), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(10, -10), horizontalOrigin: Cesium.HorizontalOrigin.LEFT, disableDepthTestDistance: 1e7, scale: 0.9 } })); }
  P.marker = V.entities.add({ position: Cesium.Cartesian3.fromDegrees(S[0].lon, S[0].lat, S[0].alt * FT * k), point: { pixelSize: 13, color: C('#7fd6ff'), outlineColor: C('#000'), outlineWidth: 2, disableDepthTestDistance: 1e7 }, polyline: { positions: new Cesium.CallbackProperty(() => P.dropPos || [], false), width: 1, material: C('#7fd6ff').withAlpha(0.7) } }); P.ents.push(P.marker);
  const top = S.map(s => Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 0)); void top;
}
function flyToRoute() { const B = P.built; if (!B) return; const { bb } = B, lat = (bb.n + bb.s) / 2, lon = (bb.e + bb.w) / 2, span = Math.max((bb.e - bb.w) * 111 * Math.cos(lat * Math.PI / 180), (bb.n - bb.s) * 111) * 1000; G.flyTo(lat - (bb.n - bb.s) * 0.35, lon, clamp(span * (isMobile() ? 1.9 : 1.5), 60000, 9e6), { heading: B.S[0] && B.S[B.S.length - 1] ? 0 : 0, pitch: -48, duration: 2.2 }); }
// ---------- playback / scrubber ----------
function posAt(f) { const B = P.built, S = B.S, x = clamp(f, 0, 1) * (S.length - 1), i = Math.min(S.length - 2, Math.floor(x)), a = x - i, p = S[i], q = S[i + 1]; return { lat: p.lat + (q.lat - p.lat) * a, lon: p.lon + (q.lon - p.lon) * a, alt: p.alt + (q.alt - p.alt) * a, t: p.t + (q.t - p.t) * a, hdg: p.hdg, gs: p.gs, i, d: (p.dm + (q.dm - p.dm) * a) / NM }; }
function fracAtTime(t) { const S = P.built.S; let lo = 0, hi = S.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].t <= t) lo = m; else hi = m; } return (lo + clamp((t - S[lo].t) / Math.max(1, S[hi].t - S[lo].t), 0, 1)) / (S.length - 1); }
function seek(f, fromUser) {
  const B = P.built; if (!B) return; P.pos = clamp(f, 0, 1); const p = posAt(P.pos), k = G.exag(); P.cur = p;
  P.marker.position = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt * FT * k); P.dropPos = [Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt * FT * k), Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)];
  X.setTime(p.t); const sc = $('#pScrub'); if (sc && document.activeElement !== sc) sc.value = Math.round(P.pos * 1000);
  $('#pTime') && ($('#pTime').innerHTML = `<b>${zt(p.t)}</b> <span class="mut">${lt(p.t)} local · +${fmtDur(p.t - B.tl.t0)}</span>`);
  const pr = X.getPrecip(), badge = !pr ? '—' : pr.kind === 'obs' ? 'RADAR OBS ' + zt(B.radar.t) : pr.kind === 'nowcast' ? `RADAR NOWCAST +${Math.round((p.t - B.radar.t) / 60000)}m` : pr.kind === 'model' ? 'PRECIP: MODEL-DERIVED' : 'NO RADAR'; const mt = B.model ? B.model.tIdx(p.t) : null;
  $('#pBadge') && ($('#pBadge').textContent = `${badge}${B.model ? ' · ' + (B.model.model === 'gfs_hrrr' ? 'HRRR' : 'GFS') + ' +' + Math.max(0, Math.round((p.t - Date.now()) / 36e5)) + 'h' + (mt?.out ? ' (clamped)' : '') : ''}`);
  readout(p); drawCursor();
  if (P.follow) chase(p);
  if (fromUser && G.scene.requestRenderMode) G.scene.requestRender();
}
function readout(p) {
  const B = P.built, e = $('#pRead'); if (!e) return; const col = B.model ? B.model.column(p.lat, p.lon, p.t) : null, w = col ? W.atAlt(col, p.alt) : null, rs = B.radar ? B.radar.sample(p.lat, p.lon, p.t) : null; const bits = [`${fl(p.alt)} · GS ${Math.round(p.gs)} kt · ${p.d.toFixed(0)} / ${Math.round(B.g.totNm)} nm`];
  if (w && !w.above) { const sc = W.icingScore(w.T, w.rh); bits.push(`T ${w.T.toFixed(0)}°C · RH ${Math.round(w.rh)}% · wind ${String(Math.round((Math.atan2(-w.u, -w.v) * 180 / Math.PI + 360) % 360)).padStart(3, '0')}/${Math.round(Math.hypot(w.u, w.v))} kt`); bits.push(sc >= 0.2 ? `<span class="warn">ICING ${W.iceLabel(sc)} potential</span>` : 'no icing indicated'); } else if (w?.above) bits.push('above model top (FL390)'); else if (!B.model) bits.push('model unavailable');
  if (col?.fzl != null) bits.push(`FZL ${Math.round(col.fzl / FT).toLocaleString()} ft`); bits.push(rs && rs.dbz != null ? `<span class="${rs.dbz >= 40 ? 'bad' : rs.dbz >= 30 ? 'warn' : ''}">${Math.round(rs.dbz)} dBZ${rs.topFt ? ' top ' + fl(rs.topFt) : ''}</span>` : 'no echo'); e.innerHTML = bits.join(' · ');
}
let rafT = 0; function tick(now) { if (!P.playing) return; const dt = (now - rafT) / 1000; rafT = now; const B = P.built; if (!B) return stopPlay(); const t = (P.cur?.t ?? B.tl.t0) + dt * 1000 * P.speed; if (t >= B.tl.t1) { seek(1); stopPlay(); return; } seek(fracAtTime(t)); requestAnimationFrame(tick); }
function startPlay() { if (!P.built) return; if (P.pos >= 0.999) seek(0); P.playing = true; rafT = performance.now(); G.scene.requestRenderMode = false; $('#pPlay') && ($('#pPlay').textContent = '⏸'); requestAnimationFrame(tick); }
function stopPlay() { P.playing = false; $('#pPlay') && ($('#pPlay').textContent = '▶'); if (P.active && !(X.W3.on.wind && X.getVolume())) G.scene.requestRenderMode = !!app.isMobile && !app.replay?.active; }
function chase(p) { const h = (p.hdg || 0) * Math.PI / 180; G.camera.lookAt(Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt * FT * G.exag()), new Cesium.HeadingPitchRange(h, -0.32, 22000)); }
function setFollow(v) { P.follow = v; $('#pFollow')?.classList.toggle('on', v); if (!v) G.camera.lookAtTransform(Cesium.Matrix4.IDENTITY); else if (P.cur) chase(P.cur); }
let ro = null;
function showBar() { const b = $('#planbar'); b.hidden = false; document.body.classList.add('planning'); if (!ro && window.ResizeObserver) { ro = new ResizeObserver(() => document.documentElement.style.setProperty('--pbH', b.offsetHeight + 'px')); ro.observe(b); } }
// ---------- cross-section chart ----------
function drawChart() {
  const cv = $('#xsec'); if (!cv) return; const B = P.built, wrap = cv.parentElement, cssW = Math.max(240, wrap.clientWidth || 600), cssH = isMobile() ? 210 : 190, dpr = Math.min(2, devicePixelRatio || 1);
  cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px'; cv.width = cssW * dpr; cv.height = cssH * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cssW, cssH);
  if (!B) { g.fillStyle = '#6b7280'; g.font = '11px Barlow, sans-serif'; g.fillText('NO ROUTE', 12, 22); return; }
  const { cols, sum } = B.an, tot = B.g.totNm, L = 44, R = 8, T = 8, Bm = 26, pw = cssW - L - R, ph = cssH - T - Bm, fzMax = sum.fz.length ? Math.max(...sum.fz) : 0, yMax = clamp(Math.ceil((Math.max(B.cruise, Math.min(fzMax, 30000)) + 3000) / 5000) * 5000, 10000, 45000), xOf = d => L + d / tot * pw, yOf = ft => T + ph * (1 - ft / yMax);
  g.fillStyle = 'rgba(8,10,14,.9)'; g.fillRect(L, T, pw, ph);
  const rows = Math.round(yMax / 500), off = document.createElement('canvas'); off.width = cols.length; off.height = rows; const oc = off.getContext('2d'), img = oc.createImageData(cols.length, rows);
  if (B.model) cols.forEach((c, x) => { if (!c.col) return; for (let r = 0; r < rows; r++) { const alt = (rows - r - .5) * 500, s = W.atAlt(c.col, alt); if (!s || s.above || s.ground) continue; const cf = W.cloudFrac(s.rh, s.T, c.col.cc, alt), ic = W.icingScore(s.T, s.rh), o = (r * cols.length + x) * 4; let R_ = 0, G_ = 0, B_ = 0, A_ = 0; if (cf > 0.1) { R_ = 215; G_ = 220; B_ = 230; A_ = cf * 0.75; } if (ic > 0.15) { const t = clamp((ic - 0.15) / 0.7, 0, 1), a = 0.35 + 0.45 * t, cr = 110 + 90 * t, cg = 230 - 150 * t, cb = 255; R_ = (R_ * A_ * (1 - a) + cr * a) / Math.max(0.01, A_ * (1 - a) + a); G_ = (G_ * A_ * (1 - a) + cg * a) / Math.max(0.01, A_ * (1 - a) + a); B_ = (B_ * A_ * (1 - a) + cb * a) / Math.max(0.01, A_ * (1 - a) + a); A_ = A_ + a - A_ * a; } img.data[o] = R_; img.data[o + 1] = G_; img.data[o + 2] = B_; img.data[o + 3] = A_ * 255; } });
  oc.putImageData(img, 0, 0); g.imageSmoothingEnabled = true; g.save(); g.beginPath(); g.rect(L, T, pw, ph); g.clip(); g.drawImage(off, L, T, pw, ph);
  // radar echoes (obs/nowcast solid, model-derived hatched/dim)
  const cw = pw / (cols.length - 1); cols.forEach((c, x) => { const r = c.rad; if (!r || r.dbz == null || r.dbz < 12) return; const top = r.topFt || 12000, y0 = yOf(c.col ? c.col.elev / FT : 0), y1 = yOf(Math.min(top, yMax)); g.fillStyle = dbzC(r.dbz); g.globalAlpha = r.kind === 'model' ? 0.3 : 0.62; g.fillRect(xOf(c.d) - cw / 2, y1, cw + 0.5, y0 - y1); });
  g.globalAlpha = 1;
  // hazards
  const HC = { TURB: '#fb923c', 'TURB-HI': '#fb923c', 'TURB-LO': '#fb923c', ICE: '#22d3ee', CONVECTIVE: '#f43f5e', IFR: '#94a3b8', MT_OBSC: '#a8a29e', LLWS: '#facc15', SFC_WND: '#facc15', M_FZLVL: '#60a5fa' };
  for (const [k, v] of sum.hazHit) { const h = v.h, lo = X.hazardLo(h, 0, 0) || 0, x0 = xOf(B.S.find(s => s.t >= v.t0)?.dm / NM || 0), x1 = xOf(B.S.slice().reverse().find(s => s.t <= v.t1)?.dm / NM || tot); g.strokeStyle = HC[h.hazard] || '#f59e0b'; g.setLineDash([4, 3]); g.lineWidth = 1; g.strokeRect(x0, yOf(Math.min(h.hi, yMax)), Math.max(2, x1 - x0), yOf(h.lo === 'FZL' ? 0 : lo) - yOf(Math.min(h.hi, yMax))); g.setLineDash([]); g.fillStyle = HC[h.hazard] || '#f59e0b'; g.font = '9px Barlow, sans-serif'; g.fillText(h.hazard, x0 + 3, yOf(Math.min(h.hi, yMax)) + 10); }
  // terrain
  g.beginPath(); g.moveTo(L, T + ph); cols.forEach(c => g.lineTo(xOf(c.d), yOf(c.col ? c.col.elev / FT : 0))); g.lineTo(L + pw, T + ph); g.closePath(); g.fillStyle = '#4b4f57'; g.fill(); g.strokeStyle = '#9ca3af'; g.lineWidth = 1; g.stroke();
  // isotherms
  const line = (fn, col, dash, lbl) => { g.beginPath(); let open = false; cols.forEach(c => { const v = c.col ? fn(c.col) : null; if (v == null || v > yMax) { open = false; return; } const x = xOf(c.d), y = yOf(v); open ? g.lineTo(x, y) : g.moveTo(x, y); open = true; }); g.strokeStyle = col; g.setLineDash(dash); g.lineWidth = 1.6; g.stroke(); g.setLineDash([]); const last = [...cols].reverse().find(c => c.col && fn(c.col) != null && fn(c.col) <= yMax); if (last) { g.fillStyle = col; g.font = '9px Barlow, sans-serif'; g.fillText(lbl, Math.min(xOf(last.d) - 20, L + pw - 24), yOf(fn(last.col)) - 3); } };
  line(c => c.fzl != null ? c.fzl / FT : null, '#9be7ff', [], '0°C'); line(c => W.isoFt(c, -10), '#4f8dff', [5, 3], '−10°'); line(c => W.isoFt(c, -20), '#b377ff', [5, 3], '−20°');
  // route
  g.beginPath(); B.S.forEach((s, i) => { const x = xOf(s.dm / NM), y = yOf(s.alt); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.strokeStyle = '#fff'; g.lineWidth = 2.4; g.stroke();
  for (const p of B.an.sum.pirep) { const x = xOf(p.d), y = yOf(clamp(p.alt || 0, 0, yMax)); g.fillStyle = p.ice ? '#7fe9ff' : '#fb923c'; g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke(); }
  g.restore();
  // axes
  g.fillStyle = '#9ca3af'; g.strokeStyle = 'rgba(255,255,255,.1)'; g.font = '9.5px Barlow, sans-serif'; g.textAlign = 'right'; const stepFt = yMax <= 15000 ? 2500 : yMax <= 25000 ? 5000 : 10000; for (let a = 0; a <= yMax; a += stepFt) { const y = yOf(a); g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); g.fillText(a >= 18000 ? 'FL' + a / 100 : (a / 1000) + 'k', L - 4, y + 3); }
  g.textAlign = 'center'; const nT = Math.max(2, Math.min(8, Math.floor(pw / 80))); for (let i = 0; i <= nT; i++) { const d = tot * i / nT, s = B.S[Math.round(i / nT * (B.S.length - 1))]; g.fillText(Math.round(d) + ' nm', L + pw * i / nT, T + ph + 11); g.fillStyle = '#6b7280'; g.fillText(zt(s.t), L + pw * i / nT, T + ph + 22); g.fillStyle = '#9ca3af'; }
  g.textAlign = 'left'; cv._geo = { L, pw, T, ph, tot, yMax }; P.chart = cv; const note = $('#xsecNote'); if (note) note.textContent = `Altitude vs distance, each column at its own ETA. Clouds = model RH/cover; cyan→violet = icing potential; coloured bars = ${B.radar ? 'MRMS echo tops (hatched/dim = model-derived beyond the 2 h nowcast)' : 'model-derived precipitation'}; terrain = model orography (coarse); dashed boxes = AIRMET/SIGMET.`; drawCursor();
}
const dbzC = d => X.dbzColor(d);
function drawCursor() { const cv = P.chart, B = P.built; if (!cv || !B || !cv._geo) return; const ov = $('#xcur'); if (!ov) return; if (ov.width !== cv.width || ov.height !== cv.height) { ov.width = cv.width; ov.height = cv.height; } ov.style.width = cv.style.width; ov.style.height = cv.style.height; const dpr = cv.width / parseFloat(cv.style.width), g = ov.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); const { L, pw, T, ph, tot, yMax } = cv._geo, p = P.cur || posAt(0), x = L + p.d / tot * pw, y = T + ph * (1 - p.alt / yMax); g.strokeStyle = '#7fd6ff'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); g.fillStyle = '#7fd6ff'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); g.strokeStyle = '#000'; g.stroke(); }
// ---------- globe probe ----------
let handler = null;
function initProbe() { if (handler) return; handler = new Cesium.ScreenSpaceEventHandler(G.viewer.canvas); handler.setInputAction(m => { if (!P.active || !P.built?.model) return; const c = G.camera.pickEllipsoid(m.position, G.scene.globe.ellipsoid); if (!c) return; const cg = Cesium.Cartographic.fromCartesian(c), lat = Cesium.Math.toDegrees(cg.latitude), lon = Cesium.Math.toDegrees(cg.longitude), B = P.built, t = P.cur?.t ?? B.tl.t0, alt = P.cur?.alt ?? B.cruise, col = B.model.column(lat, lon, t), w = W.atAlt(col, alt), rs = B.radar ? B.radar.sample(lat, lon, t) : null, e = $('#probe'); if (!e) return; e.hidden = false; e.innerHTML = `<b>${lat.toFixed(2)}, ${lon.toFixed(2)}</b> · ${zt(t)} · at ${fl(alt)}<br>${w && !w.above ? `T ${w.T.toFixed(0)}°C · RH ${Math.round(w.rh)}% · wind ${String(Math.round((Math.atan2(-w.u, -w.v) * 180 / Math.PI + 360) % 360)).padStart(3, '0')}/${Math.round(Math.hypot(w.u, w.v))} kt · icing ${W.iceLabel(W.icingScore(w.T, w.rh)) || 'none'}` : 'model: n/a at this altitude'}<br>FZL ${col.fzl != null ? Math.round(col.fzl / FT).toLocaleString() + ' ft' : '—'} · cloud cover L/M/H ${col.cc.map(Math.round).join('/')}% · vis ${col.vis != null ? (col.vis / 1609).toFixed(1) + ' sm' : '—'} · CAPE ${Math.round(col.cape)}<br>${rs && rs.dbz != null ? `radar ${Math.round(rs.dbz)} dBZ${rs.topFt ? ', echo top ' + fl(rs.topFt) : ''}${rs.top50Ft ? ', 50 dBZ top ' + fl(rs.top50Ft) : ''} (${rs.kind})` : 'no radar echo'}`; clearTimeout(initProbe.t); initProbe.t = setTimeout(() => e.hidden = true, 12000); }, Cesium.ScreenSpaceEventType.LEFT_CLICK); }
// ---------- events / enter / exit ----------
function events() {
  const T = $('#tab-plan');
  T.addEventListener('click', e => { const id = e.target.id; if (id === 'pBuild') build(); else if (id === 'pClose') exit(); else if (id === 'pEx1') { Object.assign(P.cfg, { dep: 'KPAH', dest: 'KHNB', via: '', alts: 'KEVV', cruise: '8000', tas: 200 }); renderTab(); build(); } else if (id === 'pEx2') { Object.assign(P.cfg, { dep: 'KPAH', dest: 'KDEN', via: '', alts: '', cruise: 'FL250', tas: 260 }); renderTab(); build(); } });
  T.addEventListener('change', e => { const m = { lRadar: 'radar', lCloud: 'clouds', lIce: 'icing', lFzl: 'fzl', lWind: 'wind', lTurb: 'turb', lHaz: 'haz', lPirep: 'pirep', lMetar: 'metar' }[e.target.id]; if (m) { X.setLayer(m, e.target.checked); if (m === 'wind') { updateWindRow(); G.scene.requestRenderMode = !(e.target.checked) && !!app.isMobile; } } });
  T.addEventListener('input', e => { if (e.target.id === 'windAlt') { X.setWindAlt(+e.target.value); $('#windOut').textContent = fl(+e.target.value); } });
  T.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') build(); });
  const bar = $('#planbar'); bar.addEventListener('click', e => { const id = e.target.id; if (id === 'pPlay') P.playing ? stopPlay() : startPlay(); else if (id === 'pFollow') setFollow(!P.follow); else if (id === 'pChartToggle') bar.classList.toggle('nochart'); drawChartSoon(); });
  bar.addEventListener('input', e => { if (e.target.id === 'pScrub') { stopPlay(); seek(e.target.value / 1000, true); } });
  bar.addEventListener('change', e => { if (e.target.id === 'pSpeed') P.speed = +e.target.value; });
  document.addEventListener('pointerdown', e => { if (e.target.id === 'xcur' || e.target.id === 'xsec') { const cv = P.chart; if (!cv || !cv._geo) return; const mv = ev => { const r = cv.getBoundingClientRect(), f = clamp((ev.clientX - r.left - cv._geo.L) / cv._geo.pw, 0, 1), B = P.built; stopPlay(); seek(f); }; mv(e); const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); } });
  addEventListener('resize', drawChartSoon);
  document.addEventListener('sheet', drawChartSoon); document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlay(); });
}
let dcT; function drawChartSoon() { clearTimeout(dcT); dcT = setTimeout(() => { placeChart(); drawChart(); }, 90); }
function updateWindRow() { const on = $('#lWind')?.checked; $('#windRow').style.display = on ? 'flex' : 'none'; }
function placeChart() { const cv = $('#xsec'), cur = $('#xcur'); if (!cv) return; const desk = !isMobile(), host = desk ? $('#planChart') : $('#xsecHome'); if (cv.parentElement !== host) { host.append(cv, cur); } }
let savedVis = null;
function setTraffic(on) { const t = app.traffic; if (!t) return; P.traffic = on; if (on) { if (savedVis) Object.assign(t.visible, savedVis); savedVis = null; } else { if (!savedVis) savedVis = { ...t.visible }; Object.assign(t.visible, { com: false, pvt: false, mil: false, masked: false }); } t.setWatch(t.watch); G.scene.requestRender(); }
export function enter() {
  if (P.active) return; P.active = true; document.body.classList.add('plan-on'); $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === 'plan'));
  if (!$('#tab-plan').dataset.ready) { $('#tab-plan').dataset.ready = '1'; renderTab(); events(); } updateWindRow(); initProbe(); if (!P.traffic) setTraffic(false); if (P.built) { X.hideAll(false); showBar(); draw3D(); seek(P.pos); } placeChart(); drawChart(); drawChartSoon();
  if (!API_OK()) toast('Flight planning needs the SkyDeck server (weather proxy).', 'warn');
}
const API_OK = () => true;
export function exit() { if (!P.active) return; P.active = false; if (savedVis) setTraffic(true); stopPlay(); setFollow(false); document.body.classList.remove('plan-on', 'planning'); $('#planbar').hidden = true; X.hideAll(true); clearRoute(); $('#probe') && ($('#probe').hidden = true); $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === (state.settings.mode || 'std'))); G.scene.requestRender(); if ($('#tab-plan').classList.contains('on')) app.openTab('planes'); }
export const rebuild3d = () => { if (P.active && P.built) { X.rebuildExag(); draw3D(); seek(P.pos); } };
export const planState = P;
app.plan = { enter, exit, rebuild3d, state: P, build, seek, fl };
