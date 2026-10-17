# SkyDeck

Free, no-API-key flight tracker with a 3D globe (CesiumJS) — a faster, leaner take on SkyGlass.
Tracks **N480CC (A5E8CE)**, **N28027 (A2D0B9)**, **N291KY (A2FA29)** out of the box; add any N-number or ICAO hex.

## Run it (one command)
```bash
cd skydeck && node server.js          # Node 18+, zero dependencies  →  http://127.0.0.1:8080
# phone / other devices on your Wi-Fi:  HOST=0.0.0.0 PORT=8080 node server.js
```
**Why a server?** adsb.lol, ADS-B Exchange and aviationweather.gov send no CORS headers, so a browser cannot call them directly. `server.js` is a tiny proxy (short TTL cache + request coalescing) that also serves the app. Without it the app still opens and shows last-known state, with a clear banner.
The browser needs internet for the Cesium CDN, imagery and terrain tiles.

Install as an app (PWA): open it in Chrome/Edge/Safari → *Install* button (or Add to Home Screen). The app shell, Cesium and last-known state are cached for offline use (map tiles are not).

URL options: `?view=lat,lon,height,heading,pitch` · `?mode=mil` · `?api=https://your-worker` (remote proxy) · `?nosw=1` (no service worker) · share a watchlist with `#wl=<code>` (button in the Lists tab).
Controls: drag = orbit, wheel/pinch = zoom, **WASD** = move, **Q/E** = up/down, Shift = fast, Esc = leave draw/chase.

## Data sources (all free, no keys)
| Need | Source | Via |
|---|---|---|
| Live aircraft (radius, military, hex lists) | adsb.lol v2 | proxy |
| 24 h traces, flight history, replay | ADS-B Exchange trace files (needs Referer; best effort) | proxy |
| Airspace B/C/D, runways, heliports, airports (US) | FAA AIS ArcGIS feature services | direct (CORS ok) |
| TFRs | FAA TFR WFS + per-NOTAM detail XML for altitudes | proxy |
| AIRMET/SIGMET | aviationweather.gov (G-AIRMET + SIGMET) | proxy |
| Radar | RainViewer (global) or IEM NEXRAD (US) | direct |
| Aircraft type/owner | hexdb.io | proxy |
| Imagery | Esri World Imagery, OSM, CARTO dark/light | direct |
| Terrain | AWS Terrain Tiles (Terrarium), decoded in-browser by a custom Cesium terrain provider — no ion token | direct |

## SkyGlass feature map
Legend: ✅ done · 🟡 partial · ❌ missing

### Basic
| SkyGlass | SkyDeck | Notes |
|---|---|---|
| Live 3D tracking (commercial / private / military / masked) | ✅ | Billboard primitives, altitude colouring, category toggles. Masked = PIA/LADD flags and hidden-ID aircraft |
| Mil-Ops (all military worldwide) + standard radius mode | ✅ | `/v2/mil`; radius ≤ 250 nm (adsb.lol limit) around home or the view centre |
| 24 h traces | ✅ | ADS-B Exchange yesterday+today, altitude-coloured, ground segments draped |
| Live search (callsign, reg, hex, type) | ✅ | Local instantly, then adsb.lol; N-number→hex computed offline |
| Forward-position markers | ✅ | Watched/selected always; nearest 300 airborne with the *Forward* button |
| Favorite home locations | ✅ | Add by FAA airport ident or "save view" |
| Unlimited watchlists + share by URL hash | ✅ | |
| Time Travel replay | 🟡 | Replays **tracked aircraft** for any past day. Free sources have no worldwide historical snapshot, so whole-sky time travel is impossible |
| Registration lookup | 🟡 | N-number↔hex, hexdb.io, adsb.lol; FAA registry link-out (the registry site blocks scripted access) |
| Auto-refresh toggle, hover HUD | ✅ | |
| Vertical exaggeration, Burn, WASD/mouse/touch | ✅ | |

### Pro
| SkyGlass | SkyDeck | Notes |
|---|---|---|
| Geofence alerts (draw or select circle) | ✅ | Draw on globe, around home or selected aircraft; optional ceiling and exit alerts. |
| Watchlist alerts (appears / lands) | ✅ | plus takes-off |
| Alert log | ✅ | Export to JSON |
| Flight history reports / operations reports | 🟡 | Per-plane flights (from→to via nearest FAA airport, times, distance, max alt) and per-day ops summary over a date range; CSV/JSON. Depends on ADSBx history availability |
| 3D airspace (B/C/D) | ✅ | Floors treated as MSL (AGL floors not terrain-adjusted) |
| Runways, heliports | ✅ | US only (FAA data) |

### Pro+
| SkyGlass | SkyDeck | Notes |
|---|---|---|
| 3D TFRs | 🟡 | Altitudes parsed from NOTAM XML; best effort, shape fidelity depends on feed; needs `server.js` |
| 3D AIRMET/SIGMET | 🟡 | Extruded with the published base/top; needs `server.js` |
| Animated radar | 🟡 | RainViewer free tier is capped at zoom 6 (soft at close range); IEM is US-only |
| CSV/JSON export | ✅ | Reports, alert log, traces |
| Voice alerts | ✅ | Browser speech synthesis |

### Extras
My Planes live-status panel ✅ (live, or last-known with age and source) · chase-cam ✅ (3D model, live or replay) · per-flight replay with scrubber/speed ✅ · dark/light theme ✅ · offline last-known cache ✅ · PWA ✅ · phone layout (bottom sheet) ✅.
No paywall tiers: everything is unlocked.

## Performance design
Billboard/Label/Point primitives (no Entities) for traffic; one throttled tick (90/140/200 ms by count) that dead-reckons positions and blends in fresh reports; label LOD by camera height (≤ 70 labels); pause when the tab is hidden; proxy coalesces identical requests; `?bench=N`-style synthetic load via `SkyDeck.bench(N)` (clearly banner-flagged). Measured on the build box (software GL, no GPU): 4,000 aircraft → a motion tick takes ≈ 28 ms worst-case, ≈ 0 ms between ticks. Real-GPU FPS was **not** measured.

## Honest limits
- Live data, history and weather need the proxy (`node server.js`, or the Worker below). adsb.lol rate-limits (HTTP 429) — the app backs off and says so; the FAA ArcGIS service has a shared per-minute quota and can briefly refuse too (retries, then a message).
- ADS-B Exchange history is unofficial and may break or block; 404 ⇒ the aircraft simply has no trace for that day.
- Alerts only run while a SkyDeck tab is open — no server push.
- Terrain has no geoid correction; MSL altitudes sit on an ellipsoid-ish mesh, so low aircraft can appear a few tens of metres off. Airport/airspace are US-only.
- Military aircraft that don't broadcast ADS-B can't be shown; masked aircraft appear only if they transmit.
- The Cloudflare Worker is tested locally (workerd) but not yet deployed or load-tested on Cloudflare's edge.
- Not benchmarked on real GPUs or iOS Safari.

## Free hosting: one Cloudflare Worker (app + proxy, same origin)
`worker/index.js` is a single Worker that serves the app (Workers Static Assets, from `dist/`) **and** the same `/api/*` routes as `server.js` (adsb.lol, ADS-B Exchange traces with Referer, hexdb, AIRMET/SIGMET, TFR), with Cache-API caching and in-isolate request coalescing. No `?api=` needed.

**Status: written and tested locally under workerd (`wrangler dev`); NOT yet deployed** — the Cloudflare connector available to the build agent could read the account but was refused every write (workers.dev subdomain, Worker upload, Pages project). Deploy yourself in 3 commands (Node 22+ for current wrangler; free Cloudflare account):
```bash
npm i -g wrangler && wrangler login          # opens a browser once
./scripts-build-dist.sh                        # copies the public files into ./dist
wrangler deploy                                # prints https://skydeck.<your-subdomain>.workers.dev
```
First time on an account, Cloudflare asks you to register a workers.dev subdomain (dashboard → Workers & Pages). Local test of the Worker: `wrangler dev -c wrangler.local.jsonc` (that config routes everything through the Worker so it also works on wrangler 3 / Node 20).

Free-plan limits: 100,000 Worker requests/day (static asset requests are free and unmetered), 50 subrequests per request (the TFR route enriches at most 35 NOTAMs per call and caches each for an hour, so the full detail fills in over a few refreshes), 10 ms CPU per request (proxying is I/O-bound). Remote-proxy alternative: host the folder anywhere static and open it with `?api=https://<worker-url>`.

Other options: `node server.js` at home, or any Node host (Fly.io, Render, a VPS).

## Tests
`node tests/smoke.js [url]` (needs `playwright-core` + Chrome) loads the app headless, checks for errors and writes screenshots to `docs/screenshots/`.

## Layout
`server.js` local proxy+static · `worker/index.js` + `wrangler.jsonc` Cloudflare Worker · `scripts-build-dist.sh` · `index.html` · `css/` · `js/` (globe, traffic, traces, layers, alerts, replay, reports, ui, main) · `sw.js` + `manifest.webmanifest` + `icons/` · `worker/` · `tests/` · `docs/screenshots/`
