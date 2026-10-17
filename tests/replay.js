// Replay takeoff + landing frame captures with the chase cam on a real trace. node tests/replay.js [url] [mobile]  -> docs/screenshots/replay-{d|m}-{takeoff|landing}-N.png + docs/replay-frames-{d|m}.json
const path = require('path'), fs = require('fs'); const pw = require('playwright-core'); const URL = process.argv[2] || 'http://127.0.0.1:8080/', MOB = process.argv[3] === 'mobile', OUT = path.join(__dirname, '..', 'docs', 'screenshots'), P = MOB ? 'replay-m-' : 'replay-d-';
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext(MOB ? { ...pw.devices['iPhone 15 Pro'] } : { viewport: { width: 1200, height: 700 } })).newPage(); const errs = []; p.on('console', m => { if (m.type() === 'error' && !/40[49]|429|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 200)); }); p.on('pageerror', e => errs.push('PE ' + e.message));
  await p.goto(URL + '?nosw=1&a2hs=1'); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }); await p.waitForTimeout(4000); await p.evaluate(() => document.getElementById('a2hsX')?.click());
  const info = await p.evaluate(async () => {
    const { loadTraceDay } = await import('/js/api.js'); const t = await loadTraceDay('a2fa29', '2026-10-12'); const pts = t.pts; let a = 0, e = 0; for (let i = 1; i < pts.length; i++) if (pts[i - 1].gnd && !pts[i].gnd) { a = Math.max(0, i - 8); break; } for (let i = a + 5; i < pts.length; i++) if (!pts[i - 1].gnd && pts[i].gnd) { e = Math.min(pts.length, i + 8); break; }
    const seg = pts.slice(a, e); SkyDeck.replay.setSpeed(1); SkyDeck.replay.startFlight('a2fa29', seg, 'N291KY'); SkyDeck.replay.playing = false; SkyDeck.replay.startChase(); window._R = SkyDeck.replay; return { n: seg.length };
  });
  await p.waitForTimeout(MOB ? 14000 : 10000);
  const st = await p.evaluate(() => { const P = _R.path; return { stats: P.stats, events: P.events, t0: P.t0, t1: P.t1 }; }); console.log(JSON.stringify(st.stats));
  const frames = []; const cap = async (name, t) => { await p.evaluate(t => { _R.clock = t * 1000; _R.update(); }, t); await p.waitForTimeout(MOB ? 2500 : 1800); await p.evaluate(() => _R.update()); await p.waitForTimeout(300); const f = await p.evaluate(() => { const c = _R.cur, gl = SkyDeck.viewer.scene.globe.getHeight(window.Cesium.Cartographic.fromDegrees(c.lon, c.lat)); return { alt: Math.round(c.alt), agl: gl != null ? +(c.h - gl).toFixed(1) : null, pitch: +c.pitch.toFixed(1), bank: +c.bank.toFixed(1), hdg: Math.round(c.trk), gs: Math.round(c.gs), gnd: c.gnd, gear: +c.gear.toFixed(2), est: c.est }; }); frames.push({ name, t, ...f }); await p.screenshot({ path: OUT + '/' + P + name + '.png' }); };
  const tl = st.events.lift[0], tt = st.events.td[st.events.td.length - 1];
  for (const [i, d] of [-14, -5, -1, 2, 6, 14].entries()) await cap('takeoff-' + (i + 1), tl + d);
  for (const [i, d] of [-60, -20, -7, -1, 3, 12].entries()) await cap('landing-' + (i + 1), tt + d);
  // ground clearance sweep: plane height above the rendered terrain at 1 s steps around take-off and landing
  const sweep = await p.evaluate(([tl, tt]) => { const out = []; for (const t of [...Array.from({ length: 40 }, (_, i) => tl - 20 + i), ...Array.from({ length: 40 }, (_, i) => tt - 20 + i)]) { _R.clock = t * 1000; _R.gl = null; _R.update(); const c = _R.cur, gl = SkyDeck.viewer.scene.globe.getHeight(window.Cesium.Cartographic.fromDegrees(c.lon, c.lat)); out.push({ t, gnd: c.gnd, agl: gl != null ? c.h - gl : null }); } return out; }, [tl, tt]);
  const gAgl = sweep.filter(s => s.gnd && s.agl != null).map(s => s.agl); console.log('on-ground height above rendered terrain: min', Math.min(...gAgl).toFixed(2), 'max', Math.max(...gAgl).toFixed(2), 'n', gAgl.length);
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'replay-frames-' + (MOB ? 'm' : 'd') + '.json'), JSON.stringify({ stats: st.stats, frames, groundAgl: { min: Math.min(...gAgl), max: Math.max(...gAgl) } }, null, 1));
  console.log(frames.map(f => `${f.name} t=${f.t.toFixed(0)} agl=${f.agl} pitch=${f.pitch} bank=${f.bank} gear=${f.gear} gnd=${f.gnd}`).join('\n')); console.log('errors:', errs.join('\n') || 'none'); await b.close();
})();
