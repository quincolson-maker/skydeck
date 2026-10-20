// v1.4 flight picker: a bottom-sheet list of flights (date, times, from → to, duration, max alt) used by
// "Last flight" (last 7 days) and by Time Travel ("Chase / 3D replay this flight").
import { ais, bboxQ } from './api.js';
import { esc } from './util.js';
const apCache = new Map();
// nearest FAA airport/heliport ident within ~6 nm of a point (null when none / AIS unavailable)
export async function nearAirport(lat, lon) {
  if (!isFinite(lat + lon)) return null; const key = lat.toFixed(2) + ',' + lon.toFixed(2); if (apCache.has(key)) return apCache.get(key);
  const pr = (async () => { try { const d = 0.1, j = await ais('US_Airport', { ...bboxQ(lon - d, lat - d, lon + d, lat + d), outFields: 'IDENT,ICAO_ID,LATITUDE,LONGITUDE', returnGeometry: false }, 1); let best = null, bd = 1e9;
    for (const f of j.features) { const p = f.properties, dd = Math.hypot(p.LATITUDE - lat, (p.LONGITUDE - lon) * Math.cos(lat * Math.PI / 180)); if (dd < bd) { bd = dd; best = p.ICAO_ID || p.IDENT; } } return bd < 0.1 ? best : null; } catch { return null; } })();
  apCache.set(key, pr); return pr;
}
export const usableFlight = f => f.pts.length >= 8 && f.pts[f.pts.length - 1].t - f.pts[0].t >= 90000;
const fmtD = t => new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }), fmtT = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dur = ms => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`; };
export function flightLabel(reg, f) { return `${reg} ${new Date(f.pts[0].t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`; }
// nearest flight to time t (one that contains t wins)
export function nearestFlight(fl, t) { let k = 0, bd = Infinity; fl.forEach((f, i) => { const a = f.pts[0].t, b = f.pts[f.pts.length - 1].t, d = t < a ? a - t : t > b ? t - b : 0; if (d < bd) { bd = d; k = i; } }); return k; }
export function closePicker() { document.getElementById('fpick')?.remove(); }
// items: [{ html, key }] generic list; flights: segmentFlights() output
export function pickList(title, sub, rows, onPick) {
  closePicker(); const d = document.createElement('div'); d.id = 'fpick'; d.setAttribute('role', 'dialog');
  d.innerHTML = `<div class="fp-head"><div><b>${esc(title)}</b><div class="fp-sub">${esc(sub || '')}</div></div><button class="btn sm" data-fp="x" aria-label="Close">✕</button></div><div class="fp-list">${rows.map((r, i) => `<button class="fp-row${r.sel ? ' sel' : ''}" data-i="${i}">${r.html}</button>`).join('')}</div>`;
  d.addEventListener('click', e => { if (e.target.closest('[data-fp="x"]')) return closePicker(); const r = e.target.closest('[data-i]'); if (r) { closePicker(); onPick(+r.dataset.i); } });
  document.body.append(d); d.querySelector('.fp-row.sel')?.scrollIntoView({ block: 'nearest' }); return d;
}
export function pickFlight(title, flights, sel, onPick) {
  const rows = flights.map((f, i) => { const a = f.pts[0], b = f.pts[f.pts.length - 1], mx = Math.max(...f.pts.map(p => p.alt || 0));
    return { sel: i === sel, html: `<span class="fp-d">${fmtD(a.t)}</span><span class="fp-t mono">${fmtT(a.t)}–${fmtT(b.t)}</span><span class="fp-r mono" data-rt="${i}">${f.start === 'ground' ? '…' : '◐'} → ${f.end === 'ground' ? '…' : '◐'}</span><span class="fp-m mono">${dur(b.t - a.t)} · ${Math.round(mx).toLocaleString()} FT</span>` }; });
  const d = pickList(title, `${flights.length} flight${flights.length > 1 ? 's' : ''} · ◐ = in the air at first/last contact`, rows, onPick);
  // from / to: nearest airport to the first / last fix when on the ground there (filled in as the lookups return)
  flights.slice(0, 14).forEach(async (f, i) => { const a = f.pts[0], b = f.pts[f.pts.length - 1];
    const [x, y] = await Promise.all([f.start === 'ground' ? nearAirport(a.lat, a.lon) : null, f.end === 'ground' ? nearAirport(b.lat, b.lon) : null]);
    const el = d.querySelector(`[data-rt="${i}"]`); if (el) el.textContent = `${x || (f.start === 'ground' ? '?' : '◐')} → ${y || (f.end === 'ground' ? '?' : '◐')}`; });
  return d;
}
