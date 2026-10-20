const pw = require('playwright-core');
(async () => { const b = await pw.chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ ...pw.devices['iPhone 15 Pro'], timezoneId: 'America/Chicago' }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8080/?nosw=1'); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }); await p.waitForTimeout(3000); await p.evaluate(() => document.getElementById('a2hsX')?.click());
  for (const [hex, reg] of [['a2fa29', 'N291KY'], ['a94214', 'N696MA']]) {
    await p.evaluate(([h, r]) => SkyDeck.prevFlights(h, r), [hex, reg]); await p.waitForSelector('#fpick .fp-row[data-i]', { timeout: 60000 }).catch(() => { });
    if (!(await p.locator('#fpick .fp-row[data-i]').count())) { await p.evaluate(([h, r]) => SkyDeck.prevFlights(h, r, '2026-10-18'), [hex, reg]); await p.waitForTimeout(8000); }
    const n = await p.locator('#fpick .fp-row[data-i]').count(); console.log(reg, 'flights', n); if (!n) continue;
    await p.locator('#fpick .fp-row[data-i]').first().click(); await p.waitForTimeout(1500); await p.evaluate(() => { const R = SkyDeck.replay; R.seek(R.t0 + (R.t1 - R.t0) * 0.5); }); await p.waitForTimeout(4000);
    await p.screenshot({ path: `docs/screenshots/v18-chase-${reg}.png` }); console.log(reg, await p.evaluate(() => SkyDeck.replay.model?.key || SkyDeck.replay.model?.want));
    await p.evaluate(() => SkyDeck.replay.stop()); await p.waitForTimeout(800);
  }
  console.log('errors', errs.length ? errs : 'none'); await b.close(); })();
