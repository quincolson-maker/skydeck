// Flight-planning test (Playwright + Chrome/SwiftShader): node tests/plan.js [url]   env: MOBILE=1 for iPhone emulation, ROUTE=long for KPAH-KDEN
const path = require('path'); let pw; try { pw = require('playwright-core'); } catch { pw = require(process.env.PW); }
const URL = process.argv[2] || 'http://127.0.0.1:8080/', OUT = process.env.OUT || path.join(__dirname, '..', 'docs', 'screenshots'), MOB = !!process.env.MOBILE, LONG = process.env.ROUTE === 'long', tag = (MOB ? 'm-' : 'd-') + (process.env.TAG || (LONG ? 'long' : 'short')) + '-';
(async () => {
  const b = await pw.chromium.launch({ executablePath: process.env.CHROME || '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext(MOB ? { ...pw.devices['iPhone 15 Pro'] } : { viewport: { width: 1360, height: 860 } }); const p = await ctx.newPage(), errs = [];
  p.on('console', m => { if (m.type() === 'error' && !/40[49]|429|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 300)); }); p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await p.goto(URL + '?nosw=1', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }); await p.waitForTimeout(6000);
  if (MOB) { await p.tap('#tabs [data-tab=plan]'); await p.waitForTimeout(1200); } else await p.click('#modeSeg [data-mode=plan]');
  await p.waitForTimeout(1000);
  if (process.env.DEP) { await p.fill('#pDep', process.env.DEP); await p.fill('#pDest', process.env.DEST); await p.fill('#pAlt', process.env.CRUISE || '8000'); await p.fill('#pTas', process.env.TAS || '200'); await p.fill('#pVia', process.env.VIA || ''); await p.fill('#pAlts', process.env.ALTS || ''); await p.click('#pBuild'); } else if (LONG) await p.click('#pEx2'); else await p.click('#pBuild');
  await p.waitForFunction(() => /nm ·/.test(document.getElementById('pMsg')?.textContent || '') || document.getElementById('pMsg')?.classList.contains('bad'), null, { timeout: 120000 }).catch(() => { });
  console.log('msg:', await p.evaluate(() => document.getElementById('pMsg').textContent));
  console.log('sources:\n' + (await p.evaluate(() => document.getElementById('pSrc').innerText)));
  await p.waitForTimeout(9000); if (MOB) await p.evaluate(() => SkyDeck.setSheet('peek')); await p.screenshot({ path: OUT + '/plan-' + tag + '01-overview.png' });
  console.log('summary:\n' + (await p.evaluate(() => document.getElementById('pSum').innerText)));
  console.log('airports:\n' + (await p.evaluate(() => document.getElementById('pAp').innerText)).slice(0, 1500));
  await p.evaluate(() => { const s = document.getElementById('pScrub'); s.value = 500; s.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(4000); await p.screenshot({ path: OUT + '/plan-' + tag + '02-mid.png' });
  console.log('readout:', await p.evaluate(() => document.getElementById('pRead').innerText), '|', await p.evaluate(() => document.getElementById('pBadge').innerText));
  await p.evaluate(() => { for (const id of ['lWind', 'lTurb', 'lCloud', 'lTraf']) { const c = document.getElementById(id); if (c && (id !== 'lCloud' || !c.checked)) { c.checked = !c.checked || id === 'lCloud'; c.dispatchEvent(new Event('change', { bubbles: true })); } } document.getElementById('pPlay').click(); }); await p.waitForTimeout(5000); console.log('playing readout:', await p.evaluate(() => document.getElementById('pTime').innerText)); await p.screenshot({ path: OUT + '/plan-' + tag + '05-wind-play.png' }); await p.evaluate(() => document.getElementById('pPlay').click());
  if (process.env.OBL) { const o = process.env.OBL.split(',').map(Number); await p.evaluate(o => { SkyDeck.G.setView(o[0], o[1], o[2], o[3], o[4]); }, o); await p.waitForTimeout(7000); await p.screenshot({ path: OUT + '/plan-' + tag + '04-oblique.png' }); }
  if (MOB) { await p.evaluate(() => { SkyDeck.setSheet('full'); document.getElementById('xsec').scrollIntoView(); }); await p.waitForTimeout(1500); await p.screenshot({ path: OUT + '/plan-' + tag + '03-sheet.png' }); }
  else { await p.evaluate(() => document.getElementById('xsec').scrollIntoView()); await p.screenshot({ path: OUT + '/plan-' + tag + '03-chart.png' }); }
  console.log('errors:', JSON.stringify(errs)); await b.close();
})();
