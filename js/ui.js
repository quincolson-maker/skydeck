import { app } from './app.js';
import { state, save, home, allWatched, encodeList, decodeList, MINE } from './store.js';
import { $, $$, esc, el, fmtAlt, fmtAge, fmtDur, debounce, toast, nToIcao, icaoToN, distM, NM, download, toCSV, dayStr, FT } from './util.js';
import { BASEMAPS, setBasemap, setTerrain, setExag, applyTheme, flyTo, cameraInfo, viewer, applyQuality, applyLighting } from './globe.js';
import { buildings } from './earth.js';
import { airspace, airports, tfr, wx, radar, status, rebuildExag } from './layers.js';
import { log as alertLog, clearLog } from './alerts.js';
import { hexInfo, airportByIdent, API } from './api.js';
import { buildReport, exportCSV, exportJSON } from './reports.js';
import { segmentFlights } from './replay.js';
import { renderJB, initJB } from './jetbasket.js';
import { trace24h } from './traces.js';
import { COLORS } from './traffic.js';
const T = id => $('#tab-' + id);
const chip = (a, st) => st === 'air' ? '<span class="chip air">AIRBORNE</span>' : st === 'gnd' ? '<span class="chip gnd">ON GROUND</span>' : '<span class="chip off">NOT RECEIVED</span>';
export function resolveId(q) { q = q.trim().toUpperCase().replace(/\s+/g, ''); if (/^[0-9A-F]{6}$/.test(q) && !/^N/.test(q)) return { hex: q.toLowerCase(), reg: icaoToN(q) || '' }; const h = /^N\d/.test(q) ? nToIcao(q) : null; return h ? { hex: h.toLowerCase(), reg: q } : null; }
// ================= My Planes =================
function mineList() { return state.watchlists.find(l => l.id === 'mine') || state.watchlists[0]; }
function statusOf(it) {
  const a = app.traffic.get(it.hex); if (a) return { st: a.gnd ? 'gnd' : 'air', a, live: true, age: (Date.now() - a.t) / 1000 };
  const k = app.lastknown[it.hex]; if (k) return { st: 'off', a: k.a, age: (Date.now() - k.t) / 1000, src: 'last received by this app' };
  const h = app.history[it.hex]; if (h) return { st: 'off', a: h.a, age: (Date.now() - h.t) / 1000, src: 'ADS-B Exchange history' };
  return { st: 'off', age: null };
}
function planeCard(it, full = true) {
  const s = statusOf(it), a = s.a; const lab = it.reg || it.hex.toUpperCase();
  let line = '<span class="mut">no position known — not seen in the last 7 days of history (or history source unreachable)</span>';
  if (a) line = `<div class="kv mono"><span>ALT</span><span>${a.gnd || s.st === 'gnd' ? 'GND' : fmtAlt(a.alt)}${a.vr && s.live && !a.gnd ? ` <small class="mut">${a.vr > 0 ? '▲' : '▼'}${Math.abs(Math.round(a.vr))} fpm</small>` : ''}</span><span>GS</span><span>${Math.round(a.gs || 0)} kt${s.live ? ' · hdg ' + String(Math.round(a.trk)).padStart(3, '0') + '°' : ''}</span><span>LAST SEEN</span><span>${fmtAge(s.age)}${s.live ? '' : ' <small class="mut">(' + s.src + ')</small>'}</span><span>POS</span><span>${a.lat.toFixed(3)}, ${a.lon.toFixed(3)}</span></div>`;
  else if (s.age == null && app.historyPending.has(it.hex)) line = '<span class="mut">checking history…</span>';
  return `<div class="card" data-hex="${it.hex}"><div class="row sp"><div><span class="big">${esc(lab)}</span> <span class="mut">${esc(it.label || '')}</span></div>${chip(a, s.st)}</div>${line}
  <div class="row" style="margin-top:8px"><button class="btn sm" data-act="fly">Fly to</button><button class="btn sm ${app.traces.has(it.hex) ? 'on' : ''}" data-act="trace">24 h trace</button><button class="btn sm" data-act="chase" ${s.live ? '' : 'disabled'}>Chase</button><button class="btn sm" data-act="replay">Last flight ▶</button>${full ? '<button class="btn sm bad" data-act="rm">✕</button>' : ''}</div></div>`;
}
export function renderPlanes() {
  const L = mineList(), box = T('planes'); const focus = document.activeElement?.id === 'addPlane'; const val = $('#addPlane')?.value || '';
  box.innerHTML = `<div class="row sp"><h3 style="margin:0">${esc(L.name)}</h3><span class="mut">${L.items.filter(i => app.traffic.get(i.hex)).length}/${L.items.length} live</span></div><div style="margin-top:8px">${L.items.map(i => planeCard(i)).join('') || '<div class="empty">No planes yet — add an N-number or hex below.</div>'}</div>
  <h3>Add a plane</h3><div class="row"><input id="addPlane" class="grow" placeholder="N-number or ICAO hex (e.g. N864RJ)" value="${esc(val)}"><button class="btn pri" id="addPlaneBtn">Add</button></div><div class="st" id="addMsg"></div>
  <div class="mut" style="font-size:11px;margin-top:10px">Status comes from adsb.lol (live). When a plane isn't being received, SkyDeck shows its last known position from this app's cache or from ADS-B Exchange history (up to 7 days back).</div>`;
  if (focus) $('#addPlane').focus();
}
async function addPlane(listId, q, label) {
  const id = resolveId(q); const msg = $('#addMsg'); if (!id) { if (msg) { msg.textContent = 'Not a valid US N-number or 6-digit hex.'; msg.className = 'st bad'; } return false; }
  const L = state.watchlists.find(l => l.id === listId) || mineList(); if (L.items.some(i => i.hex === id.hex)) { toast('Already in ' + L.name); return false; }
  let lab = label || ''; if (!lab) { const info = await hexInfo(id.hex); if (info) { lab = [info.Manufacturer, info.Type].filter(Boolean).join(' '); id.reg = id.reg || info.Registration || ''; } }
  L.items.push({ hex: id.hex, reg: id.reg, label: lab }); save('watchlists'); app.onListsChanged(); toast(`Added ${id.reg || id.hex.toUpperCase()} to ${L.name}`); return true;
}
app.addPlane = addPlane;
function planesEvents() {
  T('planes').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'), card = e.target.closest('[data-hex]');
    if (e.target.id === 'addPlaneBtn') { if (await addPlane(mineList().id, $('#addPlane').value)) $('#addPlane').value = ''; return; }
    if (!b || !card) return; const hex = card.dataset.hex, it = mineList().items.find(i => i.hex === hex); handleAct(b.dataset.act, hex, it, mineList());
  });
  T('planes').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'addPlane') $('#addPlaneBtn').click(); });
}
function handleAct(act, hex, it, list) {
  if (act === 'fly') { const a = app.traffic.get(hex) || app.lastknown[hex]?.a || app.history[hex]?.a; if (a) { flyTo(a.lat, a.lon, a.gnd ? 6000 : 40000, { pitch: -50 }); app.select(hex); } else toast('No known position for this aircraft.', 'warn'); }
  else if (act === 'trace') app.toggleTrace(hex, it?.reg);
  else if (act === 'chase') { app.select(hex); app.replay.startLiveChase(hex); }
  else if (act === 'replay') app.replayLast(hex, it?.reg);
  else if (act === 'rm') { list.items = list.items.filter(i => i.hex !== hex); save('watchlists'); app.traces.hide(hex); app.onListsChanged(); }
}
// ================= Lists =================
let curList = null;
export function renderLists() {
  const box = T('lists'); if (!state.watchlists.find(l => l.id === curList)) curList = state.watchlists[0].id; const L = state.watchlists.find(l => l.id === curList);
  box.innerHTML = `<div class="row"><select id="listSel" class="grow">${state.watchlists.map(l => `<option value="${l.id}" ${l.id === curList ? 'selected' : ''}>${esc(l.name)} (${l.items.length})</option>`).join('')}</select><button class="btn" id="newList">+ New</button></div>
  <div class="row" style="margin-top:8px"><button class="btn sm" id="shareList">🔗 Share URL</button><button class="btn sm" id="traceList">Traces for all</button><button class="btn sm" id="renList">Rename</button>${L.mine ? '' : '<button class="btn sm bad" id="delList">Delete</button>'}</div>
  <h3>Aircraft</h3>${L.items.map(i => { const a = app.traffic.get(i.hex); return `<div class="card" data-hex="${i.hex}"><div class="row sp"><div><b>${esc(i.reg || i.hex.toUpperCase())}</b> <span class="mut">${esc(i.label || '')}</span><br><small class="mono mut">${i.hex.toUpperCase()}</small></div><div class="row">${a ? (a.gnd ? '<span class="chip gnd">GND</span>' : '<span class="chip air">' + fmtAlt(a.alt) + '</span>') : '<span class="chip off">—</span>'}<button class="btn sm" data-act="fly">⌖</button><button class="btn sm ${app.traces.has(i.hex) ? 'on' : ''}" data-act="trace">trace</button><button class="btn sm bad" data-act="rm">✕</button></div></div></div>`; }).join('') || '<div class="empty">Empty list.</div>'}
  <h3>Add aircraft</h3><div class="row"><input id="addL" class="grow" placeholder="N-number or hex"><button class="btn pri" id="addLBtn">Add</button></div><div class="row" style="margin-top:6px"><button class="btn sm" id="addSel">+ selected aircraft</button></div><div class="st" id="addMsg"></div>
  <h3>Import shared list</h3><div class="row"><input id="impL" class="grow" placeholder="Paste a SkyDeck link or code"><button class="btn" id="impBtn">Import</button></div>
  <div class="mut" style="font-size:11px;margin-top:10px">Lists are unlimited and stored on this device. “Share URL” puts the list in the URL hash (#wl=…) — no server involved.</div>`;
}
function listsEvents() {
  const box = T('lists');
  box.addEventListener('change', e => { if (e.target.id === 'listSel') { curList = e.target.value; renderLists(); } });
  box.addEventListener('click', async e => {
    const L = state.watchlists.find(l => l.id === curList), id = e.target.id;
    if (id === 'newList') { const n = prompt('List name?', 'New list'); if (n) { const l = { id: 'l' + Date.now().toString(36), name: n.slice(0, 60), items: [] }; state.watchlists.push(l); curList = l.id; save('watchlists'); renderLists(); } }
    else if (id === 'renList') { const n = prompt('Rename list', L.name); if (n) { L.name = n.slice(0, 60); save('watchlists'); renderLists(); renderPlanes(); } }
    else if (id === 'delList') { if (confirm(`Delete list “${L.name}”?`)) { state.watchlists = state.watchlists.filter(l => l !== L); save('watchlists'); app.onListsChanged(); } }
    else if (id === 'shareList') { const u = location.origin + location.pathname + '#wl=' + encodeList(L); try { await navigator.clipboard.writeText(u); toast('Share link copied (' + L.items.length + ' aircraft)'); } catch { prompt('Copy this link', u); } history.replaceState(null, '', '#wl=' + encodeList(L)); }
    else if (id === 'traceList') { for (const i of L.items) app.toggleTrace(i.hex, i.reg, true); }
    else if (id === 'addLBtn') { if (await addPlane(curList, $('#addL').value)) renderLists(); }
    else if (id === 'addSel') { const a = app.traffic.get(app.traffic.sel); if (!a) return toast('Select an aircraft on the globe first.', 'warn'); if (!L.items.some(i => i.hex === a.hex)) { L.items.push({ hex: a.hex, reg: a.reg, label: a.type }); save('watchlists'); app.onListsChanged(); } }
    else if (id === 'impBtn') { const v = $('#impL').value.trim(); const code = v.includes('wl=') ? v.split('wl=')[1] : v; app.importList(code); }
    const b = e.target.closest('[data-act]'), card = e.target.closest('[data-hex]'); if (b && card) { const it = L.items.find(i => i.hex === card.dataset.hex); handleAct(b.dataset.act, card.dataset.hex, it, L); renderLists(); }
  });
  box.addEventListener('keydown', async e => { if (e.key === 'Enter' && e.target.id === 'addL') { if (await addPlane(curList, e.target.value)) renderLists(); } });
}
// ================= Layers =================
function chk(id, label, on = false, extra = '') { return `<label class="chk"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}>${label}</label>${extra}`; }
export function renderLayers() {
  const s = state.settings, h = home();
  T('layers').innerHTML = `<h3>Map</h3><div class="row"><select id="basemap" class="grow">${Object.entries(BASEMAPS).map(([k, b]) => `<option value="${k}" ${s.basemap === k ? 'selected' : ''}>${b.name}</option>`).join('')}</select></div>
  ${chk('terrainChk', '3D terrain (AWS Terrain Tiles, no token)', s.terrain)}
  <div class="row"><span class="mut">Earth detail</span><select id="qualSel" class="grow">${[['auto', 'Auto (phones lighter)'], ['high', 'High (max imagery / terrain)'], ['low', 'Low (battery saver)']].map(([k, n]) => `<option value="${k}" ${(s.quality || 'auto') === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
  ${chk('sunChk', 'Sun lighting, day/night + night lights', s.sunLight ?? false)}${chk('bldChk', '3D buildings (OSM footprints, low altitude)', buildings.on)}<div class="st" id="st-bld"></div>
  <h3>Traffic</h3>${chk('cCom', `<span style="color:${COLORS.com}">●</span> Commercial`, true)}${chk('cPvt', `<span style="color:${COLORS.pvt}">●</span> Private / GA`, true)}${chk('cMil', `<span style="color:${COLORS.mil}">●</span> Military`, true)}${chk('cMsk', `<span style="color:${COLORS.masked}">●</span> Masked (PIA / LADD)`, true)}
  ${chk('colAlt', 'Colour by altitude', s.colorBy === 'alt')}${chk('lblChk', 'Labels (level-of-detail)', s.labels)}${chk('fwdAll', 'Forward markers for all airborne traffic (nearest 300)', s.fwdAll)}
  <h3>Home & radius</h3><div class="row"><select id="homeSel" class="grow">${state.homes.map((x, i) => `<option value="${i}" ${i === state.homeIdx ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><button class="btn sm bad" id="homeDel">✕</button></div>
  <div class="row" style="margin-top:6px"><input id="homeAp" class="grow" placeholder="Add airport (KPAH, PAH, KHNB…)"><button class="btn" id="homeAdd">Add</button><button class="btn" id="homeView" title="Save current view centre">View</button></div><div class="st" id="homeMsg"></div>
  <div class="row"><span class="mut">Radius</span><input id="radius" type="range" min="10" max="250" step="5" value="${s.radiusNm}" class="grow"><output id="radiusOut">${s.radiusNm} nm</output></div>${chk('followView', 'Follow view (query around the camera instead of home)', s.followView)}
  <div class="row"><span class="mut">Refresh</span><select id="refSec">${[10, 12, 15, 20, 30, 60].map(v => `<option ${v == s.refreshSec ? 'selected' : ''}>${v}</option>`).join('')}</select><span class="mut">seconds</span></div>
  <h3>Aviation</h3>${chk('aspChk', 'Airspace — Class B / C / D (3D)', airspace.on)}<div class="st" id="st-airspace"></div>${chk('apChk', 'Runways, heliports & airports (US)', airports.on)}<div class="st" id="st-airports"></div>${chk('metChk', 'METAR flight-category dots (VFR / MVFR / IFR / LIFR)', app.metars?.on)}<div class="st" id="st-metar"></div>
  <h3>Weather</h3>${chk('radChk', 'Animated radar', radar.on)}<div class="row" style="margin-left:24px"><select id="radSrc"><option value="rainviewer">RainViewer (global)</option><option value="iem" ${radar.src === 'iem' ? 'selected' : ''}>IEM NEXRAD (US)</option></select><input id="radA" type="range" min="0.2" max="1" step="0.1" value="${radar.alpha}" style="width:80px"></div><div class="st" id="st-radar"></div>
  ${chk('tfrChk', '3D TFRs', tfr.on)}<div class="st" id="st-tfr"></div>${chk('wxChk', '3D AIRMETs / SIGMETs', wx.on)}<div class="st" id="st-wx"></div>
  <h3>Voice & notifications</h3>${chk('voice', 'Voice alerts (browser speech synthesis)', s.voice)}
  <div class="mut" style="font-size:11px;margin-top:8px">Altitudes are drawn as MSL on a terrain mesh that treats MSL as height (no geoid correction). Airspace floors given as AGL are drawn as MSL.</div>`;
  for (const k in status) showStatus(k, status[k].ok, status[k].msg);
}
function showStatus(k, ok, msg) { const e = $('#st-' + k); if (e) { e.textContent = msg; e.className = 'st' + (ok ? '' : ' bad'); } }
document.addEventListener('layerstatus', e => showStatus(e.detail.k, e.detail.ok, e.detail.msg));
function layersEvents() {
  const box = T('layers'), s = state.settings;
  box.addEventListener('change', async e => {
    const id = e.target.id, v = e.target.type === 'checkbox' ? e.target.checked : e.target.value, t = app.traffic;
    if (id === 'qualSel') { s.quality = v; save('settings'); applyQuality(); buildings.rebuild(); } else if (id === 'sunChk') { s.sunLight = v; save('settings'); applyLighting(); } else if (id === 'bldChk') buildings.toggle(v);
    else if (id === 'basemap') setBasemap(v); else if (id === 'terrainChk') { setTerrain(v); app.traces.redrawAll(); }
    else if (id === 'cCom') t.visible.com = v; else if (id === 'cPvt') t.visible.pvt = v; else if (id === 'cMil') t.visible.mil = v; else if (id === 'cMsk') t.visible.masked = v;
    else if (id === 'colAlt') { s.colorBy = v ? 'alt' : 'cat'; save('settings'); t.setWatch(t.watch); } else if (id === 'lblChk') { s.labels = v; save('settings'); } else if (id === 'fwdAll') { s.fwdAll = v; save('settings'); }
    else if (id === 'homeSel') { state.homeIdx = +v; save('homeIdx'); app.goHome(); } else if (id === 'followView') { s.followView = v; save('settings'); app.pollNow(); } else if (id === 'refSec') { s.refreshSec = +v; save('settings'); }
    else if (id === 'aspChk') airspace.toggle(v); else if (id === 'apChk') airports.toggle(v); else if (id === 'metChk') app.metars?.toggle(v); else if (id === 'radChk') radar.toggle(v); else if (id === 'tfrChk') tfr.toggle(v); else if (id === 'wxChk') wx.toggle(v);
    else if (id === 'radSrc') { radar.src = v; if (radar.on) radar.load(); } else if (id === 'voice') { s.voice = v; save('settings'); if (v) { try { speechSynthesis.speak(new SpeechSynthesisUtterance('Voice alerts on')); } catch {} } }
    if (['cCom', 'cPvt', 'cMil', 'cMsk'].includes(id)) for (const r of t.recs.values()) t.style(r);
  });
  box.addEventListener('input', e => { if (e.target.id === 'radius') { s.radiusNm = +e.target.value; $('#radiusOut').textContent = s.radiusNm + ' nm'; save('settings'); debounce(() => app.pollNow(), 600)(); } if (e.target.id === 'radA') { radar.alpha = +e.target.value; if (radar.layers[radar.idx]) radar.layers[radar.idx].alpha = radar.alpha; } });
  box.addEventListener('click', async e => {
    if (e.target.id === 'homeDel') { if (state.homes.length > 1) { state.homes.splice(state.homeIdx, 1); state.homeIdx = 0; save('homes'); save('homeIdx'); renderLayers(); } }
    if (e.target.id === 'homeView') { const c = cameraInfo().ctr; if (!c) return; const n = prompt('Name this home location', 'View ' + c.lat.toFixed(2) + ',' + c.lon.toFixed(2)); if (n) { state.homes.push({ name: n, lat: c.lat, lon: c.lon }); state.homeIdx = state.homes.length - 1; save('homes'); save('homeIdx'); renderLayers(); app.pollNow(); } }
    if (e.target.id === 'homeAdd') { const q = $('#homeAp').value.trim(); if (!q) return; try { const r = await airportByIdent(q); if (!r.length) { $('#homeMsg').textContent = 'No FAA airport matched “' + q + '” (US airports only).'; $('#homeMsg').className = 'st bad'; return; } const a = r[0]; state.homes.push({ name: `${a.ICAO_ID || a.IDENT} ${a.NAME}`, lat: a.LATITUDE, lon: a.LONGITUDE }); state.homeIdx = state.homes.length - 1; save('homes'); save('homeIdx'); renderLayers(); app.goHome(); } catch (err) { $('#homeMsg').textContent = 'FAA AIS lookup failed: ' + err.message; $('#homeMsg').className = 'st bad'; } }
  });
}
// ================= Alerts =================
export function renderAlerts() {
  const A = state.watchAlerts; const fences = state.geofences;
  T('alerts').innerHTML = `<h3>Geofences</h3><div class="row"><button class="btn pri" id="gfDraw">✏️ Draw on globe</button><button class="btn" id="gfHome">○ Around home</button><button class="btn" id="gfSel">○ Around selected</button></div><div class="mut" style="font-size:11px;margin:6px 0">Draw: click the centre, then click again to set the radius.</div>
  ${fences.map(f => `<div class="card" data-gf="${f.id}"><div class="row sp"><input data-f="name" value="${esc(f.name)}" class="grow"><label class="chk"><input type="checkbox" data-f="enabled" ${f.enabled !== false ? 'checked' : ''}>on</label></div><div class="row" style="margin-top:6px"><span class="mut">r</span><input data-f="rNm" type="number" min="0.5" max="500" step="0.5" value="${f.rNm}" style="width:70px">nm<span class="mut">≤</span><input data-f="maxAlt" type="number" min="0" step="500" value="${f.maxAlt || ''}" placeholder="any ft" style="width:80px"><label class="chk"><input type="checkbox" data-f="exit" ${f.exit ? 'checked' : ''}>exit</label><button class="btn sm" data-gfa="fly">⌖</button><button class="btn sm bad" data-gfa="rm">✕</button></div></div>`).join('') || '<div class="empty">No geofences. Alerts fire when any aircraft in view of the app enters one.</div>'}
  <h3>Watchlist alerts</h3><label class="chk"><input type="checkbox" id="waA" ${A.appear ? 'checked' : ''}>Aircraft appears on ADS-B</label><label class="chk"><input type="checkbox" id="waT" ${A.takeoff ? 'checked' : ''}>Takes off</label><label class="chk"><input type="checkbox" id="waL" ${A.land ? 'checked' : ''}>Lands</label>
  <div class="row" style="margin-top:6px"><button class="btn sm" id="notifBtn">Enable browser notifications</button></div>
  <div class="mut" style="font-size:11px;margin:6px 0">Alerts are evaluated in this browser while SkyDeck is open (no server push). Landing is detected from the ground flag, or presumed when a low, slow aircraft drops off coverage.</div>
  <h3>Alert log <button class="btn sm" id="logExp" style="float:right">Export</button><button class="btn sm bad" id="logClr" style="float:right;margin-right:4px">Clear</button></h3><div id="alertLog"></div>`;
  renderLog();
}
function renderLog() { const b = $('#alertLog'); if (!b) return; b.innerHTML = alertLog.length ? `<table>${alertLog.slice(0, 120).map(e => `<tr class="click" data-lat="${e.lat ?? ''}" data-lon="${e.lon ?? ''}" data-hex="${e.hex || ''}"><td class="mono mut" style="white-space:nowrap">${new Date(e.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td><td>${esc(e.text)}</td></tr>`).join('')}</table>` : '<div class="empty">No alerts yet.</div>'; }
document.addEventListener('alertlog', renderLog);
function alertsEvents() {
  const box = T('alerts');
  box.addEventListener('click', e => {
    if (e.target.id === 'gfDraw') app.startDraw(); else if (e.target.id === 'gfHome') { const h = home(); app.addFence({ name: 'Home ' + h.name, lat: h.lat, lon: h.lon, rNm: 10 }); }
    else if (e.target.id === 'gfSel') { const p = app.traffic.position(app.traffic.sel); if (!p) return toast('Select an aircraft first.', 'warn'); app.addFence({ name: 'Around ' + (app.traffic.get(app.traffic.sel).reg || app.traffic.sel), lat: p[0], lon: p[1], rNm: 5 }); }
    else if (e.target.id === 'logClr') clearLog(); else if (e.target.id === 'logExp') { download('skydeck-alerts.json', JSON.stringify(alertLog, null, 2), 'application/json'); }
    else if (e.target.id === 'notifBtn') { Notification.requestPermission().then(p => toast('Notifications: ' + p)); }
    const row = e.target.closest('#alertLog tr'); if (row && row.dataset.lat) flyTo(+row.dataset.lat, +row.dataset.lon, 30000);
    const card = e.target.closest('[data-gf]'), ga = e.target.dataset.gfa; if (card && ga) { const f = state.geofences.find(x => x.id === card.dataset.gf); if (ga === 'rm') { state.geofences = state.geofences.filter(x => x !== f); save('geofences'); app.drawFences(); renderAlerts(); } else flyTo(f.lat, f.lon, f.rNm * NM * 5); }
  });
  box.addEventListener('change', e => {
    const card = e.target.closest('[data-gf]'); if (card) { const f = state.geofences.find(x => x.id === card.dataset.gf), k = e.target.dataset.f; f[k] = e.target.type === 'checkbox' ? e.target.checked : (k === 'name' ? e.target.value : +e.target.value || 0); save('geofences'); app.drawFences(); app.alerts.inside.delete(f.id); app.alerts.primed.delete(f.id); return; }
    const m = { waA: 'appear', waT: 'takeoff', waL: 'land' }[e.target.id]; if (m) { state.watchAlerts[m] = e.target.checked; save('watchAlerts'); }
  });
}
// ================= Reports =================
let lastReport = null;
export function renderReports() {
  const w = [...allWatched().values()], to = dayStr(Date.now()), from = dayStr(Date.now() - 6 * 86400000);
  T('reports').innerHTML = `<h3>Flight history & operations</h3>${w.map(i => `<label class="chk"><input type="checkbox" class="rp" value="${i.hex}" ${state.watchlists.find(l => l.id === 'mine')?.items.some(x => x.hex === i.hex) ? 'checked' : ''}><b>${esc(i.reg || i.hex.toUpperCase())}</b> <span class="mut">${esc(i.label || '')}</span></label>`).join('') || '<div class="empty">Add aircraft to a list first.</div>'}
  <div class="row" style="margin-top:8px"><input type="date" id="rpFrom" value="${from}"><span class="mut">→</span><input type="date" id="rpTo" value="${to}"></div><div class="mut" style="font-size:11px;margin:4px 0">Days are UTC. Source: ADS-B Exchange daily traces via the SkyDeck proxy (best effort). Max 31 days.</div>
  <div class="row"><button class="btn pri" id="rpGo">Generate</button><button class="btn" id="rpCsvF" disabled>CSV flights</button><button class="btn" id="rpCsvO" disabled>CSV ops</button><button class="btn" id="rpJson" disabled>JSON</button></div><div class="st" id="rpMsg" style="margin-left:0"></div><div id="rpOut"></div>`;
  if (lastReport) showReport(lastReport);
}
function showReport(r) {
  const fl = r.flights, tot = r.coverage.reduce((a, c) => a + c.points, 0);
  $('#rpOut').innerHTML = `<h3>Operations summary</h3>${r.ops.length ? `<table><tr><th>Aircraft</th><th>Flts</th><th>Air time</th><th>NM</th><th>Airports</th></tr>${r.ops.map(o => `<tr><td><b>${esc(o.reg)}</b></td><td>${o.flights}</td><td>${o.air_time}</td><td>${o.distance_nm}</td><td>${esc(o.airports)}</td></tr>`).join('')}</table>` : '<div class="empty">No flights found in range.</div>'}
  <h3>Flights (${fl.length})</h3>${fl.length ? `<table><tr><th>Date</th><th>Aircraft</th><th>From → To</th><th>Time</th></tr>${fl.map((f, i) => `<tr class="click" data-fi="${i}"><td class="mono">${f.day.slice(5)}</td><td>${esc(f.reg)}</td><td>${esc(f.dep.startsWith('n/a') ? '?' : f.dep)} → ${esc(f.arr.startsWith('n/a') ? '?' : f.arr)}${f.complete ? '' : ' <span class="mut" title="start/end not observed on the ground">◐</span>'}</td><td class="mono">${f.duration} · ${f.distance_nm} nm</td></tr>`).join('')}</table><div class="mut" style="font-size:11px;margin-top:4px">Click a flight to replay it. ◐ = takeoff or landing not observed (coverage gap).</div>` : ''}
  <div class="mut" style="font-size:11px;margin-top:8px">Coverage: ${tot.toLocaleString()} trace points over ${r.days.length} day(s). ${r.coverage.filter(c => c.error).length ? '<span style="color:var(--bad)">' + r.coverage.filter(c => c.error).length + ' day-requests failed.</span>' : ''}</div>`;
  for (const id of ['rpCsvF', 'rpCsvO', 'rpJson']) $('#' + id).disabled = false;
}
function reportsEvents() {
  const box = T('reports');
  box.addEventListener('click', async e => {
    if (e.target.id === 'rpGo') {
      const sel = $$('.rp:checked').map(c => allWatched().get(c.value)); if (!sel.length) return toast('Select at least one aircraft', 'warn'); const msg = $('#rpMsg'); e.target.disabled = true;
      try { lastReport = await buildReport(sel, $('#rpFrom').value, $('#rpTo').value, p => msg.textContent = `Fetching history… ${Math.round(p * 100)}%`); msg.textContent = `Done — ${lastReport.flights.length} flights.`; showReport(lastReport); }
      catch (err) { msg.textContent = err.message.includes('proxy') ? 'Reports need the SkyDeck proxy (ADS-B Exchange history has no CORS).' : 'Report failed: ' + err.message; msg.className = 'st bad'; } e.target.disabled = false;
    }
    else if (e.target.id === 'rpCsvF') exportCSV(lastReport, 'flights'); else if (e.target.id === 'rpCsvO') exportCSV(lastReport, 'ops'); else if (e.target.id === 'rpJson') exportJSON(lastReport);
    const row = e.target.closest('[data-fi]'); if (row) { const f = lastReport.flights[+row.dataset.fi]; app.replay.startFlight(f.hex, f._pts, f.reg + ' ' + f.day); app.openTab('time'); }
  });
}
// ================= Replay / Time Travel =================
let legs = [], legHex = null;
export function renderTime() {
  const w = [...allWatched().values()], tgt = app.traffic.sel || w[0]?.hex; const today = new Date(); const ld = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  T('time').innerHTML = `<h3>Per-flight replay</h3><div class="row"><select id="rpAc" class="grow">${w.map(i => `<option value="${i.hex}" ${i.hex === tgt ? 'selected' : ''}>${esc(i.reg || i.hex.toUpperCase())} ${esc(i.label || '')}</option>`).join('')}</select><button class="btn" id="legGo">Find flights</button></div><div class="st" id="legMsg" style="margin-left:0">Loads the last 24 h of ADS-B history and splits it into flights.</div><div id="legs"></div>
  <h3>Time Travel (tracked aircraft)</h3><div class="row"><input type="date" id="ttDate" value="${ld}" max="${ld}" class="grow"><button class="btn pri" id="ttGo">Travel</button></div><div class="mut" style="font-size:11px;margin:5px 0">Replays where your watchlisted aircraft were on a past day (ADS-B Exchange history). Worldwide historical traffic is not available from free sources.</div><div id="ttList"></div>
  <div class="row"><button class="btn" id="ttBack">↩ Back to live</button></div>`;
  showLegs();
}
function showLegs() { const b = $('#legs'); if (!b) return; b.innerHTML = legs.length ? `<table><tr><th>Takeoff (local)</th><th>Dur</th><th>Max alt</th></tr>${legs.map((f, i) => `<tr class="click" data-leg="${i}"><td>${new Date(f.pts[0].t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${f.start === 'ground' ? '' : ' ◐'}</td><td class="mono">${fmtDur((f.pts[f.pts.length - 1].t - f.pts[0].t) / 1000)}</td><td class="mono">${fmtAlt(Math.max(...f.pts.map(p => p.alt || 0)))}</td></tr>`).join('')}</table>` : ''; }
function timeEvents() {
  const box = T('time');
  box.addEventListener('click', async e => {
    if (e.target.id === 'legGo') { const hex = $('#rpAc').value; legHex = hex; const m = $('#legMsg'); m.textContent = 'Loading…'; m.className = 'st'; try { const r = await trace24h(hex); legs = segmentFlights(r.pts); m.textContent = legs.length ? `${legs.length} flight(s) in the last 24 h — click one to replay.` : (r.pts.length ? 'Trace found but no complete flight detected.' : 'No history returned for this aircraft in the last 24 h (not flown, or source/proxy unavailable).'); if (!legs.length) m.className = 'st bad'; showLegs(); } catch (err) { m.textContent = err.message.includes('proxy') ? 'Replay needs the SkyDeck proxy.' : 'Failed: ' + err.message; m.className = 'st bad'; } }
    const leg = e.target.closest('[data-leg]'); if (leg) { const f = legs[+leg.dataset.leg]; const it = allWatched().get(legHex); app.replay.startFlight(legHex, f.pts, it?.reg || legHex); }
    if (e.target.id === 'ttGo') { const w = [...allWatched().values()]; const ok = await app.replay.startTravel(w, $('#ttDate').value); const L = $('#ttList'); if (L) { const R = app.replay; const hs = ok ? w.filter(h => R.tracks.has(h.hex)) : []; L.innerHTML = hs.length ? `<div class="mut" style="font-size:11px;margin:4px 0">Tap a plane on the globe, or:</div>${hs.map(h => `<div class="row sp" style="margin:4px 0"><b>${esc(h.reg || h.hex.toUpperCase())}</b><button class="btn sm pri" data-ttc="${h.hex}">Chase / 3D replay</button></div>`).join('')}` : ''; } if (ok) toast('Tap a tracked plane (or CHASE / 3D) to replay its flight in 3D with the chase cam.', 'info', 6000); }
    const ttc = e.target.closest('[data-ttc]'); if (ttc) { if (app.replay.mode !== 'travel') return toast('Start Time Travel first.', 'warn'); app.chaseTravel(ttc.dataset.ttc); }
    if (e.target.id === 'ttBack') app.replay.stop();
  });
}
// ================= Mil-Ops =================
export function renderMil() {
  const list = app.traffic.all().filter(a => a.mil).sort((a, b) => (a.fl || a.hex).localeCompare(b.fl || b.hex));
  const box = T('mil'); if (!box.classList.contains('on') && box.dataset.done && app.milKey === list.length) return; app.milKey = list.length; box.dataset.done = 1;
  box.innerHTML = `<div class="row sp"><h3 style="margin:0">Military traffic</h3><span class="mut">${list.length} aircraft${state.settings.mode === 'mil' ? ' worldwide' : ' in range'}</span></div>
  ${state.settings.mode === 'mil' ? '' : '<div class="mut" style="margin:6px 0">Switch to <b>Mil-Ops</b> (top bar) to load all military traffic worldwide.</div>'}
  ${list.length ? `<table><tr><th>Callsign</th><th>Type</th><th>Alt</th><th>kt</th></tr>${list.slice(0, 400).map(a => `<tr class="click" data-hex="${a.hex}"><td><b>${esc(a.fl || a.hex.toUpperCase())}</b><br><small class="mut">${esc(a.reg)}</small></td><td>${esc(a.type)}</td><td class="mono">${a.gnd ? 'GND' : fmtAlt(a.alt)}</td><td class="mono">${Math.round(a.gs)}</td></tr>`).join('')}</table>${list.length > 400 ? '<div class="mut">Showing first 400 of ' + list.length + '</div>' : ''}` : '<div class="empty">No military aircraft received right now.</div>'}`;
}
function milEvents() { T('mil').addEventListener('click', e => { const r = e.target.closest('[data-hex]'); if (r) app.focus(r.dataset.hex); }); }
// ================= selected aircraft panel + hover HUD =================
export function showHover(a, x, y) {
  const h = $('#hud'); if (!a) { h.hidden = true; return; } const hm = home(); const d = distM(hm.lat, hm.lon, a.lat, a.lon) / NM;
  h.innerHTML = `<div class="row sp"><b class="big">${esc(a.fl || a.reg || a.hex.toUpperCase())}</b><span>${a.mil ? '<span class="chip mil">MIL</span>' : a.masked ? '<span class="chip msk">MASKED</span>' : ''}</span></div><div class="mut">${esc(a.reg)} ${esc(a.type)} ${esc(a.desc)}</div>
  <div class="kv mono"><span>ALT</span><span>${a.gnd ? 'GND' : fmtAlt(a.alt)} ${a.vr ? `<small>${a.vr > 0 ? '▲' : '▼'}${Math.abs(Math.round(a.vr))}</small>` : ''}</span><span>GS / Trk</span><span>${Math.round(a.gs)} kt / ${String(Math.round(a.trk)).padStart(3, '0')}°</span><span>SQK</span><span>${esc(a.sqk || '—')}${a.emg ? ' <b style="color:var(--bad)">' + esc(a.emg) + '</b>' : ''}</span><span>Hex</span><span>${a.hex.toUpperCase()}</span><span>DIST HOME</span><span>${d.toFixed(0)} nm</span></div>`;
  h.hidden = false; const r = h.getBoundingClientRect(); h.style.left = Math.min(innerWidth - r.width - 8, x + 16) + 'px'; h.style.top = Math.min(innerHeight - r.height - 8, y + 16) + 'px';
}
export function showHoverText(t, x, y) { const h = $('#hud'); if (!t) { h.hidden = true; return; } h.innerHTML = `<div>${esc(t)}</div>`; h.hidden = false; const r = h.getBoundingClientRect(); h.style.left = Math.min(innerWidth - r.width - 8, x + 16) + 'px'; h.style.top = Math.min(innerHeight - r.height - 8, y + 16) + 'px'; }
let selInfoHex = null, selInfo = null, selOpen = false;
export async function renderSel() {
  const hex = app.traffic.sel, box = $('#sel'); if (!hex) { box.hidden = true; document.body.classList.remove('has-sel'); selOpen = false; return; } const a = app.traffic.get(hex); if (!a) { box.hidden = true; document.body.classList.remove('has-sel'); return; }
  if (selInfoHex !== hex) { selInfoHex = hex; selInfo = null; hexInfo(hex).then(i => { selInfo = i; if (app.traffic.sel === hex) renderSel(); }); }
  const watched = allWatched().has(hex), hm = home(), d = distM(hm.lat, hm.lon, a.lat, a.lon) / NM, info = selInfo;
  box.innerHTML = `<div class="row sp"><div><span class="big">${esc(a.fl || a.reg || a.hex.toUpperCase())}</span> ${a.mil ? '<span class="chip mil">MIL</span>' : ''}${a.masked ? '<span class="chip msk">MASKED</span>' : ''}</div><button class="btn sm" data-s="close">✕</button></div>
  <div class="mut">${esc([a.reg, a.type].filter(Boolean).join(' · '))}${info ? ' · ' + esc([info.Manufacturer, info.Type].filter(Boolean).join(' ')) : ''}</div>${info?.RegisteredOwners ? `<div class="mut">Owner: ${esc(info.RegisteredOwners)}</div>` : a.ownOp ? `<div class="mut">${esc(a.ownOp)}</div>` : ''}
  <div class="kv mono"><span>ALT</span><span>${a.gnd ? 'GND' : fmtAlt(a.alt)}</span><span>VS</span><span>${a.gnd ? '—' : (a.vr > 0 ? '▲ ' : a.vr < 0 ? '▼ ' : '') + Math.abs(Math.round(a.vr || 0)).toLocaleString() + ' fpm'}</span><span>GS</span><span>${Math.round(a.gs)} kt</span><span>HDG</span><span>${String(Math.round(a.trk)).padStart(3, '0')}°</span><span>SQK</span><span>${esc(a.sqk || '—')}${a.emg ? ' · ' + esc(a.emg) : ''}</span><span>POS</span><span>${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}</span><span>DIST HOME</span><span>${d.toFixed(1)} nm</span><span>Hex</span><span>${a.hex.toUpperCase()}</span><span>Updated</span><span>${fmtAge((Date.now() - a.t) / 1000)}${a.mlat ? ' · MLAT' : ''}</span></div>
  <div class="row act"><button class="btn sm ${app.traces.has(hex) ? 'on' : ''}" data-s="trace">24 h trace</button><button class="btn sm" data-s="chase">Chase cam</button><button class="btn sm" data-s="replay">Last flight ▶</button><button class="btn sm" data-s="fly">Fly to</button><button class="btn sm ${watched ? 'on' : ''}" data-s="watch">${watched ? '★ Watching' : '☆ Watch'}</button><button class="btn sm" data-s="geo">Geofence</button></div>
  <div class="row" style="margin-top:6px"><a class="btn sm" target="_blank" rel="noopener" href="https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${encodeURIComponent(a.reg)}" ${/^N/.test(a.reg) ? '' : 'hidden'}>FAA registry ↗</a><a class="btn sm" target="_blank" rel="noopener" href="https://globe.adsbexchange.com/?icao=${a.hex}">ADSBx ↗</a></div>`;
  if (app.isMobile) {
    const full = box.innerHTML, alt = a.gnd ? 'GND' : fmtAlt(a.alt), strip = `<div class="sel-strip"><b>${esc(a.fl || a.reg || a.hex.toUpperCase())}</b><span class="t">${esc(alt)} · ${Math.round(a.gs)}KT</span><button class="btn sm ${app.traces.has(hex) ? 'on' : ''}" data-s="trace" aria-label="24h trace">TRC</button><button class="btn sm ${selOpen ? 'on' : ''}" data-s="more" aria-label="Details">${selOpen ? '▾' : '⋯'}</button><button class="btn sm" data-s="close" aria-label="Close">✕</button></div>`;
    box.innerHTML = strip + '<div class="sel-more">' + full + '</div>'; box.classList.toggle('open', selOpen);
  } else box.classList.remove('open');
  document.body.classList.add('has-sel'); box.hidden = false;
}
function selEvents() {
  $('#sel').addEventListener('click', e => {
    const k = e.target.dataset.s, hex = app.traffic.sel; if (!k || !hex) return; const a = app.traffic.get(hex);
    if (k === 'more') { selOpen = !selOpen; renderSel(); return; } if (k === 'close') app.select(null); else if (k === 'trace') { app.toggleTrace(hex, a?.reg); setTimeout(renderSel, 50); } else if (k === 'chase') app.replay.startLiveChase(hex); else if (k === 'replay') app.replayLast(hex, a?.reg);
    else if (k === 'fly') flyTo(a.lat, a.lon, a.gnd ? 5000 : 30000, { pitch: -45 });
    else if (k === 'watch') { const L = state.watchlists.find(l => l.id === 'mine') || state.watchlists[0]; if (allWatched().has(hex)) { for (const l of state.watchlists) l.items = l.items.filter(i => i.hex !== hex); } else L.items.push({ hex, reg: a.reg, label: a.type }); save('watchlists'); app.onListsChanged(); renderSel(); }
    else if (k === 'geo') app.addFence({ name: 'Around ' + (a.reg || a.fl || hex), lat: a.lat, lon: a.lon, rNm: 5 });
  });
}
// ================= replay bar =================
export function renderReplayBar() {
  const R = app.replay, b = $('#replaybar'); document.body.classList.toggle('replaying', !!R.active); if (!R.active) { b.hidden = true; return; }
  if (b.hidden || !b.dataset.mode || b.dataset.mode !== R.mode) { b.dataset.mode = R.mode; b.hidden = false; b.innerHTML = `<button class="btn" id="rbPlay">▶</button><input id="rbScrub" type="range" min="0" max="1000" value="0"><span id="rbTime" class="mono" style="min-width:170px;text-align:right"></span><select id="rbSpeed">${[1, 5, 15, 30, 60, 120, 300, 600].map(v => `<option value="${v}" ${v === R.speed ? 'selected' : ''}>${v}×</option>`).join('')}</select>${R.mode === 'flight' ? '<button class="btn" id="rbChase">Chase cam</button><span class="rb-x"><button class="btn sm" id="rbTko" title="Skip to takeoff">⇤ TKOF</button><button class="btn sm" id="rbLdg" title="Skip to landing">LDG ⇥</button><button class="btn sm" id="rbShare" title="Share a link to this replay">Share</button></span>' : R.mode === 'travel' ? '<button class="btn" id="rbTTChase">Chase / 3D</button>' : ''}<button class="btn bad" id="rbExit">Exit</button>`; }
  $('#rbPlay').textContent = R.playing ? '⏸' : '▶'; const s = $('#rbScrub'); if (document.activeElement !== s) s.value = Math.round((R.clock - R.t0) / Math.max(1, R.t1 - R.t0) * 1000);
  const c = R.cur; const lab = R.mode === 'flight' ? `${R.label}  ` : 'Time Travel  '; $('#rbTime').textContent = new Date(R.clock).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + (R.mode === 'flight' && c ? `  ${c.gnd ? 'GND' : Math.round(c.alt).toLocaleString() + ' ft'} ${Math.round(c.gs)} kt` + (c.est ? '  ≈ interpolated (data gap)' : '') : ''); { const pi = R.pathInfo; $('#rbTime').title = pi ? `Smoothed path: ${pi.raw} raw fixes → ${pi.cleaned} after cleaning (${pi.dupes} duplicates, ${pi.posOutliers} position / ${pi.altOutliers} altitude outliers removed), resampled at ${pi.hz} Hz; altitude source: ${pi.altSrc}; ${pi.estPct}% of the time is interpolated across reporting gaps (max gap ${Math.round(pi.maxGapS)} s). Heading, pitch and bank are derived from the smoothed path, not reported.` : ''; }
  const ch = $('#rbChase'); if (ch) ch.classList.toggle('on', R.chase);
}
function replayEvents() {
  const b = $('#replaybar'); b.addEventListener('click', e => { const R = app.replay; if (e.target.id === 'rbPlay') R.toggle(); else if (e.target.id === 'rbExit') R.stop(); else if (e.target.id === 'rbTTChase') app.travelPick(); else if (e.target.id === 'rbTko') R.skipTo('tko'); else if (e.target.id === 'rbLdg') R.skipTo('ldg'); else if (e.target.id === 'rbShare') app.shareReplay(); else if (e.target.id === 'rbChase') { R.chase ? R.endChase() : R.startChase(); renderReplayBar(); } });
  b.addEventListener('input', e => { const R = app.replay; if (e.target.id === 'rbScrub') R.seek(R.t0 + e.target.value / 1000 * (R.t1 - R.t0)); });
  b.addEventListener('change', e => { if (e.target.id === 'rbSpeed') app.replay.setSpeed(+e.target.value); });
  document.addEventListener('replayui', renderReplayBar);
}
// ================= tabs / init =================
export function openTab(id, _auto) { if (id === 'plan') app.plan?.enter(); $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === id)); $$('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + id)); $('#side').classList.remove('hide'); document.body.classList.remove('sidehidden'); if (app.isMobile && app.setSheet && document.body.dataset.sheet === 'peek' && !document.body.classList.contains('landscape') && arguments[1] !== false) app.setSheet('half'); else if (app.isMobile && document.body.classList.contains('landscape') && app.setSheet) app.setSheet('half'); if (id === 'mil') renderMil(); if (id === 'time') renderTime(); if (id === 'reports') renderReports(); if (id === 'jb') renderJB(); }
app.openTab = openTab;
export function initUI() {
  initJB();
  $('#tabs').addEventListener('click', e => { const t = e.target.closest('[data-tab]')?.dataset.tab; if (t) openTab(t); });
  $('#menuBtn').addEventListener('click', () => { if (app.isMobile) return app.toggleSheet(); $('#side').classList.toggle('hide'); document.body.classList.toggle('sidehidden', $('#side').classList.contains('hide')); });
  renderPlanes(); renderLists(); renderLayers(); renderAlerts(); renderReports(); renderTime(); renderMil();
  planesEvents(); listsEvents(); layersEvents(); alertsEvents(); reportsEvents(); timeEvents(); milEvents(); selEvents(); replayEvents();
  $('#exag').addEventListener('input', e => { const v = +e.target.value; $('#exagOut').textContent = v + '×'; setExag(v); app.exagChanged(); });
  $('#exag').value = state.settings.exag; $('#exagOut').textContent = state.settings.exag + '×';
}
