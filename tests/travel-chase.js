// v1.4: Time Travel -> tap a tracked aircraft (N696MA, 2026-10-18) -> flight picker -> smoothed 3D replay with chase cam.
// Also: My Planes "Last flight" picker for N28027. Asserts the aircraft stays centred through the replay.  node tests/travel-chase.js [url] [day] [hex] [reg]
const path = require('path'), fs = require('fs'); const pw = require('playwright-core');
const URL = process.argv[2] || 'http://127.0.0.1:8080/', DAY = process.argv[3] || '2026-10-18', HEX = process.argv[4] || 'a94214', REG = process.argv[5] || 'N696MA', OUT = path.join(__dirname, '..', 'docs');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ ...pw.devices['iPhone 15 Pro'], timezoneId: 'America/Chicago' });
  await ctx.addInitScript(([hex, reg]) => { if (!localStorage.getItem('skydeck.watchlists')) localStorage.setItem('skydeck.watchlists', JSON.stringify([{ id: 'mine', name: 'My Planes', mine: true, items: [{ hex: 'abdf33', reg: 'N864RJ', label: 'Pilatus PC-12 47E NGX' }, { hex: 'a2d0b9', reg: 'N28027', label: 'Piper PA-28' }, { hex: 'a2fa29', reg: 'N291KY', label: 'Pilatus PC-12' }] }, { id: 'tst', name: 'Test', items: [{ hex, reg, label: 'DA20-C1' }] }])); }, [HEX, REG]);
  const p = await ctx.newPage(); const errs = [];
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/40[49]|429|50[0-9]|Failed to load resource/.test(t)) errs.push(t.slice(0, 300)); }); p.on('pageerror', e => errs.push('PE ' + e.message));
  await p.goto(URL + '?nosw=1&a2hs=1'); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }); await p.waitForTimeout(3000); await p.evaluate(() => document.getElementById('a2hsX')?.click());
  const geom = () => p.evaluate(() => { const R = SkyDeck.replay, V = SkyDeck.viewer, c = V.camera, C = Cesium, q = R.cur; const W = V.canvas.clientWidth, H = V.canvas.clientHeight; let scr = null, dist = null;
    if (q && Number.isFinite(q.lat + q.lon + q.h)) { const pp = C.Cartesian3.fromDegrees(q.lon, q.lat, q.h), w = C.SceneTransforms.worldToWindowCoordinates(V.scene, pp); scr = w ? [Math.round(w.x), Math.round(w.y)] : null; dist = Math.round(C.Cartesian3.distance(c.positionWC, pp)); }
    return JSON.parse(JSON.stringify({ mode: R.mode, chase: R.chase, playing: R.playing, label: R.label, t: new Date(R.clock).toLocaleString(), alt: q && Math.round(q.alt), gs: q && Math.round(q.gs), scr, dist, W, H, model: !!R.model?.show })); });
  const rows = []; const rec = async (name, shot) => { const g = await geom(); const ok = g.mode === 'flight' && g.chase && g.scr && Math.abs(g.scr[0] / g.W - 0.5) < 0.32 && g.scr[1] > 60 && g.scr[1] < g.H * 0.85 && g.dist > 20 && g.dist < 1500; rows.push({ name, ok, ...g }); if (shot) await p.screenshot({ path: `${OUT}/screenshots/${shot}.png` }); return g; };
  // ---- A) Time Travel
  await p.evaluate(() => document.querySelector('#tabs button[data-tab="time"]')?.click()); await p.waitForTimeout(800);
  await p.evaluate(d => { const i = document.getElementById('ttDate'); i.value = d; document.getElementById('ttGo').click(); }, DAY);
  await p.waitForFunction(() => SkyDeck.replay.mode === 'travel' && SkyDeck.replay.tracks.size, null, { timeout: 60000 }).catch(() => { });
  const tr = await p.evaluate(h => { const R = SkyDeck.replay, pts = R.tracks.get(h); return { mode: R.mode, n: pts ? pts.length : 0, first: pts && new Date(pts[0].t).toLocaleString(), last: pts && new Date(pts[pts.length - 1].t).toLocaleString(), list: document.getElementById('ttList')?.innerText }; }, HEX); console.log('travel', JSON.stringify(tr));
  if (!tr.n) { console.log('FAIL no track for', REG, DAY); await b.close(); process.exitCode = 1; return; }
  // move the clock onto the aircraft's track and tap its marker on the globe
  await p.evaluate(h => { const R = SkyDeck.replay, pts = R.tracks.get(h); const air = pts.find(x => !x.gnd) || pts[0]; R.seek(air.t + 60000); SkyDeck.setSheet?.('peek'); const m = R.mk.get(h); const pos = m.bb.position; SkyDeck.viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(pos).longitude), Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(pos).latitude), 60000), duration: 0 }); }, HEX);
  await p.waitForTimeout(2500); await p.screenshot({ path: `${OUT}/screenshots/tt-0-travel.png` });
  const xy = await p.evaluate(h => { const m = SkyDeck.replay.mk.get(h), w = Cesium.SceneTransforms.worldToWindowCoordinates(SkyDeck.viewer.scene, m.bb.position); return w && [w.x, w.y]; }, HEX); console.log('marker at', xy);
  let via = 'marker tap'; if (xy) await p.mouse.click(xy[0], xy[1]); await p.waitForTimeout(1200);
  if (!(await p.locator('#fpick').count()) && (await p.evaluate(() => SkyDeck.replay.mode)) !== 'flight') { via = 'CHASE / 3D button'; await p.locator('#rbTTChase').click(); await p.waitForTimeout(800); }
  if (await p.locator('#fpick').count()) { await p.screenshot({ path: `${OUT}/screenshots/tt-1-picker.png` }); const t = await p.locator('#fpick').innerText(); console.log('picker:', t.replace(/\n+/g, ' | ')); const sel = p.locator('#fpick .fp-row.sel'); await ((await sel.count()) ? sel.first() : p.locator('#fpick .fp-row').first()).click(); }
  console.log('chase launched via', via);
  await rec('travel→chase 0.3 s'); await p.waitForTimeout(1500); await rec('travel→chase 2 s', 'tt-2-chase'); await p.waitForTimeout(3000); await rec('travel→chase 5 s (playing)');
  for (let i = 1; i <= 6; i++) { await p.evaluate(f => { const R = SkyDeck.replay; R.seek(R.t0 + f * (R.t1 - R.t0)); }, i / 7); await p.waitForTimeout(2200); await rec(`t=${i}/7`, i === 3 ? 'tt-3-chase-mid' : null); }
  // ---- B) Last flight picker (N28027)
  await p.evaluate(() => { SkyDeck.replay.stop(); document.querySelector('#tabs button[data-tab="planes"]')?.click(); }); await p.waitForTimeout(1000);
  await p.locator('[data-hex="a2d0b9"] [data-act="replay"]').first().click({ force: true });
  await p.waitForFunction(() => document.getElementById('fpick') || SkyDeck.replay.mode === 'flight', null, { timeout: 60000 }).catch(() => { }); await p.waitForTimeout(2500);
  let pk = ''; if (await p.locator('#fpick').count()) { pk = (await p.locator('#fpick').innerText()).replace(/\n+/g, ' | '); await p.screenshot({ path: `${OUT}/screenshots/lf-picker-N28027.png` }); const n = await p.locator('#fpick .fp-row').count(); await p.locator('#fpick .fp-row').nth(Math.min(1, n - 1)).click(); }
  console.log('last-flight picker:', pk); await p.waitForTimeout(800); await p.evaluate(() => SkyDeck.replay.chase || document.getElementById('rbChase')?.click()); await p.waitForTimeout(2500); await rec('N28027 picked flight, chase 2.5 s', 'lf-picked-chase');
  console.table(rows.map(r => ({ name: r.name, ok: r.ok, label: r.label, t: r.t, alt: r.alt, gs: r.gs, scr: String(r.scr), dist: r.dist })));
  fs.writeFileSync(`${OUT}/travel-chase.json`, JSON.stringify({ url: URL, day: DAY, reg: REG, travel: tr, via, picker: pk, rows, errs }, null, 1));
  const bad = rows.filter(r => !r.ok).length; console.log('errors:', errs.join('\n') || 'none'); console.log(bad || errs.length ? 'FAIL' : 'PASS', 'travel-chase bad=' + bad); await b.close(); process.exitCode = bad || errs.length ? 1 : 0;
})();
