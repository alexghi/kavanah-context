#!/usr/bin/env bash
# Builds the extension with the production URL baked in and zips it with the tester guide:
#   scripts/package-testers.sh            -> kavannah-testers-<version>.zip (repo root)
# Set WXT_BACKEND_URL to use another server than the Cloud Run one.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/apps/extension/package.json').version")"
URL="${WXT_BACKEND_URL:-$("$ROOT/deploy/cloudrun.sh" url)}"
echo "▶ building the extension for $URL"
(cd "$ROOT" && WXT_BACKEND_URL="$URL" npm run build --silent -w @kavannah/extension >/dev/null)
STAGE="$(mktemp -d)"
mkdir -p "$STAGE/kavannah"
cp -R "$ROOT/apps/extension/.output/chrome-mv3" "$STAGE/kavannah/extension"
cp "$ROOT/docs/testers/README.md" "$STAGE/kavannah/README.md"
cp -R "$ROOT/docs/testers/img" "$STAGE/kavannah/img"
OUT="$ROOT/kavannah-testers-$VERSION.zip"
rm -f "$OUT"
(cd "$STAGE" && zip -qr "$OUT" kavannah -x '*.DS_Store')
rm -rf "$STAGE"
echo "▶ $OUT ($(du -h "$OUT" | cut -f1))"
