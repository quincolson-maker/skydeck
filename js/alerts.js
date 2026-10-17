// Pro alerts: geofence enter/exit, watchlist appear / take-off / landing, persistent log, toasts + optional voice (speechSynthesis).
import { state, save, store, allWatched } from './store.js';
import { distM, NM, toast, fmtAlt, FT } from './util.js';
export const log = store.get('alertlog', []);
export function speak(text) { if (!state.settings.voice || !('speechSynthesis' in window)) return; try { const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {} }
export function push(kind, text, extra = {}) {
  const e = { t: Date.now(), kind, text, ...extra }; log.unshift(e); log.length = Math.min(log.length, 400); store.set('alertlog', log);
  toast((kind === 'geofence' ? '📍 ' : kind === 'land' ? '🛬 ' : kind === 'takeoff' ? '🛫 ' : '🔔 ') + text, kind === 'geofence' ? 'alert' : 'info', 8000); speak(text); document.dispatchEvent(new CustomEvent('alertlog')); return e;
}
export const clearLog = () => { log.length = 0; store.set('alertlog', log); document.dispatchEvent(new CustomEvent('alertlog')); };
const name = a => a.reg || a.fl || a.hex.toUpperCase();
export class Alerts {
  constructor() { this.inside = new Map(); this.primed = new Set(); this.w = new Map(); this.watchPrimed = false; }
  checkGeofences(list) {
    for (const f of state.geofences) {
      if (f.enabled === false) continue; const ins = this.inside.get(f.id) || new Set(), now = new Set();
      for (const a of list) { if (a.gnd && !f.ground) continue; const d = distM(f.lat, f.lon, a.lat, a.lon); if (d <= f.rNm * NM && (!f.maxAlt || a.gnd || (a.alt ?? 0) <= f.maxAlt)) now.add(a.hex); }
      if (this.primed.has(f.id)) {
        for (const h of now) if (!ins.has(h)) { const a = list.find(x => x.hex === h); push('geofence', `${name(a)}${a.type ? ' (' + a.type + ')' : ''} entered “${f.name}” at ${a.gnd ? 'GND' : fmtAlt(a.alt)}`, { hex: h, lat: a.lat, lon: a.lon }); }
        if (f.exit) for (const h of ins) if (!now.has(h)) push('geofence', `${h.toUpperCase()} left “${f.name}”`, { hex: h });
      }
      this.primed.add(f.id); this.inside.set(f.id, now);
    }
  }
  // list = aircraft returned by the latest watchlist poll (present = being received right now)
  checkWatch(list, ok) {
    if (!ok) return; const now = Date.now(), watched = allWatched(), pres = new Map(list.map(a => [a.hex, a])); const A = state.watchAlerts;
    for (const [hex, it] of watched) {
      const a = pres.get(hex), w = this.w.get(hex) || { seen: false, air: null, miss: 0, last: null }; const lab = it.reg || it.label || hex.toUpperCase();
      if (a) {
        if (this.watchPrimed) { if (!w.seen && A.appear) push('appear', `${lab} appeared on ADS-B at ${a.gnd ? 'the ground' : fmtAlt(a.alt)}`, { hex, lat: a.lat, lon: a.lon }); else if (w.air === false && !a.gnd && a.gs > 50 && A.takeoff) push('takeoff', `${lab} took off`, { hex, lat: a.lat, lon: a.lon }); else if (w.air === true && a.gnd && A.land) push('land', `${lab} landed`, { hex, lat: a.lat, lon: a.lon }); }
        w.seen = true; w.air = !a.gnd; w.miss = 0; w.last = a;
      } else if (w.seen) {
        w.miss++; if (w.miss === 3 && w.air && w.last && (w.last.alt ?? 99999) < 3500 && w.last.vr <= 0 && w.last.gs < 160 && A.land && this.watchPrimed) push('land', `${lab} presumed landed (signal lost low at ${fmtAlt(w.last.alt)}, ${Math.round(w.last.gs)} kt)`, { hex, lat: w.last.lat, lon: w.last.lon });
        if (w.miss === 3) { w.seen = false; w.air = null; }
      }
      this.w.set(hex, w);
    }
    this.watchPrimed = true;
  }
}
