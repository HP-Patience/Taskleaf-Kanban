#!/usr/bin/env bash
# Build must already have completed. Package only code and a dedicated npm cache.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
output="${1:?absolute output directory required}"
[[ "$output" == /* ]] || { echo 'Output directory must be absolute'; exit 1; }
mkdir -p "$output"
output=$(realpath "$output")
[[ ! -e "$output/release.tgz" ]] || { echo 'Output archive already exists'; exit 1; }
cd "$root"
[[ -f dist/task-board.html && -f package-lock.json ]]
stage=$(mktemp -d "$output/stage-XXXXXXXX")
mkdir "$stage/project"
cp package.json package-lock.json "$stage/project/"
# This cache is intentionally separate from any developer/global cache.
npm ci --prefix "$stage/project" --cache "$stage/npm-cache" --omit=dev --ignore-scripts --no-audit --no-fund
[[ -d "$stage/npm-cache/_cacache" ]]
mkdir "$stage/bundle-cache"
cp -R "$stage/npm-cache/_cacache" "$stage/bundle-cache/"
tar -czf "$output/release.tgz" \
  dist server src/schema.js scripts/backup.js scripts/restore.js \
  package.json package-lock.json deploy/release.sh \
  -C "$stage" bundle-cache
(cd "$output" && sha256sum release.tgz > release.sha256)
echo "Release bundle prepared: $output/release.tgz"
