// iPhone portrait: glb lazy loading + chase + FPS with many aircraft. node tests/models-mobile.js [url]
const path = require('path'); const pw = require('playwright-core'); const URL = process.argv[2] || 'http://127.0.0.1:8080/', OUT = path.join(__dirname, '..', 'docs', 'screenshots');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ ...pw.devices['iPhone 15 Pro'] })).newPage(); const errs = [], glb = []; p.on('response', r => { if (/\.glb/.test(r.url())) glb.push(r.url().split('/').pop() + ' ' + (r.headers()['content-length'] || '?')); });
  p.on('console', m => { if (m.type() === 'error' && !/40[49]|429|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 200)); }); p.on('pageerror', e => errs.push('PE ' + e.message));
  await p.goto(URL + '?nosw=1&a2hs=1'); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }); await p.waitForTimeout(10000);
  console.log('glb requests after load (expect none):', glb.length, 'aircraft', await p.evaluate(() => SkyDeck.traffic.all().length));
  await p.evaluate(() => document.getElementById('a2hsX')?.click());
  await p.evaluate(() => { const a = SkyDeck.traffic.all().filter(x => !x.gnd)[0]; SkyDeck.select(a.hex); SkyDeck.replay.startLiveChase(a.hex); }); await p.waitForTimeout(9000);
  await p.screenshot({ path: OUT + '/models-m-chase.png' });
  console.log('glb after chase:', glb.join(', '), '| FPS', await p.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(Math.round(n / 3)); }; f(); })), errs.join('\n') || 'no errors'); await b.close();
})();
