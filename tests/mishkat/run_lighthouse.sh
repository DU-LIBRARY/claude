#!/usr/bin/env bash
# Lighthouse (PWA, accessibility, best practices) against the Mishkāt web app served from the repo root.
#
# Usage:  tests/mishkat/run_lighthouse.sh [OUT_DIR]
#   OUT_DIR           where mishkat.report.json and mishkat.report.html go (default: $TMPDIR/mishkat-lighthouse)
#   LIGHTHOUSE_BIN    lighthouse executable (default: lighthouse on PATH)
#   CHROME_PATH       Chrome/Chromium binary (default: newest chrome under /opt/pw-browsers)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${1:-${OUT_DIR:-${TMPDIR:-/tmp}/mishkat-lighthouse}}"
LIGHTHOUSE_BIN="${LIGHTHOUSE_BIN:-lighthouse}"
mkdir -p "$OUT_DIR"

if [ -z "${CHROME_PATH:-}" ]; then
  CHROME_PATH="$(ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | sort -V | tail -n1 || true)"
  export CHROME_PATH
fi
[ -x "${CHROME_PATH:-/nonexistent}" ] || { echo "error: set CHROME_PATH to a Chrome binary" >&2; exit 1; }

PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$REPO" >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  curl -fsS "http://127.0.0.1:$PORT/mishkat/" >/dev/null 2>&1 && break
  sleep 0.2
done

"$LIGHTHOUSE_BIN" "http://127.0.0.1:$PORT/mishkat/" \
  --only-categories=pwa,accessibility,best-practices \
  --chrome-flags="--headless=new --no-sandbox" \
  --output=json --output=html \
  --output-path="$OUT_DIR/mishkat" \
  --quiet

echo "Lighthouse reports: $OUT_DIR/mishkat.report.json and $OUT_DIR/mishkat.report.html"
