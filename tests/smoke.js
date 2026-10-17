// Headless smoke test + screenshots.  Usage: node tests/smoke.js [url]   (needs playwright-core and Chrome)
const path = require('path'); let pw; try { pw = require('playwright-core'); } catch { pw = require(process.env.PW || '/var/tmp/sand-playwright-runtime/58c956d1e0c97cdf54853ab4265d3b95/node_modules/playwright-core'); }
const URL = process.argv[2] || 'http://127.0.0.1:8080/', OUT = process.env.OUT || path.join(__dirname, '..', 'docs', 'screenshots');
(async () => {
  const b = await pw.chromium.launch({ executablePath: process.env.CHROME || '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 860 } })).newPage(); const errs = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text().slice(0, 300)); }); p.on('response', r => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url().slice(0, 140)); }); p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await p.goto(URL + '?nosw=1', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }).catch(e => console.log('not ready', e.message));
  await p.waitForTimeout(12000);
  console.log(await p.evaluate(() => JSON.stringify({ n: SkyDeck.traffic?.size, err: SkyDeck.err, proxy: SkyDeck.ready })));
  const shot = async n => { await p.waitForTimeout(6000); await p.screenshot({ path: OUT + '/' + n + '.png' }); };
  await shot('01-globe');
  await p.evaluate(() => SkyDeck.openTab('planes')); await p.waitForTimeout(1500); await p.screenshot({ path: OUT + '/02-my-planes.png', clip: { x: 0, y: 0, width: 560, height: 860 } });
  // trace: 24 h trace of a live high-altitude aircraft (N28027/N480CC/N291KY may not have flown in the last 24 h)
  await p.evaluate(async () => { await SkyDeck.toggleTrace('a2d0b9', 'N28027', true); SkyDeck.traces.hide('a2d0b9'); const a = SkyDeck.traffic.all().filter(x => !x.gnd && x.alt > 20000 && x.reg)[0]; if (!a) return; await SkyDeck.toggleTrace(a.hex, a.reg, true); const b = SkyDeck.traces.bounds(a.hex); SkyDeck.select(a.hex); SkyDeck.G.flyTo((b.s + b.n) / 2, (b.w + b.e) / 2, Math.max(150000, (b.n - b.s) * 130000), { pitch: -50, duration: 0 }); });
  await p.waitForTimeout(3000); await shot('03-trace');
  // airspace + airports
  await p.evaluate(() => { SkyDeck.openTab('layers'); for (const id of ['aspChk', 'apChk']) { const e = document.getElementById(id); e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); } SkyDeck.G.flyTo(36.12, -86.68, 120000, { pitch: -38, heading: 20, duration: 0 }); });
  await p.waitForTimeout(9000); console.log(await p.evaluate(() => document.querySelector('#st-airspace')?.textContent + ' | ' + document.querySelector('#st-airports')?.textContent));
  await shot('04-airspace');
  await b.close();
  console.log(errs.slice(0, 25).join('\n')); 
})();
