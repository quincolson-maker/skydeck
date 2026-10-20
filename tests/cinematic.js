// v1.7 Cinematic Export: headless Chromium (iPhone viewport) records a short clip client-side and checks the file plays.
const path = require('path'), fs = require('fs'); const pw = require('playwright-core');
const URL = process.argv[2] || 'http://127.0.0.1:8080/', LEN = +(process.env.LEN || 30), OUT = path.join(__dirname, '..', 'docs');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ ...pw.devices['iPhone 15 Pro'], timezoneId: 'America/Chicago', acceptDownloads: true }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('PE ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[49]|429|50[0-9]|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await p.goto(URL + '?nosw=1'); await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  await p.evaluate(() => SkyDeck.prevFlights('a2d0b9', 'N28027')); await p.waitForSelector('[data-cine]', { timeout: 60000 }); await p.screenshot({ path: `${OUT}/screenshots/v17-4-flights-cinematic.png` });
  await p.locator('[data-cine]').first().click(); await p.waitForSelector('[data-len]'); await p.screenshot({ path: `${OUT}/screenshots/v17-5-cine-length.png` });
  await p.click(`[data-len="${LEN}"]`); await p.waitForTimeout(LEN * 500); await p.screenshot({ path: `${OUT}/screenshots/v17-6-cine-recording.png` });
  await p.waitForFunction(() => SkyDeck.lastCine, null, { timeout: (LEN + 60) * 1000 });
  const r = await p.evaluate(async () => { const c = SkyDeck.lastCine, v = document.querySelector('#cine video'); await new Promise(res => { if (v.readyState >= 1) res(); else { v.onloadedmetadata = res; v.onerror = res; setTimeout(res, 8000); } });
    let dur = v.duration; if (dur === Infinity) { v.currentTime = 1e9; await new Promise(res => setTimeout(res, 1500)); dur = v.duration; }
    const buf = new Uint8Array(await c.blob.arrayBuffer()); return { name: c.name, type: c.type, size: c.size, secs: c.secs, w: v.videoWidth, h: v.videoHeight, dur, err: v.error?.code || null, head: Array.from(buf.slice(0, 12)), b64: btoa(String.fromCharCode(...buf.slice(0, 0))) }; });
  await p.waitForTimeout(1000); await p.screenshot({ path: `${OUT}/screenshots/v17-7-cine-ready.png` });
  const blobB64 = await p.evaluate(async () => { const b = new Uint8Array(await SkyDeck.lastCine.blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); });
  const file = path.join(OUT, 'cinematic-test.' + (r.type.includes('mp4') ? 'mp4' : 'webm')); fs.writeFileSync(file, Buffer.from(blobB64, 'base64'));
  console.log('clip', JSON.stringify({ ...r, file })); const ok = r.size > 50000 && r.w > 0 && r.h > 0 && !r.err && r.dur > LEN * 0.5;
  console.log('errors:', errs.join('\n') || 'none'); console.log(ok && !errs.length ? 'PASS' : 'FAIL', 'cinematic'); await b.close(); process.exitCode = ok && !errs.length ? 0 : 1;
})();
