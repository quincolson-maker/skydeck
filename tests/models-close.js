// one close-up per model: node tests/models-close.js  -> docs/screenshots/models-close-<key>.png
const path = require('path'); const pw = require('playwright-core'); const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 900, height: 560 } })).newPage(); await p.goto('http://127.0.0.1:8080/?nosw=1&a2hs=1'); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  await p.evaluate(() => { document.body.classList.add('chasing'); });
  for (const [k, t, reg, len] of [['c172', 'C172', '', 8], ['pa28', 'P28A', '', 7], ['pc12', 'PC12', '', 14], ['kingair', 'BE20', '', 14], ['bizjet', 'C56X', '', 14], ['heli', 'R44', '', 12], ['fighter', 'F16', '', 15], ['n864rj', 'PC12', 'N864RJ', 14], ['n28027', 'P28A', 'N28027', 7]]) {
    await p.evaluate(async ([t, reg, len]) => { const { Aircraft3D } = await import('/js/models.js'); const { placeAircraft } = await import('/js/model3d.js'); (window._ac || []).forEach(a => a.show = false); const a = new Aircraft3D(); a.use({ type: t, reg }); placeAircraft(a, -88.7738, 37.0583, 300, 0, 0, 1); a.show = true; window._ac = [a];
      const C = window.Cesium, cam = SkyDeck.viewer.camera; cam.cancelFlight(); const look = () => cam.lookAt(C.Cartesian3.fromDegrees(-88.7738, 37.0583, 300 + len * .15), new C.HeadingPitchRange(C.Math.toRadians(215), C.Math.toRadians(-14), len * 1.7)); look(); clearInterval(window._li); window._li = setInterval(look, 300); }, [t, reg, len]);
    await p.waitForTimeout(5500); await p.screenshot({ path: OUT + '/models-close-' + k + '.png', clip: { x: 150, y: 60, width: 600, height: 400 } });
  }
  await b.close();
})();
