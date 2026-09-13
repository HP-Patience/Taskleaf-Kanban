#!/usr/bin/env bash
set -euo pipefail
release_id="${1:?release id required}"
[[ "$release_id" =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || { echo 'Invalid release id'; exit 1; }
base=/opt/taskleaf
release="$base/releases/$release_id"
[[ -d "$release/dist" && -f "$release/server/server.js" && -f "$release/src/schema.js" ]] || { echo 'Incomplete release'; exit 1; }
previous=$(readlink -f "$base/current" 2>/dev/null || true)
if [[ -n "$previous" && "$previous" != "$base/current" ]]; then
  [[ "$previous" == "$base/releases/"* && -d "$previous" ]] || { echo 'Unexpected current target'; exit 1; }
else
  previous=''
fi
cd "$release"
npm ci --omit=dev
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
  if [[ -n "$previous" ]]; then
    ln -s "$previous" "$base/.rollback-$release_id"
    mv -Tf "$base/.rollback-$release_id" "$base/current"
    sudo -n /usr/bin/systemctl restart taskleaf
    healthy || echo 'Rollback health check failed; manual intervention required' >&2
  else
    echo 'No previous version exists; manual intervention required' >&2
  fi
  exit 1
fi
