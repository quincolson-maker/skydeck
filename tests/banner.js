// iPhone portrait: empty-state chip is one line, below the top bar, auto-dismisses (~5 s) and never covers the globe centre or the bottom bar. node tests/banner.js [url]
const path = require('path'); const pw = require('playwright-core'); const URL = process.argv[2] || 'http://127.0.0.1:8080/', OUT = path.join(__dirname, '..', 'docs', 'screenshots');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ ...pw.devices['iPhone 15 Pro'] }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/\/api\/adsb\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ac: [], now: Date.now(), total: 0 }) }));
  await p.goto(URL + '?nosw=1&a2hs=1'); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }); await p.waitForTimeout(3500);
  await p.evaluate(() => document.getElementById('a2hsX')?.click());
  const rect = () => p.evaluate(() => { const e = document.getElementById('banner'), r = e.getBoundingClientRect(), bar = document.getElementById('tabs')?.getBoundingClientRect(), top = document.querySelector('#topbar,.topbar,header')?.getBoundingClientRect(); return { hidden: e.hidden, text: e.textContent, y: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), x: Math.round(r.left), vw: innerWidth, vh: innerHeight, barTop: bar && Math.round(bar.top), lines: Math.round(r.height / 16) }; });
  const r1 = await rect(); console.log('shown', JSON.stringify(r1)); await p.screenshot({ path: OUT + '/banner-m-1-shown.png' });
  await p.waitForTimeout(6000); const r2 = await rect(); console.log('after 6 s hidden =', r2.hidden); await p.screenshot({ path: OUT + '/banner-m-2-dismissed.png' });
  const ok = !r1.hidden && r1.h <= 30 && r1.y >= 56 && r1.y + r1.h < r1.vh * 0.2 && r2.hidden; console.log(ok ? 'PASS' : 'FAIL', errs.join(';') || 'no errors'); await b.close();
})();
