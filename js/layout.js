// Responsive layout controller: phone bottom sheet (peek / half / full, swipeable), landscape drawer, iOS install hint, keyboard-safe sheet.
import { app } from './app.js';
import { isMobile, store } from './store.js';
import { $, $$ } from './util.js';
const body = document.body; let sheet = 'peek', dragging = false, justDragged = 0;
const probe = Object.assign(document.createElement('div'), { style: 'position:fixed;left:0;top:0;width:0;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none' }); document.documentElement.appendChild(probe);
const insets = () => { const c = getComputedStyle(probe); return { t: parseFloat(c.paddingTop) || 0, b: parseFloat(c.paddingBottom) || 0 }; };
const heights = () => { const i = insets(), H = innerHeight; return { peek: 68 + i.b, half: Math.round(H * 0.45), full: H - 64 - i.t }; };
export function setSheet(s) { sheet = s; body.dataset.sheet = s; $('#side').style.height = ''; $('#side').classList.remove('drag'); document.dispatchEvent(new Event('sheet')); }
export const getSheet = () => sheet;
app.setSheet = setSheet; app.collapseSheet = () => { if (app.isMobile && sheet !== 'peek') setSheet('peek'); };
app.toggleSheet = () => setSheet(sheet === 'peek' ? 'half' : 'peek');
export function applyLayout() {
  const m = isMobile(), land = m && innerWidth > innerHeight; body.classList.toggle('mobile', m); body.classList.toggle('landscape', land); app.isMobile = m;
  const s = $('.search'), top = $('#top'), ts = $('#tab-search');
  if (m && s.parentElement !== ts) ts.prepend(s); else if (!m && s.parentElement !== top) top.insertBefore(s, $('#modeSeg'));
  if (!m && $('#tabs [data-tab=search]').classList.contains('on')) $('#tabs [data-tab=planes]').click();
  $('#side').style.height = ''; if (land && sheet === 'full') setSheet('half');
}
function initSheet() {
  const side = $('#side'); let st = null;
  const begin = (y, fromContent) => { st = { y0: y, y, h0: side.getBoundingClientRect().height, t: performance.now(), v: 0, moved: false, content: fromContent }; };
  const move = y => {
    if (!st) return; const dy = st.y0 - y; if (!st.moved && Math.abs(dy) < 7) return;
    if (!st.moved) { st.moved = true; dragging = true; side.classList.add('drag'); }
    const H = heights(), now = performance.now(); st.v = (st.y - y) / Math.max(1, now - st.t); st.y = y; st.t = now;
    side.style.height = Math.max(H.peek, Math.min(H.full, st.h0 + dy)) + 'px'; return true;
  };
  const end = () => {
    if (!st) return; const s = st; st = null; if (!s.moved) return; dragging = false; justDragged = performance.now();
    const H = heights(), cur = side.getBoundingClientRect().height, proj = cur + s.v * 220;
    const target = [['peek', H.peek], ['half', H.half], ['full', H.full]].sort((a, b) => Math.abs(a[1] - proj) - Math.abs(b[1] - proj))[0][0]; setSheet(target);
  };
  for (const el of [$('#sheetHead'), $('#tabs')]) {
    el.addEventListener('pointerdown', e => { if (!body.classList.contains('mobile') || body.classList.contains('landscape')) return; begin(e.clientY, false); });
    el.addEventListener('pointermove', e => { if (move(e.clientY) && !el.hasPointerCapture(e.pointerId)) try { el.setPointerCapture(e.pointerId); } catch { } });
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  // swipe down from the top of a scrolled-to-top tab collapses the sheet
  side.addEventListener('touchstart', e => { const t = e.target.closest('.tab'); if (t && t.scrollTop <= 0 && body.classList.contains('mobile') && !body.classList.contains('landscape') && sheet !== 'peek') begin(e.touches[0].clientY, true); }, { passive: true });
  side.addEventListener('touchmove', e => { if (!st || !st.content) return; const dy = e.touches[0].clientY - st.y0; if (!st.moved && dy < 9) { if (dy < -9) st = null; return; } if (move(e.touches[0].clientY)) e.preventDefault(); }, { passive: false });
  side.addEventListener('touchend', () => { if (st && st.content) end(); }); side.addEventListener('touchcancel', () => { if (st && st.content) end(); });
  // tab taps: collapsed -> open half; tapping the open tab again -> collapse
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]'); if (!b || !app.isMobile) return; if (performance.now() - justDragged < 350) { e.stopImmediatePropagation(); return; }
    const was = b.classList.contains('on'), s0 = sheet; setTimeout(() => { if (body.classList.contains('landscape')) { setSheet('half'); return; } if (s0 === 'peek') { setSheet(b.dataset.tab === 'search' ? 'full' : 'half'); if (b.dataset.tab === 'search') setTimeout(() => $('#q').focus(), 320); } else if (was && s0 === 'half') setSheet('peek'); }, 0);
  }, true);
  // keep the sheet above the iOS keyboard
  if (window.visualViewport) { const vv = visualViewport, f = () => { const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop); body.classList.toggle('kb', kb > 120); side.style.bottom = app.isMobile && kb > 120 ? kb + 'px' : ''; }; vv.addEventListener('resize', f); vv.addEventListener('scroll', f); }
  $('#q').addEventListener('focus', () => { if (app.isMobile && sheet !== 'full') setSheet('full'); });
}
function a2hs() {
  const ua = navigator.userAgent, ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1), safari = ios && !/CriOS|FxiOS|EdgiOS/.test(ua), standalone = navigator.standalone || matchMedia('(display-mode:standalone)').matches;
  const force = new URLSearchParams(location.search).has('a2hs'); if (!force && (!safari || standalone || store.get('a2hsDismissed', false))) return;
  setTimeout(() => { $('#a2hs').hidden = false; }, force ? 1500 : 12000); $('#a2hsX').addEventListener('click', () => { $('#a2hs').hidden = true; store.set('a2hsDismissed', true); });
}
export function initLayout() {
  applyLayout(); initSheet(); a2hs();
  let t; const re = () => { clearTimeout(t); t = setTimeout(applyLayout, 120); }; addEventListener('resize', re); addEventListener('orientationchange', re);
  // iOS: stop page-level pinch/double-tap zoom and rubber-banding outside scrollable panels
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', e => { if (!e.target.closest('.tab,#results,#sel,#tabs') && e.touches.length === 1 && !e.target.closest('#globe') && !e.target.closest('input[type=range]')) e.preventDefault(); }, { passive: false });
  let lt = 0; document.addEventListener('touchend', e => { const n = Date.now(); if (n - lt < 300 && e.target.closest('#globe')) e.preventDefault(); lt = n; }, { passive: false });
}
