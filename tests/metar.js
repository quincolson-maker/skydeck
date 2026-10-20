// v1.4.2: METAR flight-category dots on iPhone near Paducah; tap a dot -> raw METAR toast.  node tests/metar.js [url]
const path = require('path'); const pw = require('playwright-core'); const URL = process.argv[2] || 'http://127.0.0.1:8080/', OUT = path.join(__dirname, '..', 'docs', 'screenshots');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ ...pw.devices['iPhone 15 Pro'], timezoneId: 'America/Chicago' })).newPage(); const errs = [];
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/40[49]|429|50[0-9]|Failed to load resource/.test(t)) errs.push(t.slice(0, 300)); }); p.on('pageerror', e => errs.push('PE ' + e.message));
  await p.goto(URL + '?nosw=1'); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  await p.evaluate(() => { SkyDeck.viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-88.77, 37.06, 180000) }); SkyDeck.metars.toggle(true); SkyDeck.setSheet?.('peek'); });
  await p.waitForFunction(() => SkyDeck.metars.n > 0, null, { timeout: 30000 }).catch(() => { }); await p.waitForTimeout(2000);
  const r = await p.evaluate(() => { const M = SkyDeck.metars; let pt = null, w = null; for (let i = 0; M.pts && i < M.pts.length; i++) { const q = M.pts.get(i), s = Cesium.SceneTransforms.worldToWindowCoordinates(SkyDeck.viewer.scene, q.position); if (s && s.x > 60 && s.x < 330 && s.y > 160 && s.y < 480) { pt = q; w = s; break; } } return { n: M.n, st: document.getElementById('st-metar')?.textContent || '', first: pt && pt.id, xy: w && [w.x, w.y] }; });
  await p.screenshot({ path: OUT + '/metar-dots-m.png' }); let toast = '';
  if (r.xy) { await p.mouse.click(r.xy[0], r.xy[1]); await p.waitForTimeout(800); toast = await p.evaluate(() => document.getElementById('toasts')?.innerText || ''); await p.screenshot({ path: OUT + '/metar-tap-m.png' }); }
  console.log(JSON.stringify({ ...r, toast: toast.slice(0, 200) })); const ok = r.n > 0 && /METAR|[A-Z]{4}/.test(toast) && !errs.length; console.log('errors:', errs.join('\n') || 'none'); console.log(ok ? 'PASS' : 'FAIL', 'metar'); await b.close(); process.exitCode = ok ? 0 : 1;
})();
