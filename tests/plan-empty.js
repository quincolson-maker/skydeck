// Empty-state test: weather sources fail -> honest messages, no fabricated data.   node tests/plan-empty.js
const path = require('path'); let pw; try { pw = require('playwright-core'); } catch { pw = require(process.env.PW); }
const URL = process.argv[2] || 'http://127.0.0.1:8080/', OUT = path.join(__dirname, '..', 'docs', 'screenshots');
(async () => {
  const b = await pw.chromium.launch({ executablePath: process.env.CHROME || '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await p.route(/api\/wx\/(model|mrms|pirep)/, r => r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"simulated outage"}' }));
  await p.goto(URL + '?nosw=1'); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }); await p.waitForTimeout(4000);
  await p.click('#modeSeg [data-mode=plan]'); await p.waitForTimeout(800);
  await p.fill('#pDest', 'KXXX'); await p.click('#pBuild'); await p.waitForTimeout(3000); console.log('bad ident ->', await p.textContent('#pMsg'));
  await p.fill('#pDest', 'KHNB'); await p.click('#pBuild'); await p.waitForFunction(() => /Neither|nm ·/.test(document.getElementById('pMsg').textContent), null, { timeout: 60000 }); console.log('all-wx-down ->', await p.textContent('#pMsg'));
  console.log(await p.innerText('#pSrc')); await p.screenshot({ path: OUT + '/plan-empty-state.png' }); await b.close();
})();
