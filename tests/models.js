// v1.8 model gallery: renders each GLB on the ground (same axes/transform as js/models.js), 3/4 front view, screenshot per model.
// node tests/models.js <prefix> key1 key2 ...   -> docs/screenshots/<prefix>-<key>.png, prints load errors + span check
const path = require('path'); const pw = require('playwright-core');
const [PRE, ...KEYS] = process.argv.slice(2), URL = process.env.URL || 'http://127.0.0.1:8080/', OUT = path.join(__dirname, '..', 'docs', 'screenshots');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ ...pw.devices['iPhone 15 Pro'] }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[49]|429|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await p.goto(URL + '?nosw=1'); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 });
  await p.waitForTimeout(8000); await p.evaluate(() => { if (document.getElementById('liveBtn').classList.contains('on')) document.getElementById('liveBtn').click(); document.body.classList.add('cinema'); SkyDeck.setSheet?.('peek'); document.getElementById('a2hsX')?.click(); SkyDeck.traffic?.clear?.(); });
  for (const k of KEYS) {
    const r = await p.evaluate(async ([k, PITCH]) => { const C = Cesium, V = SkyDeck.viewer, S = V.scene; const lon = -94.7139, lat = 39.2976; const h = (await C.sampleTerrainMostDetailed(V.terrainProvider, [C.Cartographic.fromDegrees(lon, lat)]).catch(() => [{ height: 0 }]))[0].height || 0;
      window._m && S.primitives.remove(window._m); const m = await C.Model.fromGltfAsync({ url: `assets/models/${k}.glb`, upAxis: C.Axis.Y, forwardAxis: C.Axis.Z, backFaceCulling: false }); window._m = S.primitives.add(m);
      const enu = C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(lon, lat, h + 600), new C.HeadingPitchRoll(0, 0, 0)); C.Matrix4.multiply(enu, C.Matrix4.fromRotationTranslation(C.Matrix3.fromRotationZ(Math.PI / 2)), m.modelMatrix);
      await new Promise(res => { const f = () => m.ready ? res() : setTimeout(f, 100); f(); }); const bs = m.boundingSphere; const ctr = C.Matrix4.multiplyByPoint(enu, new C.Cartesian3(0, 0, 1.5), new C.Cartesian3());
      V.camera.cancelFlight(); SkyDeck.traffic?.clear?.(); V.camera.lookAt(ctr, new C.HeadingPitchRange(C.Math.toRadians(215), C.Math.toRadians(PITCH), bs.radius * 2.6)); S.requestRender?.(); const sg = m._sceneGraph; return { r: bs.radius.toFixed(1), ax: sg && sg._axisCorrectionMatrix && Array.from(C.Matrix4.toArray(sg._axisCorrectionMatrix)).map(v => Math.round(v)).join(','), up: m._upAxis, fw: m._forwardAxis, comp: sg && Array.from(C.Matrix4.toArray(sg.computedModelMatrix || C.Matrix4.IDENTITY)).slice(0, 11).map(v => +v.toFixed(2)).join(',') }; }, [k, +(process.env.PITCH || -14)]).catch(e => ({ err: e.message }));
    await p.waitForTimeout(2500); await p.screenshot({ path: `${OUT}/${PRE}-${k}.png` }); console.log(k, JSON.stringify(r));
  }
  console.log('errors:', errs.join('\n') || 'none'); await b.close();
})();
