// Earth detail test: node tests/earth.js [url] [mobile]  -> docs/screenshots/earth-{d|m}-*.png
const path = require('path'); let pw; try { pw = require('playwright-core'); } catch { pw = require(process.env.PW); }
const URL = process.argv[2] || 'http://127.0.0.1:8080/', MOB = process.argv[3] === 'mobile', OUT = process.env.OUT || path.join(__dirname, '..', 'docs', 'screenshots'), P = MOB ? 'earth-m-' : 'earth-d-';
const dev = pw.devices['iPhone 15 Pro'];
(async () => {
  const b = await pw.chromium.launch({ executablePath: process.env.CHROME || '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext(MOB ? { ...dev } : { viewport: { width: 1440, height: 860 } }); const p = await ctx.newPage(); const errs = [];
  p.on('console', m => { if (m.type() === 'error' && !/40[49]|429|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 200)); }); p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await p.goto(URL + '?nosw=1&a2hs=1', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }); await p.waitForTimeout(6000);
  if (MOB) await p.evaluate(() => document.getElementById('a2hsX')?.click());
  const shot = n => p.screenshot({ path: OUT + '/' + P + n + '.png' });
  const info = () => p.evaluate(() => { const s = SkyDeck.viewer.scene; return { lit: s.globe.enableLighting, aniso: SkyDeck.viewer.imageryLayers.get(0).maximumAnisotropy, sse: s.globe.maximumScreenSpaceError, bld: SkyDeck.buildings.n, tiles: SkyDeck.buildings.tiles.size, msg: SkyDeck.buildings.msg, layers: SkyDeck.viewer.imageryLayers.length }; });
  console.log('start', JSON.stringify(await info()));
  await p.evaluate(() => { SkyDeck.G.flyTo(0, 0, 2.2e7, { duration: 0 }); }); await p.waitForTimeout(6000); await shot('01-globe-terminator');
  await p.evaluate(() => SkyDeck.G.flyTo(37.0583, -88.7738, 1800, { pitch: -28, heading: 330, duration: 0 })); await p.waitForTimeout(MOB ? 30000 : 28000); await shot('02-kpah-low');
  console.log('kpah', JSON.stringify(await info()));
  await p.evaluate(() => SkyDeck.G.flyTo(37.0583, -88.7738, 450, { pitch: -22, heading: 150, duration: 0 })); await p.waitForTimeout(12000); await shot('03-kpah-runway');
  await p.evaluate(() => SkyDeck.G.flyTo(37.0834, -88.6000, 1500, { pitch: -30, heading: 20, duration: 0 })); await p.waitForTimeout(40000); await shot('04-paducah-town');
  console.log('town', JSON.stringify(await info()));
  console.log('ERRORS:', errs.join('\n') || 'none'); await b.close();
})();
