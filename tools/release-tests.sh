#!/bin/bash
# Runs the release test suite against $1 (default local). Prints one RESULT line per test.
U=${1:-http://127.0.0.1:8080/}; cd "$(dirname "$0")/.."; fail=0
run() { local n=$1; shift; local o; o=$(timeout 420 "$@" 2>&1); local c=$?; local e=$(echo "$o" | grep -E "PASS|FAIL|errors:" | tail -2 | tr '\n' ' '); echo "RESULT $n exit=$c $e"; [ $c -ne 0 ] && { fail=1; echo "$o" | tail -15 > /tmp/rt-$n.log; }; }
run smoke node tests/smoke.js $U
run mobile node tests/mobile.js $U
run banner node tests/banner.js $U
run plan node tests/plan.js $U
run replay node tests/replay.js $U
run chase-paused-m node tests/chase-paused.js $U mobile
run travel-chase node tests/travel-chase.js $U
run replay-extras node tests/replay-extras.js $U
SPEEDS=30 run chase-follow-m node tests/chase-follow.js $U mobile a2d0b9 N28027
echo "SUITE $([ $fail = 0 ] && echo PASS || echo FAIL)"
