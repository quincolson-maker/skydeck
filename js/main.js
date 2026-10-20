import { app } from './app.js';
import { state, save, store, home, allWatched, defaults, idbGet, idbSet, decodeList } from './store.js';
import { $, $$, esc, debounce, throttle, toast, fmtAge, distM, NM, FT, dayStr, nToIcao } from './util.js';
import { API, detectProxy, fetchList, norm, loadTraceDay, loadTraceRecent, adsb } from './api.js';
import * as G from './globe.js';
import { Traffic } from './traffic.js';
import { Traces } from './traces.js';
import { Replay, segmentFlights } from './replay.js';
import { Alerts, push as pushAlert } from './alerts.js';
import { airspace, airports, tfr, wx, radar, layerInfo, rebuildExag } from './layers.js';
import * as UI from './ui.js';
import { pickFlight, pickList, usableFlight, flightLabel, nearestFlight } from './flightpick.js';
import { initLayout } from './layout.js';
import './plan.js';
import { buildings, initEarth } from './earth.js';
const Cesium = window.Cesium, P = new URLSearchParams(location.search);
// one-line chip under the top bar: auto-dismisses after ~5 s, tap to dismiss; the same message is not re-shown until the condition clears
let bTimer = 0, bKey = '', bDismissed = '';
const banner = (msg, kind = '', full = '') => { const b = $('#banner'); if (!msg) { clearTimeout(bTimer); b.hidden = true; bKey = bDismissed = ''; return; } if (msg === bDismissed) return; if (msg === bKey && !b.hidden) return; bKey = msg; b.textContent = msg; b.title = full || msg; b.className = kind; b.hidden = false; clearTimeout(bTimer); bTimer = setTimeout(() => { b.hidden = true; bDismissed = msg; }, 5000); };
document.addEventListener('click', e => { if (e.target.id === 'banner') { e.target.hidden = true; bDismissed = bKey; clearTimeout(bTimer); } });
app.lastknown = store.get('lastknown', {}); app.history = {}; app.historyPending = new Set(); app.err = null; app.lastOk = 0; app.offline = null;
async function boot() {
  initLayout();
  const viewer = G.createViewer('globe', $('#credits')); G.initKeys();
  app.viewer = viewer; app.G = G; initEarth(); app.buildings = buildings;
  $('#credits').parentElement.dataset.c = 1;
  const traffic = app.traffic = new Traffic(throttle(() => { onTraffic(); }, 800)); app.traces = new Traces(); app.replay = new Replay(traffic); app.alerts = new Alerts();
  traffic.setWatch(allWatched());
  await detectProxy();
  if (!API.proxy) banner('Live traffic needs the SkyDeck proxy · run node server.js', '', 'Live traffic needs the SkyDeck proxy (adsb.lol sends no CORS headers). Run “node server.js” and open the app from it. Showing last-known state only.');
  UI.initUI(); initHashImport(); initInteraction(); initSearch(); initTop(); drawFences();
  // initial camera: whole globe, then glide to home (or ?view=lat,lon,h,heading,pitch)
  const h = home();
  if (P.get('view')) { const [la, lo, hh, hd, pt] = P.get('view').split(',').map(Number); G.setView(la, lo, hh, hd || 0, pt ?? -90); }
  else { const mil = (P.get('mode') || state.settings.mode) === 'mil'; G.setView(h.lat - 20, h.lon, 2.4e7, 0, -90); if (!mil) setTimeout(() => G.flyTo(h.lat, h.lon, 380000, { pitch: -48, duration: 3.2 }), 600); else setTimeout(() => G.flyTo(30, -20, 2.4e7, { pitch: -90, duration: 2 }), 300); }
  if (P.get('mode') === 'mil') setMode('mil', true); else setMode(state.settings.mode || 'std', true);
  loops(); layerRefreshHooks(); registerSW();
  document.addEventListener('replayui', () => { G.scene.requestRenderMode = app.isMobile ? !(app.replay.active || app.replay.chase) : false; G.scene.requestRender(); });
  if (P.get('bench')) setTimeout(() => app.bench(+P.get('bench')), 9000);
  app.ready = true; document.documentElement.dataset.ready = '1';
}
// ============ polling ============
const poll = { std: { busy: false, backoff: 0, next: 0 }, watch: { busy: false, backoff: 0, next: 0 } };
function radiusNm() { return Math.min(250, state.settings.radiusNm); }
async function pollStd() {
  const p = poll.std; if (p.busy || !API.proxy) return; p.busy = true;
  try {
    let r;
    if (state.settings.mode === 'mil') { r = await fetchList('mil'); app.traffic.ingest([], 'std'); app.traffic.ingest(r.list, 'mil'); app.count = { total: r.list.length, what: 'military aircraft worldwide' }; }
    else { const c = state.settings.followView ? (G.cameraInfo().ctr || home()) : home(); r = await fetchList(`point/${c.lat.toFixed(3)}/${c.lon.toFixed(3)}/${radiusNm()}`); app.traffic.ingest([], 'mil'); app.traffic.ingest(r.list, 'std'); app.count = { total: r.list.length, what: `aircraft within ${radiusNm()} nm of ${state.settings.followView ? 'view centre' : home().name}` }; }
    p.backoff = 0; app.err = null; app.lastOk = Date.now(); app.sky = r.sky; if (app.offline) { app.offline = null; banner(''); } saveSnapshot();
  } catch (e) { p.backoff = e.retryAfter ? e.retryAfter * 1000 : Math.min(120000, (p.backoff || 6000) * 2); app.err = e.status === 429 ? `All free ADS-B sources are busy — retrying in ${Math.round(p.backoff / 1000)} s` : 'Live data unavailable: ' + e.message; await loadSnapshotOnce(); }
  p.busy = false;
}
async function pollWatch() {
  const p = poll.watch; if (p.busy || !API.proxy) return; const hexes = [...allWatched().keys()]; if (!hexes.length) return; p.busy = true; let ok = true, list = [];
  try { for (let i = 0; i < hexes.length; i += 40) { const r = await fetchList('hex/' + hexes.slice(i, i + 40).join(',')); list = list.concat(r.list); app.skyW = r.sky; } app.traffic.ingest(list, 'watch'); p.backoff = 0; }
  catch (e) { ok = false; p.backoff = e.retryAfter ? e.retryAfter * 1000 : Math.min(120000, (p.backoff || 6000) * 2); }
  if (ok) {
    const lk = app.lastknown; for (const a of list) { lk[a.hex] = { a, t: Date.now() }; if (app.traces.has(a.hex)) app.traces.push(a.hex, a); } store.set('lastknown', lk);
    app.alerts.checkWatch(list, true);
  }
  p.busy = false; UI.renderPlanes();
}
let snapT = 0;
async function saveSnapshot() { if (Date.now() - snapT < 30000) return; snapT = Date.now(); const l = app.traffic.all().slice(0, 4000); await idbSet('snapshot', { t: Date.now(), mode: state.settings.mode, list: l }); }
let snapLoaded = false;
async function loadSnapshotOnce() {
  if (snapLoaded || app.traffic.size > 0) return; snapLoaded = true; const s = await idbGet('snapshot'); if (!s || !s.list?.length) return;
  app.offline = { t: s.t }; app.traffic.ingest(s.list, s.mode === 'mil' ? 'mil' : 'std', s.t + 1); app.traffic.setFrozen(false);
  banner(`Offline · last-known state ${fmtAge((Date.now() - s.t) / 1000)} old`, '', `OFFLINE — showing last-known state from ${new Date(s.t).toLocaleString()} (${fmtAge((Date.now() - s.t) / 1000)}). Positions are frozen at that time.`);
}
function loops() {
  const tick = () => {
    const now = Date.now(), ms = Math.max(10, state.settings.refreshSec) * 1000;
    if (!document.hidden && state.settings.auto && !app.replay.mode) {
      if (now >= poll.std.next) { poll.std.next = now + Math.max(ms, state.settings.mode === 'mil' ? 20000 : 0) + poll.std.backoff; pollStd().then(() => app.alerts.checkGeofences(app.traffic.all())); }
      if (now >= poll.watch.next) { poll.watch.next = now + ms + poll.watch.backoff; setTimeout(pollWatch, 1500); }
    }
    updateStatus();
  };
  setInterval(tick, 500); tick();
  app.pollNow = () => { poll.std.next = 0; };
  setInterval(historyLookups, 20000); setTimeout(historyLookups, 4000);
  setInterval(() => { UI.renderPlanes(); UI.renderSel(); if ($('#tab-mil').classList.contains('on')) UI.renderMil(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) app.pollNow(); });
}
// last-seen lookup (for planes not currently received): recent trace, then up to 7 previous UTC days (cached 15 min)
async function historyLookups() {
  if (!API.proxy || document.hidden) return; let done = 0; for (const [hex, it] of allWatched()) {
    if (app.traffic.get(hex) || app.history[hex]?.checked > Date.now() - 900000 || app.historyPending.has(hex)) continue; app.historyPending.add(hex);
    try { let pts = (await loadTraceRecent(hex)).pts; for (let i = 0; !pts.length && i < 7; i++) pts = (await loadTraceDay(hex, dayStr(Date.now() - i * 86400000))).pts;
      if (pts.length) { const l = pts[pts.length - 1]; app.history[hex] = { checked: Date.now(), t: l.t, a: { hex, lat: l.lat, lon: l.lon, alt: l.alt, gnd: l.gnd, gs: l.gs, trk: l.trk, vr: 0, reg: it.reg } }; } else app.history[hex] = { checked: Date.now(), none: true };
    } catch (e) { app.history[hex] = { checked: Date.now(), none: true, err: e.message }; }
    app.historyPending.delete(hex); UI.renderPlanes(); if (++done >= 3) break;
  }
}
function onTraffic() { UI.renderPlanes(); if ($('#tab-lists').classList.contains('on')) UI.renderLists(); if (app.traffic.sel) UI.renderSel(); if ($('#tab-mil').classList.contains('on')) UI.renderMil(); }
let fpsN = 0, fpsT = performance.now(), fps = 0; G.scene && 0;
function updateStatus() {
  const t = app.traffic, el = $('#stat'); const age = app.lastOk ? (Date.now() - app.lastOk) / 1000 : null, sk = app.sky;
  const src = sk ? ` · <span class="src" title="${esc(sk.note || '')}">${esc(sk.src)}${sk.stale ? ' (cached ' + sk.age + ' s)' : ''}</span>` : '';
  const live = state.settings.auto ? (app.err ? `<span class="warn">◌ ${esc(app.err)}</span>` : age != null ? `<span class="ok">● LIVE</span> ${Math.round(age)}s${src}` : '<span class="mut">○ CONNECTING</span>') : '<span class="warn">❚❚ PAUSED</span>';
  const mode = app.replay.mode ? ` · <b>${app.replay.mode === 'travel' ? 'TIME TRAVEL' : 'REPLAY'}</b>` : '';
  el.innerHTML = `${live}${mode} · ${t.size.toLocaleString()} AC${app.count && !app.isMobile ? ' (' + esc(app.count.what) + ')' : ''} · ${fps} FPS${API.proxy === false ? ' · <span class="warn">NO PROXY</span>' : ''}`;
  $('#liveBtn').classList.toggle('on', !!state.settings.auto);
  if (app.offline) return;
  if (!API.proxy) return;
  if (app.replay.mode) { banner(''); return; }
  if (sk?.stale && !app.err) banner(`Cached data · sources busy`, 'info', `Showing cached data from ${sk.src} (${sk.age} s old). Live sources are busy; retrying shortly.`);
  else if (app.err && t.size === 0) banner('Sources busy · retrying', 'info', app.err + '. Data will appear when a source recovers.');
  else if (app.lastOk && !app.err && t.size === 0) banner('No aircraft in range · try a larger radius', 'info', 'No aircraft received in this area right now — try a larger radius or Mil-Ops.');
  else banner('');
}
setInterval(() => { const n = performance.now(); fps = Math.round(fpsN * 1000 / (n - fpsT)); fpsN = 0; fpsT = n; }, 1000);
// ============ mode / top bar ============
function setMode(m, quiet) {
  state.settings.mode = m; save('settings'); $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m)); poll.std.next = 0;
  if (m === 'mil') { app.traffic.ingest([], 'std'); if (!quiet) UI.openTab('mil'); } else app.traffic.ingest([], 'mil');
}
function initTop() {
  $('#modeSeg').addEventListener('click', e => { const m = e.target.dataset.mode; if (m === 'plan') { app.plan.enter(); UI.openTab('plan'); return; } if (m && app.plan) app.plan.exit(); if (m) setMode(m); if (m === 'mil') G.flyTo(30, -20, 2.2e7, { pitch: -90, duration: 2 }); else app.goHome(); });
  $('#liveBtn').addEventListener('click', () => { state.settings.auto = !state.settings.auto; save('settings'); if (state.settings.auto) app.pollNow(); });
  $('#themeBtn').addEventListener('click', () => { state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; save('settings'); G.applyTheme(); });
  $('#homeBtn').addEventListener('click', () => app.goHome());
  $('#fwdBtn').addEventListener('click', e => { state.settings.fwdAll = !state.settings.fwdAll; save('settings'); e.target.classList.toggle('on', state.settings.fwdAll); toast(state.settings.fwdAll ? 'Forward markers on for nearest airborne traffic' : 'Forward markers only for watched / selected aircraft'); });
  $('#burnBtn').addEventListener('click', () => { app.traffic.clear(); app.traces.clear(); app.replay.stop(); state.settings.auto = false; save('settings'); idbSet('snapshot', null); app.count = null; toast('Burned: traffic and traces cleared. Auto-refresh paused — press ● Live to resume.', 'warn', 6000); UI.renderPlanes(); UI.renderSel(); });
  let dip; addEventListener('beforeinstallprompt', e => { e.preventDefault(); dip = e; $('#installBtn').hidden = false; });
  $('#installBtn').addEventListener('click', async () => { if (dip) { dip.prompt(); await dip.userChoice; dip = null; $('#installBtn').hidden = true; } });
  addEventListener('hashchange', initHashImport);
  G.scene.postRender.addEventListener(() => fpsN++);
}
app.goHome = () => { const h = home(); G.flyTo(h.lat, h.lon, 320000, { pitch: -50 }); app.pollNow(); };
app.exagChanged = debounce(() => { app.traces.redrawAll(); rebuildExag(); buildings.rebuild(); app.plan?.rebuild3d(); }, 250);
app.onListsChanged = () => { app.traffic.setWatch(allWatched()); poll.watch.next = 0; UI.renderPlanes(); UI.renderLists(); UI.renderReports(); UI.renderTime(); };
app.select = hex => { app.traffic.setSelected(hex); UI.renderSel(); if (!hex) app.replay.followLive && app.replay.endChase(); };
app.focus = hex => { const a = app.traffic.get(hex); if (a) { G.flyTo(a.lat, a.lon, a.gnd ? 6000 : 45000, { pitch: -50 }); app.select(hex); } };
app.toggleTrace = async (hex, reg, forceOn) => { if (app.traces.has(hex)) { if (!forceOn) app.traces.hide(hex); } else await app.traces.show(hex, reg); UI.renderPlanes(); UI.renderSel(); };
// v1.4: "Last flight" loads the last 7 days and offers a flight picker (newest preselected); a single flight starts at once
app.replayLast = async (hex, reg) => {
  if (!API.proxy) return toast('Replay needs the SkyDeck proxy (ADS-B history has no CORS).', 'warn');
  toast('Loading flight history…'); let failed = 0; const name = reg || hex.toUpperCase();
  const parts = await Promise.all([...Array(7)].map(async (_, i) => { try { return (await loadTraceDay(hex, dayStr(Date.now() - i * 86400000))).pts || []; } catch (e) { failed++; console.warn('trace day', e.message); return []; } }));
  const pts = [].concat(...parts).sort((a, b) => a.t - b.t).filter((p, i, A) => !i || p.t !== A[i - 1].t);
  const all = segmentFlights(pts); const fl = all.filter(usableFlight).reverse();
  if (!fl.length) return toast(failed ? `Couldn't load ADS-B history for ${name} right now (${failed} of 7 requests failed). Try again in a minute.` : all.length ? `Only very short track fragments for ${name} in the last 7 days — nothing to replay.` : `No flight found for ${name} in the last 7 days of ADS-B Exchange history.`, 'warn', 6000);
  const go = i => { const f = fl[i]; if (app.replay.startFlight(hex, f.pts, flightLabel(name, f))) UI.openTab('time'); };
  if (fl.length === 1) return go(0);
  pickFlight(`${name} · last 7 days`, fl, 0, go);
};
// v1.4: Time Travel → pick a tracked aircraft → (pick a flight that day) → smoothed 3D replay with chase cam on
app.chaseTravel = hex => {
  const R = app.replay; const pts = R.tracks.get(hex); if (!pts) return; const it = (R.hexes || []).find(h => h.hex === hex); const name = it?.reg || hex.toUpperCase();
  const day0 = R.t0, day1 = R.t1, fl = segmentFlights(pts).filter(usableFlight).filter(f => f.pts[f.pts.length - 1].t >= day0 && f.pts[0].t <= day1);
  if (!fl.length) return toast(`${name}: no complete flight on this date to replay in 3D (only ground/fragmentary reports).`, 'warn', 6000);
  const go = i => { const f = fl[i]; if (R.startFlight(hex, f.pts, flightLabel(name, f))) { R.startChase(); R.ui(true); } };
  const k = nearestFlight(fl, R.clock); if (fl.length === 1) return go(0);
  pickFlight(`${name} · chase / 3D replay`, fl, k, go);
};
app.travelPick = () => {
  const R = app.replay; if (R.mode !== 'travel') return; const hs = (R.hexes || []).filter(h => R.tracks.has(h.hex));
  if (hs.length === 1) return app.chaseTravel(hs[0].hex);
  pickList('Chase / 3D replay', 'Pick a tracked aircraft', hs.map(h => { const n = segmentFlights(R.tracks.get(h.hex)).filter(usableFlight).length; return { html: `<span class="fp-d">${esc(h.reg || h.hex.toUpperCase())}</span><span class="fp-t mono">${n} FLIGHT${n === 1 ? '' : 'S'}</span><span class="fp-r">${esc(h.label || h.type || '')}</span><span class="fp-m mono">${h.hex.toUpperCase()}</span>` }; }), i => app.chaseTravel(hs[i].hex));
};
app.importList = code => { const l = decodeList(code); if (!l) return toast('That share link/code is not valid.', 'warn'); const ex = state.watchlists.find(x => x.name === l.name && JSON.stringify(x.items.map(i => i.hex)) === JSON.stringify(l.items.map(i => i.hex))); if (ex) return toast('List already imported: ' + l.name); state.watchlists.push({ id: 'l' + Date.now().toString(36), name: l.name, items: l.items }); save('watchlists'); app.onListsChanged(); UI.openTab('lists'); toast(`Imported “${l.name}” (${l.items.length} aircraft)`); };
function initHashImport() { const m = location.hash.match(/wl=([A-Za-z0-9_-]+)/); if (m) { app.importList(m[1]); history.replaceState(null, '', location.pathname + location.search); } }
// ============ interaction: hover, click, geofence drawing ============
let draw = null, fenceEnts = new Map();
function groundPos(px) { const ray = G.camera.getPickRay(px); return ray && G.scene.globe.pick(ray, G.scene); }
function initInteraction() {
  const h = new Cesium.ScreenSpaceEventHandler(G.scene.canvas); let dragging = false;
  h.setInputAction(() => dragging = true, Cesium.ScreenSpaceEventType.LEFT_DOWN); h.setInputAction(() => setTimeout(() => dragging = false, 10), Cesium.ScreenSpaceEventType.LEFT_UP);
  h.setInputAction(throttle(m => {
    if (draw && draw.center) { const p = groundPos(m.endPosition); if (p) { const c = Cesium.Cartographic.fromCartesian(p); draw.r = distM(draw.center.lat, draw.center.lon, Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude)); drawPreview(); } return; }
    if (dragging || app.replay.chase) { UI.showHover(null); return; }
    const pk = G.scene.pick(m.endPosition); const id = pk && typeof pk.id === 'string' ? pk.id : (pk && pk.id && pk.id.id) || null;
    if (id && app.traffic.recs.has(id)) { app.traffic.hover = id; UI.showHover(app.traffic.get(id), m.endPosition.x, m.endPosition.y); G.scene.canvas.style.cursor = 'pointer'; }
    else { app.traffic.hover = null; const t = id && layerInfo(id); UI.showHoverText(t, m.endPosition.x, m.endPosition.y); G.scene.canvas.style.cursor = draw ? 'crosshair' : 'default'; }
  }, 60), Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  h.setInputAction(c => {
    if (draw) { const p = groundPos(c.position); if (!p) return; const cg = Cesium.Cartographic.fromCartesian(p), lat = Cesium.Math.toDegrees(cg.latitude), lon = Cesium.Math.toDegrees(cg.longitude);
      if (!draw.center) { draw.center = { lat, lon }; draw.r = 1000; toast('Now click to set the radius'); drawPreview(); } else { const rNm = Math.max(0.5, +(distM(draw.center.lat, draw.center.lon, lat, lon) / NM).toFixed(1)); const cc = draw.center; endDraw(); app.addFence({ name: 'Geofence ' + (state.geofences.length + 1), lat: cc.lat, lon: cc.lon, rNm }); } return; }
    const pk = app.isMobile ? G.scene.pick(c.position, 28, 28) : G.scene.pick(c.position), id = pk && typeof pk.id === 'string' ? pk.id : null;
    if (app.collapseSheet) app.collapseSheet();
    if (id && id.startsWith('tt:') && app.replay.mode === 'travel') app.chaseTravel(id.slice(3)); else if (id && app.traffic.recs.has(id)) app.select(id); else if (!id || !id.startsWith('apt:')) { if (app.traffic.sel && !pk) app.select(null); }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  addEventListener('keydown', e => { if (e.key === 'Escape') { if (draw) endDraw(); else if (app.replay.chase || app.replay.followLive) app.replay.endChase(); } });
}
let prevEnt = null;
function drawPreview() { if (!draw) return; if (!prevEnt) prevEnt = G.viewer.entities.add({ position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(draw.center.lon, draw.center.lat), false), ellipse: { semiMajorAxis: new Cesium.CallbackProperty(() => Math.max(300, draw.r), false), semiMinorAxis: new Cesium.CallbackProperty(() => Math.max(300, draw.r), false), material: Cesium.Color.fromCssColorString('#7fd6ff').withAlpha(.18), outline: true, outlineColor: Cesium.Color.fromCssColorString('#7fd6ff'), height: 0 } }); }
function endDraw() { draw = null; if (prevEnt) { G.viewer.entities.remove(prevEnt); prevEnt = null; } G.scene.canvas.style.cursor = 'default'; }
app.startDraw = () => { draw = { center: null, r: 0 }; G.scene.canvas.style.cursor = 'crosshair'; toast('Geofence: click the centre on the globe (Esc to cancel)'); if (innerWidth < 820) $('#side').classList.add('hide'); };
app.addFence = f => { state.geofences.push({ id: 'g' + Date.now().toString(36), enabled: true, ...f }); save('geofences'); drawFences(); UI.renderAlerts(); UI.openTab('alerts'); toast(`Geofence “${f.name}” added (${f.rNm} nm)`); };
function drawFences() {
  for (const e of fenceEnts.values()) G.viewer.entities.remove(e); fenceEnts.clear(); const k = G.exag();
  for (const f of state.geofences) { if (f.enabled === false) continue; fenceEnts.set(f.id, G.viewer.entities.add({ position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat), ellipse: { semiMajorAxis: f.rNm * NM, semiMinorAxis: f.rNm * NM, height: 0, extrudedHeight: (f.maxAlt || 10000) * FT * k, material: Cesium.Color.fromCssColorString('#ff5d73').withAlpha(.10), outline: true, outlineColor: Cesium.Color.fromCssColorString('#ff5d73').withAlpha(.9) }, label: { text: f.name, font: '600 12px system-ui', fillColor: Cesium.Color.WHITE, outlineWidth: 3, outlineColor: Cesium.Color.BLACK, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -12), translucencyByDistance: new Cesium.NearFarScalar(1e5, 1, 3e6, 0) } })); }
}
app.drawFences = drawFences;
// ============ search ============
function initSearch() {
  const q = $('#q'), box = $('#results'); let seq = 0;
  const show = rows => { box.innerHTML = rows.join('') || ''; box.hidden = !rows.length; };
  const row = (a, tag = '') => `<div class="res" data-hex="${a.hex}"><b>${esc(a.fl || a.reg || a.hex.toUpperCase())}</b><span>${esc(a.reg)} ${esc(a.type)}</span><small>${a.gnd ? 'GND' : esc(Math.round(a.alt ?? 0).toLocaleString() + ' ft')} ${tag}</small></div>`;
  const run = debounce(async () => {
    const s = q.value.trim(); if (s.length < 2) return show([]); const my = ++seq; const local = app.traffic.find(s); const rows = local.slice(0, 12).map(a => row(a, '· on globe'));
    const U0 = s.toUpperCase().replace(/\s/g, ''), tracked = [...allWatched().values()].filter(i => (i.reg || '').toUpperCase().includes(U0) || i.hex.toUpperCase() === U0 || (i.label || '').toUpperCase().includes(U0)).filter(i => !local.some(l => l.hex === i.hex));
    const trow = tracked.map(i => { const k = app.lastknown[i.hex]?.a || app.history[i.hex]?.a; return `<div class="res" data-hex="${i.hex}" data-tracked="1"><b>${esc(i.reg || i.hex.toUpperCase())}</b><span>${esc(i.label || '')}</span><small>${k ? 'LAST KNOWN' : 'TRACKED · NO POSITION'}</small></div>`; });
    rows.push(...trow);
    show(rows.length ? rows : ['<div class="res"><span class="empty">searching…</span></div>']);
    if (!API.proxy) { if (!rows.length) show(['<div class="res"><span class="empty">Live search needs the SkyDeck proxy.</span></div>']); return; }
    const U = s.toUpperCase().replace(/\s/g, ''), tries = [], nh = /^N\d/.test(U) ? nToIcao(U) : null;   // fewest upstream calls: a hex lookup answers N-numbers and hexes
    if (/^[0-9A-F]{6}$/.test(U)) tries.push('hex/' + U.toLowerCase()); else if (nh) tries.push('hex/' + nh.toLowerCase()); else { tries.push('callsign/' + U); if (/^[A-Z0-9]{1,2}-?[A-Z0-9]{3,5}$/.test(U) && /\d|-/.test(U)) tries.push('registration/' + U); if (/^[A-Z0-9]{2,4}$/.test(U)) tries.push('type/' + U); }
    const found = new Map(); await Promise.all(tries.map(async p => { try { const r = await fetchList(p); r.list.slice(0, 40).forEach(a => found.set(a.hex, a)); } catch { } })); if (my !== seq) return;
    const extra = [...found.values()].filter(a => !local.some(l => l.hex === a.hex)); extra.forEach(a => { box._cache = box._cache || new Map(); box._cache.set(a.hex, a); });
    const all = [...rows, ...extra.slice(0, 25).map(a => row(a, '· live'))];
    const hexN = /^N\d/.test(U) ? nToIcao(U) : null;
    show(all.length ? all : [`<div class="res"><span class="empty">No aircraft matching “${esc(s)}” is transmitting right now.${hexN ? ' ' + esc(U) + ' = hex ' + hexN + '.' : ''}</span></div>`]);
  }, 650);
  q.addEventListener('input', run); q.addEventListener('focus', run); document.addEventListener('click', e => { if (!e.target.closest('.search')) box.hidden = true; });
  box.addEventListener('click', e => { const r = e.target.closest('[data-hex]'); if (!r) return; const hex = r.dataset.hex; if (r.dataset.tracked && !app.traffic.get(hex)) { const k = app.lastknown[hex]?.a || app.history[hex]?.a; if (k) { G.flyTo(k.lat, k.lon, 40000, { pitch: -50 }); box.hidden = true; if (app.collapseSheet) app.collapseSheet(); } else toast('No known position for that aircraft yet.', 'warn'); return; } let a = app.traffic.get(hex); if (!a && box._cache?.get(hex)) { a = box._cache.get(hex); app.traffic.ingest([a], 'watch'); } if (a) { app.focus(hex); box.hidden = true; if (app.collapseSheet) app.collapseSheet(); } });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') box.querySelector('[data-hex]')?.click(); });
}
function layerRefreshHooks() {
  const r = debounce(() => { airspace.refresh(); airports.refresh(); }, 900); G.camera.moveEnd.addEventListener(r); G.camera.changed.addEventListener(r); G.camera.percentageChanged = 0.4;
  setInterval(() => { if (tfr.on) tfr.load(); if (wx.on) wx.load(); if (radar.on && radar.src === 'rainviewer') radar.load(); }, 600000);
}
function registerSW() { if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !P.has('nosw')) navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e)); }
// ============ bench (synthetic load test: ?bench=N — clearly flagged, never default) ============
app.bench = async n => {
  const base = app.traffic.all(); if (!base.length) return 'no traffic to replicate'; const out = []; const t = Date.now(); const ids = [];
  for (let i = 0; i < n; i++) { const b = base[i % base.length]; out.push({ ...b, hex: 'b' + i.toString(16).padStart(5, '0'), lat: b.lat + (Math.random() - .5) * 8, lon: b.lon + (Math.random() - .5) * 12, t }); }
  app.traffic.ingest(out, 'std'); $('#banner').textContent = `BENCH: ${n} synthetic aircraft (replicated real tracks, random offsets) — performance test only`; $('#banner').hidden = false; $('#banner').className = 'bad'; return n;
};
boot().catch(e => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:60px;left:20px;z-index:99;background:#300;color:#fcc;padding:12px;border-radius:8px;max-width:80vw;white-space:pre-wrap">SkyDeck failed to start: ${esc(e.stack || e)}</pre>`); });
window.SkyDeck = app;
