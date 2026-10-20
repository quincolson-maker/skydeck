// JetBasket shop airports: defaults listed in Settings with sources, toggle persists, radar ADS-B pass runs with shop matching.  node tests/jb-shops.js [url]
const path = require('path'); const pw = require('playwright-core'); const URL = process.argv[2] || 'http://127.0.0.1:8080/', OUT = path.join(__dirname, '..', 'docs', 'screenshots');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ ...pw.devices['iPhone 15 Pro'], timezoneId: 'America/Chicago' })).newPage(); const errs = [], R = {};
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/40[49]|429|50[0-9]|Failed to load resource/.test(t)) errs.push(t.slice(0, 300)); }); p.on('pageerror', e => errs.push('PE ' + e.message));
  await p.goto(URL + '?nosw=1'); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }); await p.waitForTimeout(2000);
  await p.evaluate(() => { document.querySelector('#tabs button[data-tab="jb"]').click(); SkyDeck.setSheet?.('full'); }); await p.click('[data-jv="set"]'); await p.waitForSelector('[data-shop]', { timeout: 30000 });
  R.n = await p.locator('[data-shop]').count(); R.withSource = await p.locator('#jbShopBox a').count(); await p.locator('[data-shop="d0"]').uncheck(); await p.click('[data-jv="set"]'); await p.waitForSelector('[data-shop]'); R.offPersists = !(await p.locator('[data-shop="d0"]').isChecked()); await p.locator('[data-shop="d0"]').check();
  await p.fill('#jsI', 'KPAH'); await p.fill('#jsN', 'Test shop'); await p.click('[data-js="add"]'); await p.waitForTimeout(400); R.added = await p.locator('#jbShopBox', { hasText: 'Test shop' }).count(); await p.screenshot({ path: OUT + '/jb-9-shops.png' });
  await p.click('[data-jv="radar"]'); await p.fill('#jrM', 'PC-12'); await p.fill('#jrS', 'KY'); await p.click('#jrGo'); await p.waitForSelector('[data-jr="adsb"]', { timeout: 60000 }); await p.click('[data-jr="adsb"]');
  await p.waitForFunction(() => !/checking ADS-B/.test(document.querySelector('#jrOut .jb-sum')?.innerText || 'checking ADS-B'), null, { timeout: 300000 }); R.radar = await p.evaluate(() => [...document.querySelectorAll('#jrOut .jb-card')].map(c => c.innerText.replace(/\n/g, ' | ').slice(0, 220)).slice(0, 4));
  console.log(JSON.stringify(R, null, 1)); const ok = R.n >= 40 && R.withSource >= 40 && R.offPersists && R.added && R.radar.length && !errs.length; console.log('errors:', errs.join('\n') || 'none'); console.log(ok ? 'PASS' : 'FAIL', 'jb-shops'); await b.close(); process.exitCode = ok ? 0 : 1;
})();
