// v1.4.2: METAR flight-category dots (VFR green / MVFR blue / IFR red / LIFR magenta) at reporting airports in view, from aviationweather.gov via the proxy (free, no key).
import { J } from './wxdata.js';
import { scene, viewRect, cameraInfo } from './globe.js';
import { state, save } from './store.js';
const Cesium = window.Cesium, COL = { VFR: '#22c55e', MVFR: '#3b82f6', IFR: '#ef4444', LIFR: '#d946ef' };
export const metars = {
  on: !!state.settings.metar, pts: null, lbs: null, info: new Map(), key: null, n: 0,
  ensure() { if (!this.pts) { this.pts = scene.primitives.add(new Cesium.PointPrimitiveCollection()); this.lbs = scene.primitives.add(new Cesium.LabelCollection({ scene })); } },
  clear() { this.pts?.removeAll(); this.lbs?.removeAll(); this.info.clear(); this.n = 0; },
  toggle(v) { this.on = v; state.settings.metar = v; save('settings'); this.key = null; if (!v) { this.clear(); this.status('off'); } else this.refresh(); },
  status(m) { document.dispatchEvent(new CustomEvent('layerstatus', { detail: { k: 'metar', ok: true, msg: m } })); const e = document.getElementById('st-metar'); if (e) e.textContent = m; },
  async refresh() {
    if (!this.on) return; const ci = cameraInfo();   // v1.11: shown at every zoom while the layer is on (zoomed out = the visible area in up to 12 parallel tiles; aviationweather.gov caps ~400 stations per request)
    let r = viewRect(); if (r && r.e < r.w) r = null; if (!r || ci.h > 6e6) { const c = ci.ctr || { lat: ci.lat, lon: ci.lon }; r = { s: c.lat - 35, n: c.lat + 35, w: c.lon - 60, e: c.lon + 60 }; }
    const b = { s: Math.max(-89, r.s), w: Math.max(-180, r.w), n: Math.min(89, r.n), e: Math.min(180, r.e) };
    if (b.e - b.w > 120) { const c = (b.e + b.w) / 2; b.w = Math.max(-180, c - 60); b.e = Math.min(180, c + 60); } if (b.n - b.s > 70) { const c = (b.n + b.s) / 2; b.s = Math.max(-89, c - 35); b.n = Math.min(89, c + 35); }
    const W = b.e - b.w, H = b.n - b.s, nx = W > 30 ? 4 : W > 12 ? 2 : 1, ny = H > 20 ? 3 : H > 8 ? 2 : 1, g = W > 30 ? 5 : W > 8 ? 1 : 0.5;
    const key = [b.s, b.w, b.n, b.e].map(x => Math.round(x / g) * g).join(','); if (key === this.key && Date.now() - this.t < 300000) return; this.key = key; this.t = Date.now();
    const tiles = []; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) tiles.push({ w: b.w + W * i / nx, e: b.w + W * (i + 1) / nx, s: b.s + H * j / ny, n: b.s + H * (j + 1) / ny });
    try { const rs = (await Promise.all(tiles.map(t => J(`wx/metarbox?s=${t.s.toFixed(2)}&w=${t.w.toFixed(2)}&n=${t.n.toFixed(2)}&e=${t.e.toFixed(2)}`).catch(() => [])))).flat(); if (!this.on || key !== this.key) return; this.ensure(); this.clear(); const seen = new Set(), near = ci.h < 250000;
      for (const m of rs || []) { if (seen.has(m.icaoId) || !isFinite(m.lat + m.lon)) continue; seen.add(m.icaoId); const cat = m.fltCat || '', id = 'met:' + m.icaoId, c = Cesium.Color.fromCssColorString(COL[cat] || '#9ca3af'), pos = Cesium.Cartesian3.fromDegrees(m.lon, m.lat, (m.elev || 0) + 30);
        this.pts.add({ id, position: pos, pixelSize: near ? 11 : 8, color: c, outlineColor: Cesium.Color.BLACK, outlineWidth: 1.2, disableDepthTestDistance: Infinity, scaleByDistance: new Cesium.NearFarScalar(2e4, 1.4, 8e6, 0.45) });   // smaller when far, crisp when close
        if (near) this.lbs.add({ id, position: pos, text: `${m.icaoId} ${cat}`, font: '500 11px Barlow, system-ui', fillColor: c, style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: Cesium.Color.BLACK, pixelOffset: new Cesium.Cartesian2(9, -9), disableDepthTestDistance: Infinity, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 250000) });
        this.info.set(id, `${m.icaoId} ${cat || 'no category'} · ${m.rawOb || ''}`); }
      this.n = seen.size; scene.requestRender(); this.status(`${this.n} METAR stations (aviationweather.gov) · VFR / MVFR / IFR / LIFR`);
    } catch (e) { this.key = null; this.status(e.message.includes('proxy') ? 'METAR dots need the SkyDeck proxy' : 'aviationweather.gov unavailable: ' + e.message); }
  }
};
