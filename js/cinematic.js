// v1.7 Cinematic Export: 100% client-side. Scripted eased chase camera (orbit + low angles at takeoff/landing,
// slow-mo takeoff/landing, sped-up cruise), colour grade, letterbox, vignette, tail/alt/speed overlay, recorded from the
// Cesium canvas with canvas.captureStream + MediaRecorder (mp4/H.264 where supported, else webm). No server rendering.
const Cesium = window.Cesium;
const ease = x => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x), lerp = (a, b, f) => a + (b - a) * f;
export const pickMime = () => ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => window.MediaRecorder?.isTypeSupported?.(m)) || '';
// clip time u (0..1) -> flight time; 30 % takeoff window, 40 % cruise, 30 % landing window
function timeMap(pts) {
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t, air = pts.filter(p => !p.gnd);
  const tko = air.length ? air[0].t : t0 + (t1 - t0) * 0.1, ldg = air.length ? air[air.length - 1].t : t1 - (t1 - t0) * 0.1;
  const a0 = Math.max(t0, tko - 45000), a1 = Math.min(t1, tko + 75000), b0 = Math.max(a1, ldg - 90000), b1 = Math.min(t1, ldg + 30000);
  const K = [[0, a0], [0.3, a1], [0.7, b0], [1, b1]];
  return { tko, ldg, f: u => { for (let i = 1; i < K.length; i++) if (u <= K[i][0]) { const [ua, ta] = K[i - 1], [ub, tb] = K[i]; const g = (u - ua) / Math.max(1e-6, ub - ua); return ta + (tb - ta) * (i === 2 ? g : ease(g) * 0.5 + g * 0.5); } return b1; } };
}
function ui(html) { let d = document.getElementById('cine'); if (!d) { d = document.createElement('div'); d.id = 'cine'; document.body.append(d); } d.innerHTML = html; return d; }
export function cineDialog(app, opts) {
  const d = ui(`<div class="cine-card"><b>CINEMATIC EXPORT</b><div class="cine-sub">${opts.label || ''}<br>Rendered on this device. Keep SkyDeck in front while it records.</div><div class="cine-len">${[30, 45, 60].map(s => `<button class="btn" data-len="${s}">${s} S</button>`).join('')}</div><button class="btn sm" data-cx="1">Cancel</button></div>`);
  d.onclick = e => { const l = e.target.closest('[data-len]'); if (l) record(app, +l.dataset.len); else if (e.target.closest('[data-cx]')) d.remove(); };
}
export async function record(app, len) {
  const R = app.replay, V = app.viewer, scene = V.scene, cam = V.camera, src = V.canvas; if (R.mode !== 'flight' || !R.pts?.length) return;
  const mime = pickMime(); if (!mime || !HTMLCanvasElement.prototype.captureStream) { ui(`<div class="cine-card"><b>NOT SUPPORTED</b><div class="cine-sub">This browser can't record video from the page (no MediaRecorder / captureStream).</div><button class="btn" data-cx="1">Close</button></div>`).onclick = e => e.target.closest('[data-cx]') && document.getElementById('cine').remove(); return; }
  R.endChase(); R.playing = false; R.ui(true); app.setSheet?.('peek'); document.body.classList.add('cinema');
  let wake = null; try { wake = await navigator.wakeLock?.request('screen'); } catch { }
  const W0 = src.width, H0 = src.height, sc = Math.min(1, 720 / Math.min(W0, H0)), W = Math.round(W0 * sc / 2) * 2, H = Math.round(H0 * sc / 2) * 2;
  const out = document.createElement('canvas'); out.width = W; out.height = H; const g = out.getContext('2d');
  const stream = out.captureStream(30), rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6e6 }), chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const tm = timeMap(R.pts), label = R.label || ''; let u = 0, cancelled = false, smooth = null;
  const prog = ui(`<div class="cine-rec"><span class="cine-dot"></span><span id="cineP">REC 0 %</span><button class="btn sm" data-cx="1">Stop</button></div>`); prog.onclick = e => { if (e.target.closest('[data-cx]')) cancelled = true; };
  const bar = Math.round(H * 0.11), vig = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.65)');
  const grade = g.createLinearGradient(0, 0, W, H); grade.addColorStop(0, 'rgba(0,128,140,.22)'); grade.addColorStop(1, 'rgba(255,150,60,.20)');
  const post = () => { // runs right after Cesium renders, while the WebGL buffer is still valid
    g.filter = 'contrast(1.12) saturate(1.18) sepia(.12)'; g.drawImage(src, 0, 0, W, H); g.filter = 'none';
    g.globalCompositeOperation = 'soft-light'; g.fillStyle = grade; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; g.fillStyle = vig; g.fillRect(0, 0, W, H);
    g.fillStyle = '#000'; g.fillRect(0, 0, W, bar); g.fillRect(0, H - bar, W, bar);
    const c = R.cur, fs = Math.max(11, Math.round(H * 0.022)); g.fillStyle = 'rgba(255,255,255,.92)'; g.font = `300 ${fs}px Barlow, system-ui, sans-serif`; g.textBaseline = 'middle';
    const sp = s => s.split('').join(String.fromCharCode(8202)); g.textAlign = 'left'; g.fillText(sp(label.split(' ')[0].toUpperCase()), fs * 1.5, H - bar / 2);
    if (c) { g.textAlign = 'right'; g.fillText(sp(`${c.gnd ? 'GND' : Math.round(c.alt).toLocaleString() + ' FT'}   ${Math.round(c.gs)} KT`), W - fs * 1.5, H - bar / 2); }
    g.textAlign = 'center'; g.font = `300 ${Math.round(fs * 0.8)}px Barlow, system-ui, sans-serif`; g.fillStyle = 'rgba(255,255,255,.55)'; g.fillText(sp('SKYDECK'), W / 2, bar / 2);
  };
  scene.postRender.addEventListener(post); scene.screenSpaceCameraController.enableInputs = false; rec.start(500);
  const t00 = performance.now();
  await new Promise(done => { const step = () => {
    u = (performance.now() - t00) / (len * 1000); if (u >= 1 || cancelled) return done();
    const ft = tm.f(u); R.seek(ft); const c = R.cur; const pe = document.getElementById('cineP'); if (pe) pe.textContent = `REC ${Math.round(u * 100)} %`;
    if (c && Number.isFinite(c.lat + c.lon)) {
      const nearT = Math.min(Math.abs(ft - tm.tko), Math.abs(ft - tm.ldg)), lo = 1 - ease(nearT / 60000); // 1 near takeoff/landing
      const orbit = u * Math.PI * 2 * 1.25, want = { hdg: Cesium.Math.toRadians(c.trk || 0) + Math.PI + Math.sin(orbit) * lerp(0.9, 1.6, lo), pitch: Cesium.Math.toRadians(lerp(-18, -4, lo)), range: lerp(220, 70, lo) };
      if (!smooth) smooth = want; else { const k = 0.08; let dh = want.hdg - smooth.hdg; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); smooth = { hdg: smooth.hdg + dh * k, pitch: lerp(smooth.pitch, want.pitch, k), range: lerp(smooth.range, want.range, k) }; }
      const tgt = Cesium.Cartesian3.fromDegrees(c.lon, c.lat, c.h ?? (c.alt * 0.3048)); cam.lookAt(tgt, new Cesium.HeadingPitchRange(smooth.hdg, smooth.pitch, smooth.range));
    }
    scene.requestRender?.(); requestAnimationFrame(step); }; requestAnimationFrame(step); });
  const stopped = new Promise(r => rec.onstop = r); rec.stop(); await stopped;
  scene.postRender.removeEventListener(post); cam.lookAtTransform(Cesium.Matrix4.IDENTITY); scene.screenSpaceCameraController.enableInputs = true; document.body.classList.remove('cinema'); try { await wake?.release(); } catch { }
  const type = mime.split(';')[0], ext = type === 'video/mp4' ? 'mp4' : 'webm', blob = new Blob(chunks, { type }), name = `skydeck-${(label.split(' ')[0] || 'flight').toLowerCase()}-${len}s.${ext}`;
  const url = URL.createObjectURL(blob); app.lastCine = { blob, name, size: blob.size, type, secs: Math.round(u * len) };
  const file = new File([blob], name, { type }), canShare = navigator.canShare?.({ files: [file] });
  const d = ui(`<div class="cine-card"><b>${cancelled ? 'STOPPED EARLY' : 'CLIP READY'}</b><div class="cine-sub">${name} · ${(blob.size / 1e6).toFixed(1)} MB · ${ext.toUpperCase()}</div><video src="${url}" controls playsinline muted loop autoplay></video><div class="cine-len">${canShare ? '<button class="btn pri" data-sh="1">Share</button>' : ''}<a class="btn" href="${url}" download="${name}">Download</a><button class="btn" data-cx="1">Close</button></div></div>`);
  d.onclick = async e => { if (e.target.closest('[data-sh]')) { try { await navigator.share({ files: [file], title: 'SkyDeck · ' + label }); } catch { } } if (e.target.closest('[data-cx]')) { d.remove(); URL.revokeObjectURL(url); } };
  return app.lastCine;
}
