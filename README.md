# SkyDeck

Free, no-API-key flight tracker with a 3D globe (CesiumJS) — a faster, leaner take on SkyGlass.
Tracks **N864RJ (ABDF33, Pilatus PC-12 47E NGX)**, **N28027 (A2D0B9)**, **N291KY (A2FA29)** out of the box; add any N-number or ICAO hex.

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

## v1.1 — iPhone, rate limits, mission-control look
**Rate limits (server, `server.js`)** — all users share one server IP, so the proxy protects the free upstreams:
- Live queries go **adsb.lol → adsb.fi → airplanes.live** (adsb.fi's `aircraft` shape is normalised to adsb.lol's `ac`). airplanes.live now answers 403 "contact us" from the build box and (probably) other hosts, so it is last in line and simply cools down for 10 min; adsb.fi works without a key. The UI shows the source in the status line (`LIVE 5s · ADSB.FI`).
- **Cache + coalescing:** point 8 s, mil 20 s, hex 8 s, other 15 s; viewport queries snap to a 0.25° grid with the radius rounded up (50/75/100/150/200/250 nm), the response is filtered back to the circle the client asked for, so near-identical viewports share one entry; identical in-flight requests are merged.
- **Queue + cooldown:** one upstream request at a time per source, spaced 0.35 s (adsb.lol) / 1.1 s (others); a 429 honours `Retry-After` (else 30 s doubling to 5 min), 5xx/timeouts 10 s doubling, 403 10 min. **Stale-while-error:** if every source is cooling, the last good response (≤ 15 min) is served with `sky.stale=true` and its age; with nothing cached the API returns 429 + `Retry-After`. `GET /api/ping` lists each source's cooldown/last error. Test: `SKYDECK_TEST=1 node server.js` + `sh tests/fallback.sh` (simulated failures).
- **Client:** polls every 12 s by default (min 10; saved 5 s settings are migrated), pauses entirely while the tab is hidden, backs off using the server's `Retry-After`, phones default to a 60 nm radius, tracked planes go out in ONE `hex/a,b,c` request, search uses a single lookup (hex answers N-numbers). Banner wording is neutral ("Showing cached data from adsb.fi…") and names the source.

**iPhone / PWA** — `viewport-fit=cover` + safe-area insets, `100dvh`, 44 px touch targets, `touch-action`/gesture guards (no page pinch/double-tap zoom, no rubber-banding), apple-touch-icon, standalone + black-translucent status bar, theme-colour black, startup images for 5 iPhone sizes, an Add-to-Home-Screen hint in iOS Safari, 16 px inputs (no focus zoom). The panel is a **bottom sheet**: 68 px collapsed bar of icon tabs (Planes · Search · Layers · Lists · Alerts · Reports · Replay · Mil-Ops) → swipe/tap to a 45 % half sheet → full sheet on request; tapping the globe or swiping down collapses it. A selected aircraft is a one-line strip above the bar (⋯ expands details). Landscape uses a left drawer. Render load on phones: `resolutionScale` 0.75 (dpr 3) / 0.9 (dpr 2), `requestRenderMode` (≥ 5 Hz, every frame while the camera moves, continuous during chase/replay), `maximumScreenSpaceError` 3.4, no FXAA/ground atmosphere/fog, terrain level cap 11, 4 requests/tile server, half the labels and a slower motion tick. Pinch = zoom, two-finger drag = tilt, two-finger twist = rotate (Cesium defaults).

**Look** — black, hairline borders, frosted translucent panels, Barlow (self-hosted, OFL) thin uppercase wide-tracked type, ghost buttons that invert on hover/active, telemetry labels (ALT / VS / GS / HDG / SQK / POS), corner brackets + centre reticle, a single cold highlight with amber/red reserved for alerts, and a slate→blue→ice→white altitude ramp. Only the visual style; no third-party logos or assets.

**Tests:** `node tests/smoke.js` (desktop), `node tests/mobile.js` (iPhone 15 Pro descriptor; set `WEBKIT=1` for WebKit if installed — on the build box it ran in Chromium with touch emulation), `sh tests/fallback.sh` (source fallback).

## v1.2 — Flight Planning mode with live 3D weather

Open **PLAN** in the top bar (or the Plan tab). *Planning aid only — not an official weather briefing.*

* **Route planner**: DEP / DEST (ICAO), optional VIA waypoints (ICAO or `lat,lon`), alternates, cruise altitude (`8000` or `FL250`), TAS, departure time. Builds a 3D route (climb / cruise / 3° descent), with ground speed corrected for the **forecast winds aloft** along the route and time. Time scrubber + play (1×–120×), optional chase camera, tap the globe for a point readout.
* **Radar (3D)**: NOAA **MRMS** composite reflectivity (~1 km grid, new file every 2 min) decoded on the server from the public GRIB2/PNG files, extruded as noise-textured translucent layers up to the MRMS **18 dBZ echo top** (and the 50 dBZ top for cores on desktop). Reflectivity per column is the 2D composite, so vertical structure inside a cell is schematic; the *tops* are real. Past ~now the radar is **extrapolated up to 2 h** by cross-correlating the current frame with the frame 30 min earlier (labelled `RADAR NOWCAST +NN m`); beyond that, precipitation comes from the model precipitation rate (labelled `MODEL-DERIVED`).
* **Model weather**: **HRRR 3 km hourly** (GFS 0.25° outside the HRRR domain) via Open-Meteo, 17 pressure levels 1000–200 hPa (T, RH, height, wind), freezing level, low/mid/high cloud cover, CAPE, visibility, precipitation. Drives: **clouds** (RH + cover, noise-textured, height-shaded), **icing potential** (0 to −20 °C with RH ≥ 80 %, colour = potential), **freezing-level / −10 / −20 °C surfaces**, **animated winds aloft** (slider for flight level), **turbulence potential** (model vertical wind shear), per-point readouts. All are labelled forecast and shown with their valid hour.
* **Hazards**: AIRMET/SIGMET, G-AIRMET (ICE, TURB, IFR, MT_OBSC, LLWS…), CWAs as time-filtered 3D polygons; **PIREP** icing/turbulence markers; **METAR** flight-category markers with ceiling poles; METAR + TAF cards for DEP/DEST/alternates, with the TAF period valid at your ETA.
* **Along-route cross-section**: altitude vs distance, each column at its own ETA: route, terrain, 0/−10/−20 °C lines, clouds, icing potential, echo tops, AIRMET/SIGMET boxes, PIREPs, moving cursor (drag to scrub).
* **Summary**: icing-potential minutes, freezing level range, convective cells at/near the route, peak shear, hazard areas crossed, PIREPs near track.
* **Honesty rules**: every source is listed with its time under *Data sources & times*; a failed source shows an empty state with the reason, never invented data. The model/radar are coarse — the icing score is a screening aid derived from forecast T/RH, **not** an icing forecast product.
* **Verification** (`python3 tests/verify_wx.py`): HRRR 0 °C level vs the 12Z radiosondes on 2026-10-16: KJAX 4908 m vs 4900 m, KBNA 4446 vs 4430, KLZK 4187 vs 4180; T500 within 0.4 °C. METAR vs model 2 m temperature is shown for the departure airport on every build.
* **Phone**: adaptive quality (fewer/lower-res layers, 256 px layer textures, fewer particles, clouds off by default on phones, no 50 dBZ-top fetch); the chart lives in the Plan sheet.

Server cost notes: the MRMS decode keeps ≤ 2 decoded grids (~50 MB each) in memory for 90 s and decodes one file at a time; Open-Meteo responses are cached 30 min per area.

## v1.3 — Earth detail

- **Imagery to the max.** Esri World Imagery now goes to z19 on desktop (z18 on phones). Extra basemaps in Layers: *USGS Imagery / NAIP* (US, z16, from The National Map) and *Sentinel-2 cloudless 2020* (EOX, z13, CC BY-NC-SA). The NAIP *ImageServer* export tiles were tried and are unusable through a tile proxy (no tiled cache), so USGS's pre-cached `USGSImageryOnly` tiles (NAIP + Landsat) are used instead.
- **Terrain.** AWS Terrain Tiles (Terrarium) to z14 at 129x129 samples per tile on desktop (z11 / 65 on phones); vertical exaggeration slider unchanged.
- **3D buildings.** OpenStreetMap footprints (ODbL) fetched through the server's `/api/osm/buildings` (public Overpass mirrors, POST + User-Agent, 7-day in-memory cache), extruded using `height` / `building:levels` or a per-type default, and sampled to the terrain. Only loads below ~9 km (desktop) / 4.5 km (phone) camera height. Toggle in Layers.
- **Runway markings.** Dark asphalt, white threshold bars, dashed centreline, edge lines and designator numbers, generated from the FAA AIS runway polygons when the camera is below 30 km.
- **Lighting and atmosphere.** Real-time sun and day/night terminator, NASA GIBS VIIRS Black Marble night lights on the dark side, dynamic atmosphere, sun/moon, 16x anisotropic filtering (4x on phones). Shading is automatically switched off below ~2-3 thousand km so the map near an airport is always fully lit.
- **Adaptive quality.** Layers → Earth detail: *Auto* (desktop high, phones light: higher screen-space error, smaller tile cache, no FXAA/ground atmosphere), *High* or *Low*.
- Limits: OSM only has the buildings that volunteers mapped (small towns are patchy; heights are often defaults); Overpass is a shared free service and can take 10-20 s per tile, so buildings fill in progressively; Sentinel-2 imagery is 10 m/px (only useful as an alternative look); NAIP is 0.6-1 m but only to z16 here.

## v1.4 — Real glTF aircraft by type

Replay, the chase cam (live and replay) and Time Travel now show a real glTF model chosen from the aircraft's ICAO type code (`js/models.js`, falls back to the old procedural shape while a model loads or if it fails):

| Group | Models | Files | License |
|---|---|---|---|
| Light GA (C172, C182, PA-28, SR20/22, DA40 ...) | `c172` (high wing), `pa28` (low wing) | 60-95 KB each | CC0, generated by `tools/make-models.js` (original geometry) |
| Single/twin turboprop, bizjet, helicopter, military jet | `pc12`, `kingair`, `bizjet`, `heli`, `fighter` | 60-95 KB each | CC0, same generator |
| Airliners | `A320` (also E-Jets/CRJ/ATR at 62% scale), `B737`, `B787` (all widebodies <= 787/77W class), `A350`, `A380` (B747 at 85%) | 174-250 KB each | **CC BY 4.0, (c) amvlab**, https://github.com/amvlab/aircraft-models (plain "nologo" variants; only the root node matrix was rewritten by `tools/normalize-airliners.py` to put nose on +Z, up +Y, real metres: a modification, geometry/textures untouched) |

Models are fetched on first use only (`assets/models/<key>.glb`, never at page load), cached per viewer, and total 1.9 MB for the whole set (a user only downloads the one or two they use). Types that aren't matched fall back by category (military -> fighter, fast -> A320, else C172).

**Tail-specific models.** N864RJ and N291KY (PC-12 NGX) and N28027 (PA-28-181) have their own variant files (`n864rj-pc12.glb` ...) built from `assets/liveries.json`. **Honest limit: the liveries are placeholders, not photo-derived.** I could not retrieve a photo of any of the three tails (planespotters API returns 0 photos for all three hex codes, RegoSearch has none, JetPhotos/VirtualHangar need a JS browser), so no colours were sampled and no photo was used or stored. To get the real paint: put the main/accent hex values into `assets/liveries.json` (colour values only) and run `node tools/make-models.js`.

Performance: only ONE model exists at a time (the replayed / chased aircraft); every other aircraft stays a cheap billboard icon, so hundreds of aircraft cost nothing extra. Verified in iPhone-emulated Chromium: 0 .glb requests at load, one request (e.g. A320.glb) when the chase cam starts. (Software-rendered test browser: ~9 FPS, same as without models; real-device FPS not measured.)

Other limits: the generated GA/bizjet/heli/fighter meshes (v2, ~60-95 KB each) are far better than before but are still original low-poly geometry, not manufacturer CAD; type matching is by ICAO code so unusual variants get the nearest model.

## v1.5 — Smooth replay (flight-path pipeline) + better aircraft
**Replay.** `js/flightpath.js` turns the raw ADS-B Exchange trace into a clean, evenly sampled path before anything is drawn: duplicate timestamps and position/altitude outliers are dropped (Hampel filter), lat/lon use Hermite splines with tangents from reported ground speed/track, altitude uses monotone cubic (PCHIP, no overshoot), then everything is resampled at ~10 Hz and lightly Gaussian-smoothed. Heading comes from the smoothed path (unwrapped, rate-limited), pitch from flight-path angle + angle of attack with a rotation envelope at liftoff and a flare before touchdown, bank from turn rate (limited, smoothed). ADS-B 'ground' points carry no altitude, so liftoff/touchdown are synthetic knots anchored to the terrain height at the airport (geometric altitude is ellipsoid height, the terrain is MSL, so the offset is measured and blended in rather than assumed); on the ground the model sits on the live rendered terrain, never below it, and the take-off roll / rollout is snapped to the FAA runway centreline direction when a runway is found (`ais Runways`). Gear retracts/extends from height and speed. The chase camera is critically damped with a minimum clearance above terrain. Gaps (>20 s airborne, >60 s on the ground) are drawn as interpolated and labelled '≈ interpolated (data gap)' in the replay readout; nothing is invented, the pipeline only connects real points. `tests/replay-metrics.mjs` (before/after on N291KY, N28027 and a B738) and `tests/replay.js` (Playwright frames) document the result; `tools/replay-sheets.py` builds the contact sheet and raw-vs-cleaned chart.

**Aircraft v2** (`tools/make-models.js`): lofted fuselage sections, tapered airfoil wings, winglets/tips, nacelles, windshield, cabin windows, livery stripe, clearcoat paint, animated propellers/rotors, gear that retracts/extends, blinking nav/strobe/landing lights (`Aircraft3D.animate`). Airliners are unchanged (amvlab, CC BY 4.0).

**Notices.** Empty-state / rate-limit / source banners are now a small one-line chip under the top bar (below the safe-area inset), auto-dismiss after ~5 s, tap to dismiss, never over the globe centre or bottom bar.

**v1.3.2 — chase cam, take two.** (1) Pressing CHASE CAM while the camera was still flying in (the fly-to from the home view runs ~1.5 s and is a high arc: hundreds of km up on a phone, with stars and the horizon limb, looking at the wrong terrain) left that flight running over the chase lock. Now pressing it cancels any fly-to, snaps onto the aircraft in the same call and keeps cancelling while chasing; every state (paused at the start, playing, paused mid-flight, camera panned far away) puts the aircraft in frame immediately. (2) The camera heading is now the direction of the flown path `range` metres behind the aircraft, a function of path geometry only, so it sits behind and above on the actual track at 1x and at 600x (before: up to 100-160 deg off at 120x+); slow/taxi uses the aircraft heading. (3) Touch: one finger orbits around the aircraft, two fingers pinch the distance, the view eases back behind the aircraft ~2.5 s after release (Cesium's own controller is off while chasing, it used to fight the lock). (4) Chase frames always request a render (phones run `requestRenderMode`). Tests: `tests/chase-paused.js` (Quin's exact sequence: feed paused / 0 AC -> My Planes -> N28027 last flight -> chase at once / paused at start / playing / from a far camera, plane screen position asserted) and `tests/chase-follow.js` (10 time points + 30/120/600x + pause/scrub/end/tab-sleep/touch, plane stays in the central region and behind the aircraft, N28027 and N291KY).

**v1.3.1 — chase cam fix.** On iPhone the aircraft sat at screen centre, i.e. directly behind the replay bar and the half-open bottom sheet (invisible chase target): the sheet now drops to its peek height when chase starts and the view is tilted so the aircraft sits in the middle of the visible globe. Second cause: the replay chase camera smoothed its heading in *screen* time while the aircraft turns in *flight* time, so at the 30x default (and especially 120x-600x) the camera lagged tens of degrees in every turn (up to 120-160 deg: viewing the plane from the front), whipped through whole turns after a scrub, and could spin at 600 deg/s on pattern work (the old code also used the unwrapped heading difference, so a scrub across several circuits swung through hundreds of degrees). Now: shortest-angle follow whose rate scales with playback speed, a capped slew rate, snap on scrub/restart, a long-chord heading target above 30x, and a post-lookAt terrain-clearance pass. Hardening: NaN/undefined guards in the camera, `update()` and `flightpath.js`; the render-loop callback can no longer stop Cesium (errors are contained, after 5 in a row replay exits with a note); outlier filter can no longer drop a whole flight after one bad first fix or missing ground speed; tail livery model failure falls back to the generic type model; "Last flight" skips stub flights (<8 reports / <90 s), reports history-fetch failures separately from "no flights", and says so when data is sparse or unusable. Tests: `tests/lastflight.js` (real UI flow, camera/NaN/clearance/heading/spin at several speeds, scrub), `tests/chase-fuzz.js` (touch-and-go, no-ground, tiny, NaN, stationary, empty traces + blocked tail glb), `tests/fuzz-path.mjs` (every real flight + synthetic cases through `flightpath.js`).

**Limits of the replay.** Positions are ADS-B reports (5-13 s apart) smoothed, not recorded 30 Hz flight data; the exact touchdown point/time and pitch/bank are derived estimates, not measured attitude. If no runway is found, no centreline snap is applied. Terrain at the airport is the 30-m-class SRTM/3DEP mesh, so field elevation can be off by a few metres.

## Data sources (all free, no keys)
* NOAA MRMS (mrms.ncep.noaa.gov/2D) radar + echo tops; Open-Meteo HRRR/GFS pressure-level forecasts; aviationweather.gov METAR/TAF/PIREP/G-AIRMET/SIGMET/CWA (all through the proxy).
| Need | Source | Via |
|---|---|---|
| Live aircraft (radius, military, hex lists) | adsb.lol v2 → adsb.fi → airplanes.live fallback | proxy |
| 24 h traces, flight history, replay | ADS-B Exchange trace files (needs Referer; best effort) | proxy |
| Airspace B/C/D, runways, heliports, airports (US) | FAA AIS ArcGIS feature services | direct (CORS ok) |
| TFRs | FAA TFR WFS + per-NOTAM detail XML for altitudes | proxy |
| AIRMET/SIGMET | aviationweather.gov (G-AIRMET + SIGMET) | proxy |
| Radar | RainViewer (global) or IEM NEXRAD (US) | direct |
| Aircraft type/owner | hexdb.io | proxy |
| Imagery | Esri World Imagery, OSM, CARTO dark/light | direct |
| Terrain | AWS Terrain Tiles (Terrarium), decoded in-browser by a custom Cesium terrain provider — no ion token | direct |

### Credits
Aircraft models: amvlab aircraft-models (CC BY 4.0, https://github.com/amvlab/aircraft-models) for A320/B737/B787/A350/A380; all other models CC0 (this repo).

### Earth-detail data credits
Esri World Imagery (Esri, Maxar, Earthstar Geographics, USDA FSA, USGS, AeroGRID, IGN, GIS User Community) · USGS The National Map (public domain) · Sentinel-2 cloudless © EOX IT Services GmbH, contains modified Copernicus Sentinel data 2020 (CC BY-NC-SA 4.0; free for this personal, non-commercial use) · NASA GIBS / VIIRS Black Marble (NASA, public domain) · Terrain: Mapzen / AWS Terrain Tiles (SRTM, NED, GMTED, ETOPO1 and others) · Buildings: © OpenStreetMap contributors, ODbL 1.0 · Runways: FAA AIS.

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
- Terrain has no global geoid correction; replay anchors the aircraft to terrain at departure/arrival instead, while live traffic (MSL baro) can still look a few tens of metres off. Airport/airspace are US-only.
- Military aircraft that don't broadcast ADS-B can't be shown; masked aircraft appear only if they transmit.
- The Cloudflare Worker is tested locally (workerd) but not yet deployed or load-tested on Cloudflare's edge.
- Not benchmarked on real GPUs or iOS Safari.

## Hosting
**Render (current):** `render.yaml` / `node server.js` with `HOST=0.0.0.0` on the free plan — it sleeps after ~15 min idle (first request wakes it in ~30–60 s) and shares one IP, hence the rate-limit design above. The Cloudflare Worker below does not yet include the fallback chain.

## Optional: one Cloudflare Worker (app + proxy, same origin)
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

`node tests/replay.js [url] [mobile]` replays a real trace with the chase cam; `tests/replay-metrics.mjs`, `tests/banner.js`, `tests/models-close.js`, `tests/models-mobile.js` cover replay smoothness, banner and models.

## Layout
`server.js` local proxy+static · `worker/index.js` + `wrangler.jsonc` Cloudflare Worker · `scripts-build-dist.sh` · `index.html` · `css/` · `js/` (globe, traffic, traces, layers, alerts, replay, reports, ui, main) · `sw.js` + `manifest.webmanifest` + `icons/` · `worker/` · `tests/` · `docs/screenshots/`

## v1.4 — 3D chase replay from Time Travel, 7-day flight picker
- **Time Travel → 3D:** tap a tracked aircraft's marker (or **CHASE / 3D** on the replay bar, or the per-aircraft buttons in the Time tab). SkyDeck splits that aircraft's track for the day into flights and opens the smoothed 3D replay (model and chase cam) for the flight nearest the current Time Travel clock. If there are several flights that day, you pick one, with the nearest preselected.
- **Last flight picker:** "Last flight" on a plane's card lists every usable flight from the last 7 days, newest first. Each row shows the date, the local times, from → to (the nearest FAA airport when the flight starts or ends on the ground; ◐ = in the air at first or last contact), the duration and the max altitude.
- The chase cam still cancels the fly-in and snaps onto the aircraft at once. The service-worker cache is skydeck-v9. Test: `tests/travel-chase.js [url] [day] [hex] [reg]`.

