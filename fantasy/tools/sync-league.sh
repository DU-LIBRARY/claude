#!/usr/bin/env bash
# Copy the league data from the du-library/skills repo into fantasy/data/league/.
# The app reads the live copy from GitHub first; this bundled copy is only the
# fallback for the very first offline visit. Usage: tools/sync-league.sh [path/to/skills/league]
set -euo pipefail
SRC="${1:-../skills/league}"
cd "$(dirname "$0")/.."
DST=data/league
mkdir -p "$DST/data" "$DST/fixtures"
cp "$SRC/league.json" "$DST/"
for f in squads matches goals appearances; do [ -f "$SRC/data/$f.json" ] && cp "$SRC/data/$f.json" "$DST/data/"; done
rm -f "$DST"/fixtures/week-*.json
cp "$SRC"/fixtures/week-*.json "$DST/fixtures/"
ls "$DST/fixtures" | sed -n 's/^week-\([0-9]*\)\.json$/\1/p' | awk '{print $1+0}' | sort -n | paste -sd, | sed 's/^/[/;s/$/]/' > "$DST/fixtures/index.json"
echo "league data copied to fantasy/$DST"
