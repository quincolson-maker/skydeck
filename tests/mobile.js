// iPhone emulation test (Playwright, iPhone 15 Pro descriptor): node tests/mobile.js [url]  -> docs/screenshots/mobile-*.png  (set WEBKIT=1 to use WebKit if installed)
const path = require('path'); let pw; try { pw = require('playwright-core'); } catch { pw = require(process.env.PW || '/var/tmp/sand-playwright-runtime/58c956d1e0c97cdf54853ab4265d3b95/node_modules/playwright-core'); }
const URL = process.argv[2] || 'http://127.0.0.1:8080/', OUT = process.env.OUT || path.join(__dirname, '..', 'docs', 'screenshots');
const dev = pw.devices['iPhone 15 Pro'] || pw.devices['iPhone 14 Pro'] || pw.devices['iPhone 14'];
(async () => {
  let engine = 'chromium', b; try { if (process.env.WEBKIT) { b = await pw.webkit.launch(); engine = 'webkit'; } } catch { }
  if (!b) b = await pw.chromium.launch({ executablePath: process.env.CHROME || '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ ...dev }); const p = await ctx.newPage(); const errs = [];
  p.on('console', m => { if (m.type() === 'error' && !/40[49]|429|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 200)); }); p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await p.goto(URL + '?nosw=1&a2hs=1', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 });
  await p.waitForTimeout(14000);
  const shot = n => p.screenshot({ path: OUT + '/mobile-' + n + '.png' });
  const m = () => p.evaluate(() => { const r = e => { const b = document.querySelector(e)?.getBoundingClientRect(); return b && b.height ? { y: Math.round(b.top), h: Math.round(b.height) } : null; }; return { vh: innerHeight, sheet: document.body.dataset.sheet, side: r('#side'), top: r('#top'), mobile: SkyDeck.isMobile, n: SkyDeck.traffic.size, src: SkyDeck.sky && SkyDeck.sky.src, err: SkyDeck.err, dpr: devicePixelRatio, canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height] }; });
  console.log(engine, dev.viewport, JSON.stringify(await m()));
  await shot('01-globe'); await p.evaluate(() => document.getElementById('a2hsX').click());
  await p.tap('#tabs [data-tab=planes]'); await p.waitForTimeout(1200); console.log('half', JSON.stringify(await m())); await shot('02-my-planes');
  await p.tap('#tabs [data-tab=planes]'); await p.waitForTimeout(800);
  await p.tap('#tabs [data-tab=search]'); await p.waitForTimeout(1200); await p.fill('#q', 'N480CC'); await p.waitForTimeout(3500); console.log('search', JSON.stringify(await m())); await shot('03-search');
  await p.tap('#tabs [data-tab=layers]'); await p.waitForTimeout(1200); await shot('04-layers');
  await p.evaluate(() => SkyDeck.setSheet('peek')); await p.waitForTimeout(800);
  // select a live high-altitude aircraft with a 24h trace (3D altitude), then the compact strip and the details
  const hex = await p.evaluate(async () => { const a = SkyDeck.traffic.all().filter(x => !x.gnd && x.alt > 15000)[0] || SkyDeck.traffic.all()[0]; if (!a) return null; SkyDeck.focus(a.hex); await SkyDeck.toggleTrace(a.hex, a.reg, true); return a.hex; });
  await p.waitForTimeout(7000); console.log('selected', hex, JSON.stringify(await m())); await shot('05-selected-strip');
  await p.tap('#sel [data-s=more]'); await p.waitForTimeout(1000); await shot('06-selected-details');
  await p.tap('#sel [data-s=more]'); await p.evaluate(() => SkyDeck.select(null));
  await p.evaluate(() => SkyDeck.G.flyTo(36.12, -86.68, 90000, { pitch: -35, duration: 0 })); await p.waitForTimeout(500);
  await p.evaluate(() => { SkyDeck.openTab('layers'); const e = document.getElementById('aspChk'); e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); SkyDeck.setSheet('peek'); }); await p.waitForTimeout(9000); await shot('07-airspace');
  await p.setViewportSize({ width: dev.viewport.height, height: dev.viewport.width }); await p.waitForTimeout(2500); await shot('08-landscape'); await p.tap('#menuBtn'); await p.waitForTimeout(1200); await shot('09-landscape-panel');
  console.log(errs.join('\n')); await b.close();
})();
