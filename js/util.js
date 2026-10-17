// Small helpers: DOM, formatting, geodesy, N-number <-> ICAO hex (US registry algorithm)
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); } for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k)); return e; };
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const throttle = (fn, ms) => { let last = 0, t; return (...a) => { const n = performance.now(); if (n - last >= ms) { last = n; fn(...a); } else { clearTimeout(t); t = setTimeout(() => { last = performance.now(); fn(...a); }, ms - (n - last)); } }; };
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const R_EARTH = 6371008.8, NM = 1852, FT = 0.3048, KT = 0.514444;
export const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
export function distM(lat1, lon1, lat2, lon2) { const p1 = rad(lat1), p2 = rad(lat2), dp = p2 - p1, dl = rad(lon2 - lon1); const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return 2 * R_EARTH * Math.asin(Math.sqrt(a)); }
export function bearing(lat1, lon1, lat2, lon2) { const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1); return (deg(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl))) + 360) % 360; }
export function destPoint(lat, lon, brgDeg, dist) { const d = dist / R_EARTH, b = rad(brgDeg), p1 = rad(lat), l1 = rad(lon); const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b)); const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2)); return [deg(p2), ((deg(l2) + 540) % 360) - 180]; }
export const fmtAlt = a => a == null ? '—' : a === 'ground' ? 'GND' : (a >= 18000 ? 'FL' + String(Math.round(a / 100)).padStart(3, '0') : Math.round(a).toLocaleString() + ' ft');
export const fmtAge = s => s == null ? '—' : s < 90 ? Math.round(s) + ' s ago' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 172800 ? (s / 3600).toFixed(1) + ' h ago' : Math.round(s / 86400) + ' d ago';
export const fmtDur = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`; };
export const pad = n => String(n).padStart(2, '0');
export const fmtTime = (ms, utc = false) => { const d = new Date(ms); return utc ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z` : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
export const dayStr = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
export function toast(msg, kind = 'info', ms = 4500) { const box = $('#toasts'); if (!box) return; const t = el('div', { class: 'toast ' + kind }, msg); box.append(t); setTimeout(() => t.classList.add('out'), ms - 400); setTimeout(() => t.remove(), ms); }
// ---- US N-number <-> ICAO24 (FAA block A00001–ADF7C7) ----
const CS = 'ABCDEFGHJKLMNPQRSTUVWXYZ', B1 = 101711, B2 = 10111, B3 = 951, B4 = 35, SUF = 601;
const sufOff = s => { if (!s) return 0; let c = 25 * CS.indexOf(s[0]) + 1; if (s.length === 2) c += CS.indexOf(s[1]) + 1; return c; };
export function nToIcao(n) {
  n = String(n || '').toUpperCase().replace(/^N/, ''); if (!/^[1-9][0-9]{0,4}$|^[1-9][0-9]{0,3}[A-HJ-NP-Z]{1,2}$|^[1-9][0-9]{0,2}[A-HJ-NP-Z]{1,2}$|^[1-9][0-9]?[A-HJ-NP-Z]{1,2}$|^[1-9][A-HJ-NP-Z]{1,2}$/.test(n)) return null;
  if (/[A-Z]/.test(n.slice(0, -2).replace(/[A-Z]{1,2}$/, 'x')) ) return null;
  let o = 0xA00001 + (+n[0] - 1) * B1;
  const step = (i, base, blk) => { if (n.length > i) { if (/[A-Z]/.test(n[i])) { o += sufOff(n.slice(i)); return true; } o += base + +n[i] * blk; } return false; };
  if (n.length > 1) { if (/[A-Z]/.test(n[1])) o += sufOff(n.slice(1)); else { o += SUF + +n[1] * B2;
    if (n.length > 2) { if (/[A-Z]/.test(n[2])) o += sufOff(n.slice(2)); else { o += SUF + +n[2] * B3;
      if (n.length > 3) { if (/[A-Z]/.test(n[3])) o += sufOff(n.slice(3)); else { o += SUF + +n[3] * B4;
        if (n.length > 4) o += /[A-Z]/.test(n[4]) ? CS.indexOf(n[4]) + 1 : 25 + +n[4]; } } } } } }
  return o.toString(16).toUpperCase();
}
export function icaoToN(hex) {
  let o = parseInt(hex, 16) - 0xA00001; if (!(o >= 0 && o < 915399)) return null;
  const suf = k => { if (k === 0) return ''; k -= 1; const f = Math.floor(k / 25), r = k % 25; return CS[f] + (r ? CS[r - 1] : ''); };
  let out = 'N' + (Math.floor(o / B1) + 1); o %= B1; if (o < SUF) return out + suf(o); o -= SUF;
  out += Math.floor(o / B2); o %= B2; if (o < SUF) return out + suf(o); o -= SUF;
  out += Math.floor(o / B3); o %= B3; if (o < SUF) return out + suf(o); o -= SUF;
  out += Math.floor(o / B4); o %= B4; if (o === 0) return out; if (o <= 24) return out + CS[o - 1]; return out + (o - 25);
}
export const download = (name, text, type = 'text/plain') => { const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };
export const toCSV = (rows, cols) => [cols.join(','), ...rows.map(r => cols.map(c => { const v = r[c] ?? ''; return /[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v; }).join(','))].join('\n');
