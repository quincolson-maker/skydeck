#!/usr/bin/env python3
"""Cross-check the HRRR freezing level served by /api/wx/model against real radiosonde soundings (IEM RAOB, 12Z).  python3 tests/verify_wx.py [base_url]"""
import json, sys, urllib.request, datetime
base = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080'
get = lambda u: json.load(urllib.request.urlopen(u, timeout=60))
day = datetime.datetime.now(datetime.timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)
if day > datetime.datetime.now(datetime.timezone.utc): day -= datetime.timedelta(days=1)
for stn in ['KJAX', 'KBNA', 'KILX', 'KLZK']:
    try:
        r = get(f"https://mesonet.agron.iastate.edu/json/raob.py?ts={day:%Y%m%d%H%M}&station={stn}"); prof = r['profiles'][0]['profile']
        pts = [(p['hght'], p['tmpc']) for p in prof if p.get('hght') is not None and p.get('tmpc') is not None]
        z0 = next((h1 + (h2 - h1) * t1 / (t1 - t2) for (h1, t1), (h2, t2) in zip(pts, pts[1:]) if t1 > 0 >= t2), None)
        st = get(f"{base}/api/wx/stations?ids={stn}")[0]; lat, lon = st['lat'], st['lon']
        m = get(f"{base}/api/wx/model?w={lon-.5}&s={lat-.5}&e={lon+.5}&n={lat+.5}&nx=3&ny=3&t0={int(day.timestamp()*1000)}&hours=1")['pts'][4]['v']
        t700 = [x['tmpc'] for x in prof if x.get('pres') == 700]; t500 = [x['tmpc'] for x in prof if x.get('pres') == 500]
        print(f"{stn} {day:%Y-%m-%d %HZ}: 0C level sounding {z0:.0f} m vs HRRR {m['freezing_level_height'][0]:.0f} m | T700 {t700[0]} vs {m['temperature_700hPa'][0]} | T500 {t500[0]} vs {m['temperature_500hPa'][0]}")
    except Exception as e: print(stn, 'skipped:', e)
