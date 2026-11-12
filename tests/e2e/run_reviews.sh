#!/bin/sh
# The project lead's review switcher (app/js/reviews.js), on made-up copies of the demo review:
# two masters, the platform repo (no review.json) and a team repo. Then the Cloudflare section copy shows no switcher.
# Usage: tests/e2e/run_reviews.sh WORK_DIR
set -e
WORK="$1"; HERE="$(cd "$(dirname "$0")/../.." && pwd)"
rm -rf "$WORK"; mkdir -p "$WORK/repos" "$WORK/section"
for r in greylit-review-data cogimp-review-data cogimp-team; do
  mkdir -p "$WORK/repos/$r"; (cd "$HERE/app/demo" && tar -cf - .) | (cd "$WORK/repos/$r" && tar -xf -)
  python3 - "$WORK/repos/$r/review.json" "$r" <<'PY'
import json, sys
p, r = sys.argv[1], sys.argv[2]
o = json.load(open(p)); o["title"] = {"greylit-review-data": "Made-up grey literature review", "cogimp-review-data": "Made-up cognitive review", "cogimp-team": "Made-up team repo"}[r]
json.dump(o, open(p, "w"))
PY
done
mkdir -p "$WORK/repos/review-coder"; echo '{}' > "$WORK/repos/review-coder/package.json"
(cd "$HERE/app" && tar -cf - .) | (cd "$WORK/section" && tar -xf -)
printf "export const SECTION = {\"project\":\"cogimp\",\"title\":\"Made-up section\"};\n" > "$WORK/section/js/section.js"
R="$WORK/repos"
node "$HERE/tests/mock-github.mjs" --repos "joebtay/greylit-review-data=$R/greylit-review-data,joebtay/cogimp-review-data=$R/cogimp-review-data,joebtay/cogimp-team=$R/cogimp-team,joebtay/review-coder=$R/review-coder" 8791 > "$WORK/mock.log" 2>&1 & M=$!
python3 -m http.server 8766 --directory "$HERE/app" > "$WORK/http.log" 2>&1 & H=$!
python3 -m http.server 8768 --directory "$WORK/section" > "$WORK/http2.log" 2>&1 & H2=$!
sleep 2
set +e
SHOTS="${SHOTS:-$WORK}" python3 "$HERE/tests/e2e/reviews.py"; RC=$?
kill $M $H $H2 2>/dev/null || true; exit $RC
