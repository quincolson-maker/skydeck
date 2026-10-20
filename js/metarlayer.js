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
    if (!this.on) return; const ci = cameraInfo(); if (ci.h > 1500000) { this.clear(); this.key = null; return this.status('Zoom in (below ~1,500 km) to show METAR dots'); }
    const r = viewRect(); if (!r) return; const b = { s: Math.max(-89, r.s), w: Math.max(-180, r.w), n: Math.min(89, r.n), e: Math.min(180, r.e) };
    if (b.e - b.w > 30) { const c = (b.e + b.w) / 2; b.w = c - 15; b.e = c + 15; } if (b.n - b.s > 20) { const c = (b.n + b.s) / 2; b.s = c - 10; b.n = c + 10; }
    const key = [b.s, b.w, b.n, b.e].map(x => Math.round(x * 2) / 2).join(','); if (key === this.key && Date.now() - this.t < 300000) return; this.key = key; this.t = Date.now();
    try { const rs = await J(`wx/metarbox?s=${b.s.toFixed(2)}&w=${b.w.toFixed(2)}&n=${b.n.toFixed(2)}&e=${b.e.toFixed(2)}`); if (!this.on || key !== this.key) return; this.ensure(); this.clear(); const seen = new Set(), near = ci.h < 250000;
      for (const m of rs || []) { if (seen.has(m.icaoId) || !isFinite(m.lat + m.lon)) continue; seen.add(m.icaoId); const cat = m.fltCat || '', id = 'met:' + m.icaoId, c = Cesium.Color.fromCssColorString(COL[cat] || '#9ca3af'), pos = Cesium.Cartesian3.fromDegrees(m.lon, m.lat, (m.elev || 0) + 30);
        this.pts.add({ id, position: pos, pixelSize: near ? 11 : 8, color: c, outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5, disableDepthTestDistance: Infinity, scaleByDistance: new Cesium.NearFarScalar(2e4, 1.4, 1.5e6, 0.7) });
        if (near) this.lbs.add({ id, position: pos, text: `${m.icaoId} ${cat}`, font: '500 11px Barlow, system-ui', fillColor: c, style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: Cesium.Color.BLACK, pixelOffset: new Cesium.Cartesian2(9, -9), disableDepthTestDistance: Infinity, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 250000) });
        this.info.set(id, `${m.icaoId} ${cat || 'no category'} · ${m.rawOb || ''}`); }
      this.n = seen.size; scene.requestRender(); this.status(`${this.n} METAR stations (aviationweather.gov) · VFR / MVFR / IFR / LIFR`);
    } catch (e) { this.key = null; this.status(e.message.includes('proxy') ? 'METAR dots need the SkyDeck proxy' : 'aviationweather.gov unavailable: ' + e.message); }
  }
};
