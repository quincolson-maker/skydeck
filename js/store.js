// Persistent state: localStorage for settings/lists/alerts, IndexedDB for bigger snapshots (offline last-known state)
const P = 'skydeck.';
export const store = {
  get(k, d) { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) { console.warn('store full', e); } },
};
export const MINE = [
  { hex: 'a5e8ce', reg: 'N480CC', label: 'Citation CJ3' },
  { hex: 'a2d0b9', reg: 'N28027', label: 'Piper PA-28' },
  { hex: 'a2fa29', reg: 'N291KY', label: 'Pilatus PC-12' },
];
export const defaults = {
  settings: { theme: 'dark', basemap: 'esri', terrain: true, refreshSec: 5, radiusNm: 150, exag: 1, auto: true, voice: false, mode: 'std', followView: false, colorBy: 'cat', fwdAll: false, labels: true },
  homes: [{ name: 'Paducah KPAH', lat: 37.0603, lon: -88.7730 }], homeIdx: 0,
  watchlists: [{ id: 'mine', name: 'My Planes', mine: true, items: MINE }],
  geofences: [], watchAlerts: { appear: true, land: true, takeoff: true },
};
export const state = {};
for (const k of Object.keys(defaults)) state[k] = store.get(k, defaults[k]);
state.settings = { ...defaults.settings, ...state.settings };
export const save = k => store.set(k, state[k]);
export const home = () => state.homes[state.homeIdx] || state.homes[0] || { name: 'Home', lat: 37.06, lon: -88.77 };
export const allWatched = () => { const m = new Map(); for (const l of state.watchlists) for (const it of l.items) if (!m.has(it.hex)) m.set(it.hex, { ...it, lists: [l.id] }); else m.get(it.hex).lists.push(l.id); return m; };
// ---- tiny IndexedDB key/value ----
let dbp;
const db = () => dbp ||= new Promise((res, rej) => { const r = indexedDB.open('skydeck', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export const idbGet = async k => { try { const d = await db(); return await new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch { return undefined; } };
export const idbSet = async (k, v) => { try { const d = await db(); await new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch (e) { console.warn('idb', e); } };
export const idbDel = async k => { try { const d = await db(); d.transaction('kv', 'readwrite').objectStore('kv').delete(k); } catch {} };
// ---- watchlist sharing via URL hash:  #wl=<base64url(JSON {n:name,h:[[hex,reg,label],…]})> ----
export const encodeList = l => btoa(unescape(encodeURIComponent(JSON.stringify({ n: l.name, h: l.items.map(i => [i.hex, i.reg || '', i.label || '']) })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const decodeList = s => { try { const j = JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))); if (!j || !Array.isArray(j.h)) return null; return { name: String(j.n || 'Shared list').slice(0, 60), items: j.h.filter(x => /^[0-9a-fA-F]{6}$/.test(x[0])).slice(0, 500).map(x => ({ hex: x[0].toLowerCase(), reg: String(x[1] || '').slice(0, 10), label: String(x[2] || '').slice(0, 40) })) }; } catch { return null; } };
