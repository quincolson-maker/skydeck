// SkyDeck service worker: app shell precache + stale-while-revalidate for CDN assets (Cesium) so the app opens offline.
// Live data (/api/*), map tiles and ArcGIS queries are never cached here — "last known state" is kept in IndexedDB by the app.
const V = 'skydeck-v7', SHELL = ['./', 'index.html', 'css/style.css', 'js/layout.js', 'js/plan.js', 'js/earth.js', 'js/models.js', 'js/flightpath.js', 'js/wx3d.js', 'js/wxdata.js', 'js/app.js', 'fonts/Barlow-Regular.woff', 'fonts/Barlow-Light.woff', 'fonts/Barlow-Medium.woff', 'icons/apple-touch-icon.png', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'js/main.js', 'js/ui.js', 'js/util.js', 'js/store.js', 'js/api.js', 'js/globe.js', 'js/terrain.js', 'js/traffic.js', 'js/traces.js', 'js/layers.js', 'js/alerts.js', 'js/replay.js', 'js/reports.js', 'js/model3d.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== 'skydeck-cdn').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET') return;
  if (u.origin === location.origin) {
    if (u.pathname.startsWith('/api/') || u.pathname.includes('/api/')) return;   // network only
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
  } else if (u.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open('skydeck-cdn').then(async c => { const hit = await c.match(e.request); const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit); return hit || net; }));
  }
});
