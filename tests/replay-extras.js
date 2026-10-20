// v1.4.1: shared replay link (#rp=hex@ts) + skip to takeoff / landing on iPhone.  node tests/replay-extras.js [url]
const path = require('path'), fs = require('fs'); const pw = require('playwright-core'); const URL = process.argv[2] || 'http://127.0.0.1:8080/', OUT = path.join(__dirname, '..', 'docs');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ ...pw.devices['iPhone 15 Pro'], timezoneId: 'America/Chicago' })).newPage(); const errs = [];
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/40[49]|429|50[0-9]|Failed to load resource/.test(t)) errs.push(t.slice(0, 300)); }); p.on('pageerror', e => errs.push('PE ' + e.message));
  await p.goto(URL + '?nosw=1&a2hs=1#rp=a94214@1792352760'); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 });
  await p.waitForFunction(() => SkyDeck.replay.mode === 'flight', null, { timeout: 60000 }).catch(() => { }); await p.waitForTimeout(5000);
  const st = () => p.evaluate(() => { const R = SkyDeck.replay, q = R.cur; return { mode: R.mode, chase: R.chase, label: R.label, t: new Date(R.clock).toLocaleTimeString(), gnd: q && q.gnd, alt: q && Math.round(q.alt), gs: q && Math.round(q.gs), ev: R.events && Object.fromEntries(Object.entries(R.events()).map(([k, v]) => [k, v && new Date(v).toLocaleTimeString()])) }; });
  const r = { link: await st() }; await p.screenshot({ path: OUT + '/screenshots/rx-0-shared.png' });
  await p.locator('#rbTko').click(); await p.waitForTimeout(3500); r.tko = await st(); await p.screenshot({ path: OUT + '/screenshots/rx-1-takeoff.png' });
  await p.locator('#rbLdg').click(); await p.waitForTimeout(3500); r.ldg = await st(); await p.screenshot({ path: OUT + '/screenshots/rx-2-landing.png' });
  console.log(JSON.stringify(r, null, 1)); const ok = r.link.mode === 'flight' && r.link.chase && /N696MA|A94214/.test(r.link.label) && r.tko.ev.tko && r.ldg.ev.ldg && r.tko.chase && r.ldg.chase;
  fs.writeFileSync(OUT + '/replay-extras.json', JSON.stringify({ r, errs }, null, 1)); console.log('errors:', errs.join('\n') || 'none'); console.log(ok && !errs.length ? 'PASS' : 'FAIL', 'replay-extras'); await b.close(); process.exitCode = ok && !errs.length ? 0 : 1;
})();
