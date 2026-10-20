// Before/after mobile screenshots: node tools/shots.js <prefix> [url]
const path = require('path'); const pw = require('playwright-core');
const PRE = process.argv[2] || 'x', URL = process.argv[3] || 'http://127.0.0.1:8080/', OUT = path.join(__dirname, '..', 'docs', 'screenshots');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ ...pw.devices['iPhone 15 Pro'], timezoneId: 'America/Chicago' }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[49]|429|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await p.goto(URL + '?nosw=1', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }); await p.waitForTimeout(12000);
  const s = n => p.screenshot({ path: path.join(OUT, `${PRE}-${n}.png`) });
  await s('1-map');
  await p.evaluate(() => document.querySelector('#tabs [data-tab=planes]').click()); await p.waitForTimeout(1500); await s('2-planes');
  await p.evaluate(() => { document.querySelector('#tabs [data-tab=jb]').click(); SkyDeck.setSheet?.('full'); }); await p.waitForTimeout(1500); await s('3-jetbasket');
  console.log(PRE, 'errors:', errs.length ? errs : 'none'); await b.close();
})();
