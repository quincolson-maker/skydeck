// "Near me": opt-in browser geolocation. The position never leaves the device except as a coarse (0.1°, ~6 nm) query
// centre sent to SkyDeck's own proxy, which snaps it further to a 0.25° grid before asking the ADS-B sources.
// settings.loc: undefined = not asked yet (show a soft prompt), 'on' = locate on every open, 'off' = user said no.
import { app } from './app.js';
import { state, save } from './store.js';
import * as G from './globe.js';
import { $, toast } from './util.js';
const Cesium = window.Cesium;
export const me = { pos: null, watch: null, ent: null, ring: null, busy: false };
export const geoOK = () => 'geolocation' in navigator && window.isSecureContext;
const iOS = /iP(hone|ad|od)/.test(navigator.platform) || (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
const HELP = iOS ? 'Location is blocked. On iPhone: Settings › Privacy & Security › Location Services › Safari Websites → While Using (then reload SkyDeck).'
  : 'Location is blocked for this site. Allow it from the lock/site icon in the address bar, then tap ◎ again.';
function mark() {
  const p = me.pos; if (!p) return; const pos = Cesium.Cartesian3.fromDegrees(p.lon, p.lat);
  if (!me.ent) {
    me.ent = app.viewer.entities.add({ id: 'me:you', position: pos, point: { pixelSize: 11, color: Cesium.Color.fromCssColorString('#3d9bff'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2.5, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    me.ring = app.viewer.entities.add({ id: 'me:acc', position: pos, ellipse: { semiMajorAxis: 1, semiMinorAxis: 1, material: Cesium.Color.fromCssColorString('#3d9bff').withAlpha(0.12), outline: false, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } });
  }
  me.ent.position = pos; me.ring.position = pos; const a = Math.min(Math.max(p.acc || 0, 30), 20000);
  me.ring.ellipse.semiMajorAxis = a; me.ring.ellipse.semiMinorAxis = a; me.ring.show = (p.acc || 0) > 60;
}
const nmBetween = (a, b) => { const r = x => x * Math.PI / 180, s = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2; return 2 * 3440.065 * Math.asin(Math.sqrt(s)); };
export function flyToMe() { if (!me.pos) return false; const r = Math.min(250, state.settings.radiusNm); G.flyTo(me.pos.lat, me.pos.lon, Math.max(140000, r * 1852 * 2.3), { pitch: -55, duration: 2.4 }); app.pollNow && app.pollNow(); return true; }
function setBtn() { const b = $('#meBtn'); if (b) { b.classList.toggle('on', !!me.pos); b.title = me.pos ? 'Centre on my location' : 'Show traffic near me (uses your location)'; } }
// fromTap: called from a user gesture (required for a reliable prompt on iPhone Safari / home-screen app)
export function locate({ fly = true, quiet = false } = {}) {
  if (!geoOK()) { if (!quiet) toast('Location needs HTTPS and a browser that supports it.', 'warn'); return Promise.resolve(false); }
  if (me.busy) return Promise.resolve(false); me.busy = true;
  return new Promise(res => navigator.geolocation.getCurrentPosition(p => {
    me.busy = false; const first = !me.pos; me.pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
    state.settings.loc = 'on'; save('settings'); mark(); setBtn(); if (fly || first) flyToMe(); else app.pollNow && app.pollNow();
    if (me.watch == null) me.watch = navigator.geolocation.watchPosition(q => { const n = { lat: q.coords.latitude, lon: q.coords.longitude, acc: q.coords.accuracy }, moved = nmBetween(me.pos, n); me.pos = n; mark(); if (moved > 5) app.pollNow && app.pollNow(); }, () => {}, { enableHighAccuracy: false, maximumAge: 120000 });
    res(true);
  }, e => {
    me.busy = false; setBtn();
    if (e.code === 1) { state.settings.loc = 'off'; save('settings'); if (!quiet) toast(HELP, 'warn', 9000); }
    else if (!quiet) toast('Could not get your location (' + (e.code === 3 ? 'timed out' : 'unavailable') + ') — showing your home area.', 'warn', 5000);
    res(false);
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }));
}
export function stop() { if (me.watch != null) navigator.geolocation.clearWatch(me.watch); me.watch = null; me.pos = null; if (me.ent) { app.viewer.entities.remove(me.ent); app.viewer.entities.remove(me.ring); me.ent = me.ring = null; } state.settings.loc = 'off'; save('settings'); setBtn(); app.pollNow && app.pollNow(); }
function ask() {
  const d = document.createElement('div'); d.id = 'locAsk'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Show traffic near you');
  d.innerHTML = `<b>Show air traffic near you?</b><div class="mut">SkyDeck can centre the map on your location and load the planes around you. Your location stays on this device — only a rough area (~6 nm) is used to pick which part of the sky to load. Nothing is saved or shared.</div><div class="row"><button class="btn pri" data-a="yes">Use my location</button><button class="btn" data-a="no">Not now</button></div>`;
  document.body.appendChild(d);
  d.addEventListener('click', async e => { const a = e.target.dataset.a; if (!a) return; d.remove(); if (a === 'yes') { if (!(await locate({ fly: true }))) app.goHome(); } else { state.settings.loc = 'off'; save('settings'); toast('OK — tap ◎ any time to show traffic near you.', 'info', 4000); } });
}
// boot: returns true if it will handle the initial camera move itself
export function initGeo() {
  const b = $('#meBtn'); if (b) { if (!geoOK()) b.hidden = true; b.addEventListener('click', () => { if (me.pos) flyToMe(); else locate({ fly: true }); }); b.addEventListener('contextmenu', e => { if (me.pos) { e.preventDefault(); stop(); toast('Location off — showing home area.'); } }); }
  if (!geoOK() || new URLSearchParams(location.search).get('view')) return false;
  const s = state.settings.loc;
  if (s === 'on') {
    const go = () => locate({ fly: true, quiet: true }).then(ok => { if (!ok) app.goHome(); });
    if (navigator.permissions?.query) navigator.permissions.query({ name: 'geolocation' }).then(p => { if (p.state === 'denied') { state.settings.loc = 'off'; save('settings'); app.goHome(); } else go(); }).catch(go); else go();
    return true;
  }
  if (s === undefined) { setTimeout(ask, 1200); return false; }
  return false;
}
// query centre + radius for the standard traffic poll
export function queryArea(home, cam, base, mobile) {
  const cap = mobile ? 150 : 250; if (cam && cam.h > 2e6) cam = null;   // whole-globe intro/zoomed-out view: stay on you/home
  const view = cam && cam.h ? Math.min(cap, Math.round(cam.h / 1852 * 0.9)) : 0;   // zoomed out → widen the circle to roughly what's on screen
  const r = Math.max(10, Math.min(cap, Math.max(base, view)));
  if (state.settings.followView && cam?.ctr) return { c: cam.ctr, r, what: 'view centre' };
  if (me.pos) {
    // panned well away from you? load traffic where you're looking instead
    if (cam?.ctr && nmBetween(me.pos, cam.ctr) > r * 0.6) return { c: cam.ctr, r, what: 'view centre' };
    return { c: { lat: +me.pos.lat.toFixed(1), lon: +me.pos.lon.toFixed(1) }, r, what: 'your location' };
  }
  if (cam?.ctr && nmBetween(home, cam.ctr) > r * 0.6) return { c: cam.ctr, r, what: 'view centre' };
  return { c: home, r, what: home.name };
}
