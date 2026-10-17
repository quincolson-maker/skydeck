// live chase-cam with a real glTF model: node tests/chase.js [url] [mobile]
const path = require('path'); const pw = require('playwright-core'); const URL = process.argv[2] || 'http://127.0.0.1:8080/', OUT = path.join(__dirname, '..', 'docs', 'screenshots');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1200, height: 700 } })).newPage(); const errs = []; p.on('console', m => { if (m.type() === 'error' && !/40[49]|429|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 200)); }); p.on('pageerror', e => errs.push('PE ' + e.message));
  await p.goto(URL + '?nosw=1&a2hs=1'); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }); await p.waitForTimeout(8000);
  const hex = await p.evaluate(() => { const a = SkyDeck.traffic.all().filter(x => !x.gnd && x.alt > 20000 && /^(A32|B73|A31)/.test(x.type))[0] || SkyDeck.traffic.all().filter(x => !x.gnd)[0]; SkyDeck.select(a.hex); SkyDeck.replay.startLiveChase(a.hex); return a.hex + ' ' + a.type; });
  await p.waitForTimeout(9000); await p.screenshot({ path: OUT + '/models-chase-live.png' });
  console.log(hex, await p.evaluate(() => ({ cur: SkyDeck.replay.model.cur ? 'glb' : 'proc', show: SkyDeck.replay.model.cur?.show })), errs.join('\n') || 'none'); await b.close();
})();
