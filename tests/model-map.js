// v1.8: type -> model coverage. Checks modelFor() for the user's tails + common types and that every mapped file loads (HTTP 200).
const pw = require('playwright-core'); const URL = process.argv[2] || 'http://127.0.0.1:8080/';
const CASES = [['N864RJ', 'PC12'], ['N291KY', 'PC12'], ['N28027', 'P28A'], ['N696MA', 'DV20'], ['', 'C25B'], ['', 'C25A'], ['', 'C525'], ['', 'C56X'], ['', 'DA40'], ['', 'C172'], ['', 'C177'], ['', 'C182'], ['', 'C206'], ['', 'BE20'], ['', 'B350'], ['', 'CL35'], ['', 'CL30'], ['', 'E55P'], ['', 'E50P'], ['', 'GLF6'], ['', 'GLF5'], ['', 'LJ45'], ['', 'LJ75'], ['', 'B738'], ['', 'B38M'], ['', 'B739'], ['', 'A320'], ['', 'A321'], ['', 'A20N'], ['', 'E75L'], ['', 'E170'], ['', 'CRJ9'], ['', 'CRJ7'], ['', 'CRJ2'], ['', 'B77W'], ['', 'A388'], ['', 'R44'], ['', 'SR22'], ['', 'C208'], ['', 'PA34']];
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox'] }); const p = await b.newPage();
  await p.goto(URL + '?nosw=1'); await p.waitForFunction(() => window.Cesium, null, { timeout: 60000 });
  const r = await p.evaluate(async C => { const { modelFor } = await import('/js/models.js'); const out = []; for (const [reg, type] of C) { const m = modelFor({ reg, type, heli: /^R(22|44|66)$/.test(type) }); const st = (await fetch(`assets/models/${m.key}.glb`, { method: 'HEAD' })).status; out.push({ reg, type, key: m.key, st }); } return out; }, CASES);
  console.table(r); const bad = r.filter(x => x.st !== 200); console.log(bad.length ? 'FAIL' : 'PASS', 'model-map', r.length, 'types'); await b.close(); process.exitCode = bad.length ? 1 : 0;
})();
