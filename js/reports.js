// Flight history + operations reports from ADS-B Exchange daily traces (best effort; coverage gaps are flagged, never filled in).
import { loadTraceDay, ais, bboxQ } from './api.js';
import { segmentFlights } from './replay.js';
import { mergePts } from './traces.js';
import { distM, NM, dayStr, fmtDur, pad, toCSV, download } from './util.js';
const aptCache = new Map();
async function nearestAirport(lat, lon) {
  const k = lat.toFixed(2) + ',' + lon.toFixed(2); if (aptCache.has(k)) return aptCache.get(k); const d = 0.06;
  const p = ais('US_Airport', { ...bboxQ(lon - d, lat - d, lon + d, lat + d), where: "TYPE_CODE IN ('AD','HP')", outFields: 'IDENT,NAME,ICAO_ID,TYPE_CODE', resultRecordCount: 20 }).then(j => { let best = null, bd = 1e9; for (const f of j.features) { const dd = distM(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0]); if (dd < bd) { bd = dd; best = f.properties; } } return best && bd < 6000 ? { id: best.ICAO_ID || best.IDENT, name: best.NAME } : null; }).catch(() => null);
  aptCache.set(k, p); return p;
}
export async function buildReport(planes, fromDay, toDay, onProgress) {
  const days = []; for (let t = Date.parse(fromDay + 'T00:00:00Z'); t <= Date.parse(toDay + 'T00:00:00Z'); t += 86400000) days.push(dayStr(t)); if (days.length > 31) throw new Error('Range limited to 31 days');
  const flights = [], coverage = []; let done = 0; const total = planes.length * days.length;
  for (const pl of planes) {
    const parts = []; let fail = 0;
    for (const d of days) { try { const t = await loadTraceDay(pl.hex, d); if (t.pts.length) parts.push(t.pts); coverage.push({ reg: pl.reg || pl.hex, day: d, points: t.pts.length }); } catch (e) { fail++; coverage.push({ reg: pl.reg || pl.hex, day: d, points: 0, error: e.message }); } onProgress && onProgress(++done / total); }
    const pts = mergePts(parts); for (const f of segmentFlights(pts)) {
      const a = f.pts[0], b = f.pts[f.pts.length - 1]; let dist = 0, maxAlt = 0, maxGs = 0; for (let i = 1; i < f.pts.length; i++) { dist += distM(f.pts[i - 1].lat, f.pts[i - 1].lon, f.pts[i].lat, f.pts[i].lon); maxAlt = Math.max(maxAlt, f.pts[i].alt || 0); maxGs = Math.max(maxGs, f.pts[i].gs || 0); }
      const dep = f.start === 'ground' ? await nearestAirport(a.lat, a.lon) : null, arr = f.end === 'ground' ? await nearestAirport(b.lat, b.lon) : null;
      flights.push({ reg: pl.reg || pl.hex, hex: pl.hex, day: dayStr(a.t), dep: dep ? dep.id : (f.start === 'ground' ? 'unknown field' : 'n/a (in flight at first contact)'), depName: dep?.name || '', off_utc: new Date(a.t).toISOString().slice(0, 16) + 'Z', off_local: new Date(a.t).toLocaleString(), arr: arr ? arr.id : (f.end === 'ground' ? 'unknown field' : 'n/a (' + (f.end === 'gap' ? 'coverage gap' : 'data ended') + ')'), arrName: arr?.name || '', on_utc: new Date(b.t).toISOString().slice(0, 16) + 'Z', duration_s: Math.round((b.t - a.t) / 1000), duration: fmtDur((b.t - a.t) / 1000), distance_nm: +(dist / NM).toFixed(1), max_alt_ft: Math.round(maxAlt), max_gs_kt: Math.round(maxGs), complete: f.start === 'ground' && f.end === 'ground', points: f.pts.length, _pts: f.pts });
    }
  }
  flights.sort((a, b) => a.off_utc < b.off_utc ? -1 : 1);
  // operations summary per aircraft + per day
  const ops = {}; for (const f of flights) { const o = ops[f.reg] ||= { reg: f.reg, flights: 0, air_s: 0, nm: 0, airports: new Set(), days: new Set(), maxAlt: 0, hours: Array(24).fill(0) }; o.flights++; o.air_s += f.duration_s; o.nm += f.distance_nm; if (f.dep?.length <= 5 && !f.dep.startsWith('n/a') && f.dep !== 'unknown field') o.airports.add(f.dep); if (f.arr?.length <= 5 && !f.arr.startsWith('n/a') && f.arr !== 'unknown field') o.airports.add(f.arr); o.days.add(f.day); o.maxAlt = Math.max(o.maxAlt, f.max_alt_ft); o.hours[+f.off_utc.slice(11, 13)]++; }
  const opsRows = Object.values(ops).map(o => ({ reg: o.reg, flights: o.flights, air_time: fmtDur(o.air_s), air_time_s: o.air_s, distance_nm: +o.nm.toFixed(1), active_days: o.days.size, airports: [...o.airports].join(' '), max_alt_ft: o.maxAlt, busiest_hour_utc: o.hours.indexOf(Math.max(...o.hours)) }));
  return { flights, ops: opsRows, coverage, days, generated: new Date().toISOString() };
}
export const exportCSV = (rep, kind) => kind === 'ops' ? download('skydeck-operations.csv', toCSV(rep.ops, ['reg', 'flights', 'air_time', 'air_time_s', 'distance_nm', 'active_days', 'airports', 'max_alt_ft', 'busiest_hour_utc']), 'text/csv') : download('skydeck-flights.csv', toCSV(rep.flights, ['reg', 'hex', 'day', 'dep', 'depName', 'off_utc', 'arr', 'arrName', 'on_utc', 'duration_s', 'distance_nm', 'max_alt_ft', 'max_gs_kt', 'complete']), 'text/csv');
export const exportJSON = rep => download('skydeck-report.json', JSON.stringify({ generated: rep.generated, days: rep.days, flights: rep.flights.map(({ _pts, ...f }) => f), operations: rep.ops, coverage: rep.coverage, source: 'ADS-B Exchange globe_history via SkyDeck proxy (best effort)' }, null, 2), 'application/json');
