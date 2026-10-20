# SkyDeck changelog

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
