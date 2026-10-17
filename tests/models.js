// glTF aircraft showcase: node tests/models.js [url]  -> docs/screenshots/models-*.png
const path = require('path'); const pw = require('playwright-core'); const URL = process.argv[2] || 'http://127.0.0.1:8080/', OUT = path.join(__dirname, '..', 'docs', 'screenshots');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 800 } })).newPage(); const errs = []; p.on('console', m => { if (m.type() === 'error' && !/40[49]|429|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 200)); if (m.type() === 'warning' && /model/.test(m.text())) errs.push(m.text()); }); p.on('pageerror', e => errs.push('PE ' + e.message));
  await p.goto(URL + '?nosw=1&a2hs=1'); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  const groups = [[['c172', 'C172'], ['pa28', 'P28A'], ['pc12', 'PC12'], ['kingair', 'BE20'], ['bizjet', 'C56X'], ['heli', 'R44']], [['A320', 'A320'], ['B737', 'B738'], ['B787', 'B789'], ['A350', 'A359'], ['A380', 'A388'], ['fighter', 'F16']]];
  for (let g = 0; g < groups.length; g++) {
    await p.evaluate(async ([list, g]) => { const { Aircraft3D } = await import('/js/models.js'); const { placeAircraft } = await import('/js/model3d.js'); window._ac = window._ac || []; window._ac.forEach(a => a.show = false); window._ac = [];
      const lon0 = -88.7738, lat0 = 37.0583; list.forEach(([k, t], i) => { const a = new Aircraft3D(); a.use({ type: t, reg: '' }); const lon = lon0 + (i - 2.5) * 0.0011; placeAircraft(a, lon, lat0, 300, 0, 0, 1); a.show = true; window._ac.push(a); });
      const C = window.Cesium, cam = SkyDeck.viewer.camera; cam.cancelFlight(); window._look = () => cam.lookAt(C.Cartesian3.fromDegrees(lon0, lat0, 300), new C.HeadingPitchRange(C.Math.toRadians(180 + 20), C.Math.toRadians(-14), g ? 820 : 520)); window._look(); clearInterval(window._li); window._li = setInterval(window._look, 400); }, [groups[g], g]);
    await p.waitForTimeout(9000); await p.screenshot({ path: OUT + '/models-' + (g + 1) + '.png' });
  }
  console.log(JSON.stringify(await p.evaluate(() => { const C = window.Cesium, sc = SkyDeck.viewer.scene; return window._ac.map(a => { const m = a.cur; if (!m) return null; const t = C.Matrix4.getTranslation(m.modelMatrix, new C.Cartesian3()); const w = C.SceneTransforms.worldToWindowCoordinates(sc, t); return { show: m.show, ready: m.ready, win: w && [Math.round(w.x), Math.round(w.y)], r: Math.round(m.boundingSphere.radius), h: Math.round(C.Cartographic.fromCartesian(t).height) }; }); })));
  console.log(await p.evaluate(() => window._ac.map(a => a.cur ? 'glb' : 'proc').join(',')), errs.join('\n') || 'none'); await b.close();
})();
