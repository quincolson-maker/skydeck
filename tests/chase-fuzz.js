// Regression: replay + chase cam must never break the render loop on odd traces, and must fall back gracefully.  node tests/chase-fuzz.js [url] [mobile]
const path = require('path'); const pw = require('playwright-core'); const URL = process.argv[2] || 'http://127.0.0.1:8080/', MOB = process.argv[3] === 'mobile', OUT = path.join(__dirname, '..', 'docs', 'screenshots');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext(MOB ? { ...pw.devices['iPhone 15 Pro'] } : { viewport: { width: 1200, height: 700 } }); const p = await ctx.newPage(); const errs = [];
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/40[49]|429|50[0-9]|Failed to load resource/.test(t)) errs.push(t.slice(0, 300)); }); p.on('pageerror', e => errs.push('PE ' + e.message));
  await p.route('**/assets/models/n28027-pa28.glb', r => r.abort());   // tail variant "fails to load" -> must fall back to the generic PA-28
  await p.goto(URL + '?nosw=1&a2hs=1'); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }); await p.waitForTimeout(3000); await p.evaluate(() => document.getElementById('a2hsX')?.click());
  const cases = await p.evaluate(() => {
    const T0 = Date.now() - 3600e3, mk = (n, f, dtm = 6000) => Array.from({ length: n }, (_, i) => ({ t: T0 + i * dtm, lat: 37.06, lon: -88.77, alt: 2000, gnd: false, gs: 100, trk: 90, vr: 0, ...f(i) }));
    return {
      'pattern touch-and-go, no ground flags': mk(240, i => { const ph = (i % 50) / 50; return { lat: 37.06 + 0.01 * Math.sin(ph * 6.28), lon: -88.77 + 0.015 * Math.cos(ph * 6.28), alt: 300 + 700 * Math.max(0, Math.sin(ph * 3.14)), gs: 80, trk: (ph * 360) % 360 }; }),
      'airborne only, no ground points': mk(80, i => ({ lat: 37 + i * 0.0035, lon: -88 + i * 0.0035, alt: 3000 + i * 10, trk: 45, gs: 150 })),
      'short flight (9 points)': mk(9, i => ({ lat: 37 + i * 0.002, alt: 1500, gs: 100 })),
      'NaN / undefined fields': mk(60, i => i % 5 === 2 ? { lat: NaN, gs: undefined, trk: undefined, alt: NaN } : { lat: 37 + i * 0.002, gs: undefined, trk: undefined }),
      'stationary hover': mk(40, i => ({ alt: 300, gs: 0 })),
      'all on ground': mk(40, i => ({ gnd: true, alt: 0, gs: 4 })),
      'unusable: 1 point': mk(1, i => ({})), 'unusable: empty': [],
    };
  });
  const ok = []; let bad = 0;
  for (const [name, pts] of Object.entries(cases)) {
    await p.evaluate(([name, pts]) => { window._R = SkyDeck.replay; _R.stop(); window._okStart = _R.startFlight('a2d0b9', pts, name); if (_R.mode) { _R.startChase(); _R.setSpeed(30); } }, [name, pts]); await p.waitForTimeout(MOB ? 3500 : 2500);
    const f0 = await p.evaluate(() => SkyDeck.viewer.scene.frameState.frameNumber); await p.waitForTimeout(700); const r = await p.evaluate(f0 => { const V = SkyDeck.viewer, c = V.camera, cp = c.positionCartographic, gh = V.scene.globe.getHeight(cp), q = _R.cur; return { started: !!_R.mode, rendering: V.scene.frameState.frameNumber > f0, camFinite: [c.position.x, c.position.y, c.position.z, c.heading, c.pitch].every(Number.isFinite), camAbove: gh == null ? null : +(cp.height - gh).toFixed(1), curFinite: q ? Object.values(q).every(v => typeof v !== 'number' || Number.isFinite(v)) : null, toast: [...document.querySelectorAll('#banner, .toast')].map(e => e.textContent).join(' | ').slice(0, 160) }; }, f0);
    const must = name.startsWith('unusable') ? (!r.started && /Not enough|usable/i.test(r.toast)) : (r.started && r.camFinite && r.rendering && r.curFinite !== false && (r.camAbove == null || r.camAbove > 3)); if (!must) bad++; ok.push({ name, must, ...r }); await p.screenshot({ path: `${OUT}/chasefuzz-${MOB ? 'm' : 'd'}-${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}.png` });
  }
  // tail-variant failure -> generic model
  await p.evaluate(async () => { const { loadTraceDay } = await import('/js/api.js'), { segmentFlights } = await import('/js/replay.js'); const t = await loadTraceDay('a2d0b9', '2026-10-15'); const f = segmentFlights(t.pts).pop(); _R.startFlight('a2d0b9', f.pts, 'N28027'); _R.startChase(); }); await p.waitForTimeout(MOB ? 6000 : 4000);
  const mdl = await p.evaluate(() => ({ want: _R.model.want, cur: !!_R.model.cur, show: _R.model.show })); const mOk = mdl.want === 'pa28' && mdl.cur; if (!mOk) bad++; ok.push({ name: 'n28027 tail glb blocked -> generic', must: mOk, ...mdl }); await p.screenshot({ path: `${OUT}/chasefuzz-${MOB ? 'm' : 'd'}-model-fallback.png` });
  for (const r of ok) console.log(r.must ? 'PASS' : 'FAIL', JSON.stringify(r)); console.log('errors:', errs.join('\n') || 'none'); console.log(bad || errs.length ? 'FAIL' : 'PASS', 'chase-fuzz', MOB ? 'mobile' : 'desktop'); await b.close(); process.exitCode = bad || errs.length ? 1 : 0;
})();
