# SkyDeck changelog




## 1.8.0 — 2026-10-20
- Real-type 3D models (Sketchfab, CC BY 4.0, original liveries kept): PC-12, C172, C182, Phenom 300, G650ER, Learjet 45, 737-800, A320, CRJ-900, plus an E175 stand-in (the A320 rescaled to E175 span and length).
  - Interiors were stripped, meshes simplified to about 8–31k triangles, textures resized to 512–1024 px WebP, and geometry Draco-compressed (47–484 KB each).
  - Each is re-oriented (nose +Z, up +Y) and scaled to its true wingspan.
- New CC0 models built from published dimensions: Citation CJ family (cj3), DA20/DA40 (da20), Challenger 300/350 (cl35), King Air 200 (be20).
- Type map with related types (C17x→C172, C18x/C20x→C182, LJxx→LJ45, B73x/B3xM→737-800, A319/A320/A321/neo→A320, CRJ2/7/9→CRJ-900, E170/E175/E190→E175, GLF/GLEX→G650, E50P/E55P/HDJT/PC24→Phenom). Category fallbacks are unchanged.
- N864RJ and N291KY now use the real PC-12 model. N28027 keeps its tail-specific PA-28.
- More › About & credits, plus CREDITS.md (CC BY attribution).
- Service-worker cache skydeck-v16.
## 1.7.0 — 2026-10-20
- Time Travel tab removed. Bottom bar: Planes · Search · Plan · JetBasket · More (Plan restored to its original spot).
- New aircraft action sheet: tap a plane on the map or a row in Planes → tail, type, live status, and Follow / Chase 3D, Previous flights, Last flight, Show on map, 24 h trace, Share (#ac= link), JetBasket profile, Watch + alerts.
- Previous flights: last 7 days by default plus an "Other date" picker (the date-choosing part of Time Travel); picking a flight opens the replay with chase cam and TKOF / LDG skip.
- Planes cards simplified to Chase 3D · Flights · Options.
- JetBasket is now its own full-screen page: map hidden, Cesium render loop paused while open, "‹ Map" back button, roomier layout; JetBasket tabs no longer clip.
- New Cinematic Export (🎬 on each flight in Previous flights and in the replay bar): pick 30 / 45 / 60 s; scripted eased chase camera with orbit and low angles near takeoff/landing, slow-motion takeoff/landing, sped-up cruise; warm/teal grade, letterbox, vignette, tail / alt / speed overlay. Recorded on the device (canvas.captureStream + MediaRecorder; MP4/H.264 where supported, WebM fallback), with progress, Share (file) and Download. Screen kept awake via Wake Lock. No server rendering.
- Service-worker cache skydeck-v15.
## 1.6.0 — 2026-10-20
- Simpler, phone-first navigation: bottom bar is now Planes · Search · Time Travel · JetBasket · More. Layers, Flight Plan, Lists, Alerts, Reports, Mil-Ops and Theme moved into the More menu (with one-line descriptions). Nothing removed.
- JetBasket: top tabs cut from 9 to 5 (Fleet · Radar · Pipeline · Contacts · Tools); Market, Transactions, Baskets, Value and Settings grouped under Tools.
- Theme button moved off the phone header into More.
- New: US state boundary lines (Natural Earth 1:50m, public domain, bundled as 49 KB GeoJSON, terrain-draped thin white lines). Toggle in More › Map layers, on by default.
- Service-worker cache skydeck-v14.
## 1.5.1
- **Shop airports for the radar**: a default list of 42 shops at 38 US airports, each checked on the company's or OEM's own locator page (Pilatus authorized service centers, Textron service centers, Elliott, Stevens, Duncan full-service facilities, Banyan, Cutter). Each entry has its category, the brands it serves, a source link and the date it was checked. In Settings you can switch any shop off or add your own. A landing at a shop airport in ADS-B history adds a +15 radar signal with the date, airport and shop as evidence.

## 1.5.0 — JetBasket
New **JetBasket** tab: free fleet and market intelligence built only on public data.
- **Fleet search** of the FAA Aircraft Registry (public, daily; about 318k US aircraft). Filter by model (aliases such as CJ3 → 525B), owner, year, state, city, registrant type and airworthiness date. Shows a summary (count, average age, by year, by state, top owners) and exports CSV.
- **Aircraft profile**: specs, engine, registrant and mailing address, certificate / airworthiness / expiration dates, other aircraft at the same owner address, earlier registrations of the airframe, and utilization from ADS-B history (7 or 30 days: flights, estimated hours, home-base guess, last seen). One tap to Track, Last flight, add to My Planes, add to a basket, Dossier or Pipeline, plus outbound links (FAA, ADS-B Exchange, FlightAware, Controller, AvBuyer).
- **Transactions**: recent certificates issued and deregistrations (3 years), plus owner-name changes found by diffing the registry file day to day (this history resets when the free server restarts).
- **Market**: fleet by build year, age distribution, certificates and deregistrations per month, top owners, states, an ADS-B activity sample, and public prices with their sources (AUCTION / ASKING / REPORT).
- **Baskets** with notes, document links, inspection due dates, registration-expiry warnings and a market watch (asking price, listing link, days on market, status history). CSV / PDF export.
- **Contacts (CRM)**: an owner contact is created automatically from the registry. You can add the role, phones, email, tags, notes and last-contacted date. Optionally look up a public business phone on OpenStreetMap (businesses only, with source and date). Links to OpenCorporates and state business records. Export / import JSON; data stays on the device.
- **Value**: a least-squares fit on your own comps (year, plus hours when you have enough), with the comps listed and a value-factor checklist. Public price points can be added as comps. No value is shown without comps.
- **Radar**: sale signals with their weights and evidence (registration expiring or expired, non-valid status code, recent certificate or LLC, owner change, dealer-type registrant, your listings, optional ADS-B inactivity and visits to your shop airports).
- **Pipeline**: deal board from Prospect to Closed / Lost, with expected price, commission %, totals, follow-up reminders and activity notes. Export / import JSON.
- **Dossier**: a one-tap aircraft report (specs, registry timeline, 7-day utilization with a track map, sourced prices, signals) saved via Print / Share as a PDF. Has a client-copy option that hides the owner.
- **Phone-append provider** setting: a generic adapter for a licensed skip-trace / data-append API. It stays disabled until you enter a key and flags DNC numbers.

## 1.4.2
- **METAR dots** (Layers → Aviation): a flight-category dot at each reporting airport in view (VFR green, MVFR blue, IFR red, LIFR magenta), with labels when you zoom in close. Tap a dot to see the raw METAR. The setting is remembered. Data comes from aviationweather.gov through the proxy (free, no key).

## 1.4.1
- Replay bar: **⇤ TKOF** and **LDG ⇥** jump straight to the takeoff roll or the final approach (from the ground/air transitions in the ADS-B reports).
- **Share** a replay: on iPhone this opens the iOS share sheet; elsewhere it copies the link. The link (`#rp=<hex>@<time>`) opens the same flight, with the chase cam on, for anyone who opens it.
- The "Install SkyDeck" banner no longer covers the replay controls during a replay or chase.

## 1.4.0
- Time Travel → tap a tracked plane → 3D chase replay of that flight; "Last flight" opens a 7-day flight picker with from → to.

## 1.3.2
- Chase cam snaps onto the aircraft at once (fly-in arc cancelled), follows the flown path, touch orbit then resume.
