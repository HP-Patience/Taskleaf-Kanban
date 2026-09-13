#!/usr/bin/env bash
# First installation only. Keep the application private until public access is agreed.
set -euo pipefail
if [[ "${1:-}" == '--help' ]]; then
  echo 'Usage: sudo bash bootstrap.sh /absolute/bundle-directory [--resume-after-deps]'
  echo 'Creates a fresh Taskleaf service and a loopback-only Nginx site. Never imports task data.'
  exit 0
fi
[[ $EUID -eq 0 ]] || { echo 'Run this script with sudo in your own SSH terminal.' >&2; exit 1; }
user="${SUDO_USER:-}"
[[ "$user" =~ ^[a-z_][a-z0-9_-]*$ && "$user" != root ]] || { echo 'Run sudo from the non-root deployment account.' >&2; exit 1; }
bundle=$(realpath "${1:?bundle directory required}")
[[ -d "$bundle" && -f "$bundle/release.tgz" && -f "$bundle/release.sha256" && -f "$bundle/release-id" ]] || { echo 'Incomplete bundle'; exit 1; }
release_id=$(cat "$bundle/release-id")
[[ "$release_id" =~ ^[a-f0-9]{40}-bootstrap-[0-9]{14}$ ]] || { echo 'Invalid release ID'; exit 1; }
mode="${2:-install}"
[[ "$mode" == install || "$mode" == --resume-after-deps ]] || { echo 'Unknown installation mode'; exit 1; }
base=/opt/taskleaf
release="$base/releases/$release_id"
site=/etc/nginx/conf.d/taskleaf.conf
for cmd in node npm nginx systemctl runuser install getent useradd tar curl ss sha256sum; do command -v "$cmd" >/dev/null; done
/usr/bin/node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if (!(major>=24 || (major===22 && minor>=12))) { throw Error("This bootstrap requires Node 22.12+ (22.x) or 24+"); }'
[[ -d /etc/nginx/conf.d ]] || { echo 'Expected Nginx conf.d directory is missing'; exit 1; }
grep -Eq '^[[:space:]]*include[[:space:]]+/etc/nginx/conf.d/\*\.conf;' /etc/nginx/nginx.conf || { echo 'Nginx does not include conf.d; inspect manually'; exit 1; }
# Refuse existing installations, even partial ones. Never clobber data or configuration.
if [[ "$mode" == install && ( -e "$base" || -L "$base" ) ]]; then
  echo 'Taskleaf directory already exists. Inspect before using a recovery mode.' >&2; exit 1
fi
for path in "$base/current" /var/lib/taskleaf /var/backups/taskleaf /etc/taskleaf /etc/systemd/system/taskleaf.service "$site"; do
  [[ ! -e "$path" && ! -L "$path" ]] || { echo "Already exists: $path. Inspect instead of rerunning installation." >&2; exit 1; }
done
if getent passwd taskleaf >/dev/null || getent group taskleaf >/dev/null; then echo 'taskleaf account/group already exists; inspect manually'; exit 1; fi
if ss -H -ltn '( sport = :3000 or sport = :8080 )' | grep -q .; then echo 'Port 3000 or 8080 is occupied'; exit 1; fi
nginx -t
(cd "$bundle" && sha256sum --check release.sha256)
# The archive is produced locally from this repository, not downloaded from strangers.
if tar -tzf "$bundle/release.tgz" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then echo 'Unsafe archive path'; exit 1; fi
trap 'echo "Initialization stopped. Do not rerun blindly: inspect the output and existing Taskleaf paths first. Other sites and task data were not intentionally changed." >&2' ERR
umask 022
if [[ "$mode" == install ]]; then
  install -d -m 0755 -o "$user" -g "$(id -gn "$user")" "$base" "$base/releases" "$release"
  runuser -u "$user" -- tar --no-same-owner --no-same-permissions -xzf "$bundle/release.tgz" -C "$release"
  # Do not install/upgrade the machine-wide runtime or run package scripts as root.
  runuser -u "$user" -- /bin/bash -c 'cd "$1" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund' _ "$release"
else
  # Only recover a dependency-stage failure, before any account/service/data setup.
  [[ -d "$release" && "$(realpath "$release")" == "$release" && "$(stat -c %U "$release")" == "$user" ]] || { echo 'Unexpected release path/owner'; exit 1; }
  # Verify every packaged source file, not only the lockfile. No re-extraction.
  while IFS= read -r entry; do
    [[ "$entry" == */ ]] && continue
    [[ -f "$release/$entry" && ! -L "$release/$entry" && "$(realpath "$release/$entry")" == "$release/$entry" ]] || { echo "Unexpected release file: $entry"; exit 1; }
    expected=$(tar -xOzf "$bundle/release.tgz" "$entry" | sha256sum | cut -d ' ' -f 1)
    actual=$(sha256sum "$release/$entry" | cut -d ' ' -f 1)
    [[ "$expected" == "$actual" ]] || { echo "Release file differs: $entry"; exit 1; }
  done < <(tar -tzf "$bundle/release.tgz")
  runuser -u "$user" -- /bin/bash -c 'cd "$1" && npm ls --omit=dev' _ "$release"
fi
[[ -f "$release/server/server.js" && -f "$release/dist/task-board.html" && -f "$release/deploy/taskleaf.service" && -f "$release/deploy/nginx.conf.example" ]]
runuser -u "$user" -- /usr/bin/node --input-type=module -e "await import('file://$release/server/server.js')"
useradd --system --user-group --home-dir /var/lib/taskleaf --no-create-home --shell /usr/sbin/nologin taskleaf
install -d -m 0700 -o taskleaf -g taskleaf /var/lib/taskleaf /var/backups/taskleaf
install -d -m 0700 -o root -g root /etc/taskleaf
# Loopback origin allowlist also permits the SSH tunnel's localhost URL.
umask 077
cat > /etc/taskleaf/taskleaf.env <<'ENV'
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DATA_FILE=/var/lib/taskleaf/tasks.json
BACKUP_DIR=/var/backups/taskleaf
ALLOWED_HOSTS=127.0.0.1:3000,127.0.0.1:8080,localhost:8080,127.0.0.1:18080,localhost:18080
ENV
install -m 0644 "$release/deploy/taskleaf.service" /etc/systemd/system/taskleaf.service
runuser -u "$user" -- ln -s "$release" "$base/current"
systemctl daemon-reload
systemctl start taskleaf
healthy=false
for attempt in {1..20}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:3000/api/health >/dev/null; then healthy=true; break; fi
  sleep 1
done
[[ "$healthy" == true ]] || { systemctl status taskleaf --no-pager || true; echo 'API health check failed'; exit 1; }
# Enable ONLY loopback clients. Preserve deny-all for all other sources.
sed '/^    deny all;/i\    allow 127.0.0.1;' "$release/deploy/nginx.conf.example" > "$site"
chmod 0644 "$site"
if ! nginx -t; then
  mv "$site" "$site.disabled-$release_id"
  echo 'New site disabled because Nginx validation failed; existing Nginx was not reloaded.' >&2
  exit 1
fi
systemctl reload nginx
curl --fail --silent --max-time 5 http://127.0.0.1:8080/api/health
curl --fail --silent --max-time 5 http://127.0.0.1:8080/task-board.html >/dev/null
systemctl enable taskleaf
printf '\nTaskleaf installed and verified on 127.0.0.1:8080 (server loopback only).\n'
printf 'No public port, firewall rule, CI secret or old task data was changed.\n'
printf 'Service: taskleaf | Data: /var/lib/taskleaf/tasks.json | Release: %s\n' "$release_id"
