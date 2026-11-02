#!/usr/bin/env bash
# Runs Readbit's end-to-end tests against a local copy: fake Gutenberg/LibriVox on :9000,
# the app on :8787 (wrangler dev + local D1), headless Chromium via Playwright.
# Needs: Node 20+, Python 3 with `pip install playwright` and `playwright install chromium`.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/tests/output"; WORK="$OUT/app"
rm -rf "$OUT"; mkdir -p "$WORK"
cleanup() { kill $MOCK $DEV 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

# 1. a throwaway copy of the app with test settings (your own files are not touched)
cp -r "$ROOT/src" "$ROOT/public" "$ROOT/setup" "$ROOT/schema.sql" "$ROOT/package.json" "$ROOT/wrangler.jsonc" "$WORK/"
ln -s "$ROOT/node_modules" "$WORK/node_modules"
rm -rf "$WORK/public/catalog"
HASH=$(node -e "const c=require('crypto');const s=c.randomBytes(16);console.log('pbkdf2\$100000\$'+s.toString('base64')+'\$'+c.pbkdf2Sync('test pass 123',s,100000,32,'sha256').toString('base64'))")
printf "PASS_HASH='%s'\nGUTENBERG='http://127.0.0.1:9000'\nLIBRIVOX='http://127.0.0.1:9000'\n" "$HASH" > "$WORK/.dev.vars"

# 2. fake catalog + services
python3 "$ROOT/tests/make_test_catalog.py" "$OUT/rdf-files.tar.bz2" >/dev/null
(cd "$WORK" && node setup/build-catalog.mjs "$OUT/rdf-files.tar.bz2" >/dev/null) || { echo "catalog build failed"; exit 1; }
python3 "$ROOT/tests/fake_services.py" & MOCK=$!
(cd "$WORK" && npx wrangler d1 execute readbit --local --file=schema.sql >/dev/null 2>&1)
(cd "$WORK" && npx wrangler dev --port 8787 --ip 127.0.0.1 >"$OUT/server.log" 2>&1) & DEV=$!
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:8787/ && break; sleep 1; done

# 3. tests, each on fresh data
reset() { (cd "$WORK" && npx wrangler d1 execute readbit --local --command "DELETE FROM state; DELETE FROM sessions; DELETE FROM attempts;" >/dev/null 2>&1); }
FAILED=0
for t in test_flow test_regressions test_swipe test_wheel; do
  reset
  echo "=== $t"
  if python3 "$ROOT/tests/$t.py" "$OUT" 2>&1 | grep -E "^(PASS|FAIL)|Error"; [ "${PIPESTATUS[0]}" -ne 0 ]; then FAILED=1; echo "--- $t FAILED"; fi
done
[ $FAILED -eq 0 ] && echo "All tests passed." || echo "Some tests failed (server log: tests/output/server.log)."
exit $FAILED
