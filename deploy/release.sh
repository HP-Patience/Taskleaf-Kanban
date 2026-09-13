#!/usr/bin/env bash
set -euo pipefail
umask 022
release_id="${1:?release id required}"
[[ "$release_id" =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || { echo 'Invalid release id'; exit 1; }
# Alternate root is only for isolated deployment tests. CI uses /opt/taskleaf.
base="${TASKLEAF_DEPLOY_ROOT:-/opt/taskleaf}"
[[ "$base" == /* && "$(realpath "$base")" == "$base" ]] || { echo 'Unexpected base path'; exit 1; }
release="$base/releases/$release_id"
[[ -d "$release" && "$(realpath "$release")" == "$release" ]] || { echo 'Unexpected release path'; exit 1; }
[[ -d "$release/dist" && -f "$release/server/server.js" && -f "$release/src/schema.js" && -d "$release/bundle-cache/_cacache" ]] || { echo 'Incomplete release'; exit 1; }
[[ -L "$base/current" && -d "$base/current" ]] || { echo 'A working bootstrap installation is required'; exit 1; }
previous=$(readlink -f "$base/current")
[[ "$previous" == "$base/releases/"* && "$previous" != "$release" && -d "$previous" ]] || { echo 'Unexpected current target'; exit 1; }
cd "$release"
# Never download packages on the server; npm validates the lockfile/cache integrity.
npm ci --offline --cache "$release/bundle-cache" --omit=dev --ignore-scripts --no-audit --no-fund
node --input-type=module -e 'await import("./server/server.js")'
ln -s "$release" "$base/.current-$release_id"
mv -Tf "$base/.current-$release_id" "$base/current"
healthy() {
  for attempt in {1..20}; do
    if curl --fail --silent --max-time 2 http://127.0.0.1:3000/api/health >/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
if sudo -n /usr/bin/systemctl restart taskleaf && healthy; then
  echo "Deployment verified: $release_id"
else
  echo 'Deployment failed; rolling back code (data untouched)' >&2
  ln -s "$previous" "$base/.rollback-$release_id"
  mv -Tf "$base/.rollback-$release_id" "$base/current"
  if ! sudo -n /usr/bin/systemctl restart taskleaf || ! healthy; then
    echo 'Rollback health check failed; manual intervention required' >&2
  fi
  exit 1
fi
