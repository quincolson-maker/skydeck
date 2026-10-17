#!/bin/sh
# Fallback-chain test: SKYDECK_TEST=1 PORT=8091 node server.js &  then  sh tests/fallback.sh 8091
P=${1:-8091}; B=http://127.0.0.1:$P
q() { curl -s -D /tmp/fh.txt "$B/api/adsb/$1" -o /tmp/fb.json; python3 -c "
import json;j=json.load(open('/tmp/fb.json'));print('  ->',open('/tmp/fh.txt').readline().strip(),'| src:',(j.get('sky') or {}).get('src'),'| stale:',(j.get('sky') or {}).get('stale'),'| age:',(j.get('sky') or {}).get('age'),'| n:',len(j.get('ac',[])),'|',j.get('error') or (j.get('sky') or {}).get('note'))"; grep -i '^retry-after' /tmp/fh.txt; }
echo "1) normal";                         curl -s "$B/api/_test/fail?src=" >/dev/null;               q point/37.06/-88.77/60
echo "2) adsb.lol 429 -> adsb.fi";        curl -s "$B/api/_test/fail?src=adsb.lol" >/dev/null;       q point/38.5/-90.2/60
sleep 9; echo "3) lol+fi down, cache older than TTL -> stale-while-error"; curl -s "$B/api/_test/fail?src=adsb.lol,adsb.fi" >/dev/null; q point/37.06/-88.77/60
echo "4) all down, nothing cached -> 429 + Retry-After"; q point/10.0/10.0/60
echo "5) two near-identical viewport queries share one cache entry"; curl -s "$B/api/_test/fail?src=" >/dev/null; sleep 5; q point/40.01/-100.02/100; q point/40.06/-99.97/98
curl -s $B/api/ping | python3 -c "import sys,json;j=json.load(sys.stdin);print('misses',j['misses'],'hits',j['hits'],'stale',j.get('stale'))"
