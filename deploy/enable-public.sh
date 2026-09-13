#!/usr/bin/env bash
# Explicit opt-in only: publish an existing private bootstrap on HTTP port 8080.
set -euo pipefail
if [[ "${1:-}" == --help ]]; then
  echo 'Usage: sudo bash enable-public.sh PUBLIC_IPV4 --allow-anonymous-write'
  echo 'Publishes port 8080, preserves loopback API and task data. Does not configure cloud rules.'
  exit 0
fi
[[ $EUID -eq 0 ]] || { echo 'Run with sudo in your own SSH terminal'; exit 1; }
[[ $# -eq 2 && "$2" == --allow-anonymous-write ]] || { echo 'Explicit anonymous-write opt-in required'; exit 1; }
ip="$1"
/usr/bin/node -e 'if(require("node:net").isIP(process.argv[1])!==4) process.exit(1)' "$ip"
site=/etc/nginx/conf.d/taskleaf.conf
env=/etc/taskleaf/taskleaf.env
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source="$here/nginx.public.conf.example"
[[ -f "$source" && -f "$site" && ! -L "$site" && -f "$env" && ! -L "$env" ]]
# Keep loopback and primary NIC sockets separate so reload need not replace a
# live loopback socket with an overlapping wildcard socket.
local_ip=$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')
/usr/bin/node -e 'if(require("node:net").isIP(process.argv[1])!==4 || process.argv[1].startsWith("127.")) process.exit(1)' "$local_ip"
# Accept only our exact private bootstrap or the earlier public wildcard template.
# The latter permits repair after a reload failed to apply; custom sites are refused.
if ! cmp -s "$site" <(sed '/^    deny all;/i\    allow 127.0.0.1;' /opt/taskleaf/current/deploy/nginx.conf.example) &&
   ! cmp -s "$site" <(sed '/^    listen 127\.0\.0\.1:8080;$/d; s/SERVER_PRIVATE_IPV4/0.0.0.0/' "$source"); then
  echo 'Unexpected site configuration; inspect manually'; exit 1
fi
grep -qx 'HOST=127.0.0.1' "$env"
grep -qx 'PORT=3000' "$env"
[[ $(grep -c '^ALLOWED_HOSTS=' "$env") -eq 1 ]]
systemctl is-active --quiet taskleaf
nginx -t
# Preserve config only, never copy task data into the web root or release.
umask 077
backup=$(mktemp -d /etc/taskleaf/public-backup-XXXXXXXX)
cp -p "$site" "$backup/nginx.conf"
cp -p "$env" "$backup/taskleaf.env"
rollback() {
  trap - ERR
  set +e
  echo "Public setup failed; restoring configuration from $backup" >&2
  cp -p "$backup/nginx.conf" "$site"
  cp -p "$backup/taskleaf.env" "$env"
  systemctl restart taskleaf
  nginx -t && systemctl reload nginx
  echo 'Check service status before retrying. Task data was not rolled back.' >&2
  exit 1
}
trap rollback ERR
# Preserve all existing hosts, including SSH tunnel addresses. Never print the env file.
/usr/bin/node --input-type=module - "$env" "$ip:8080" <<'NODE'
import {readFileSync,writeFileSync} from 'node:fs';
const [file,host]=process.argv.slice(2);
const original=readFileSync(file,'utf8');
const updated=original.replace(/^ALLOWED_HOSTS=([^\r\n]*)/m,(_,value)=> {
  const hosts=value.split(',').map(x=>x.trim()).filter(Boolean);
  if (!hosts.includes(host)) hosts.push(host);
  return 'ALLOWED_HOSTS='+hosts.join(',');
});
writeFileSync(file,updated,{mode:0o600});
NODE
sed "s/SERVER_PRIVATE_IPV4/$local_ip/" "$source" > "$backup/new-nginx.conf"
install -m 0644 "$backup/new-nginx.conf" "$site"
nginx -t
systemctl restart taskleaf
healthy=false
for attempt in {1..20}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then healthy=true; break; fi
  sleep 1
done
[[ "$healthy" == true ]]
systemctl reload nginx
# A successful reload command only means the signal was sent. Require the new
# NIC listener AND a successful request to that NIC before reporting success.
listening=false
for attempt in {1..15}; do
  if ss -H -ltn | awk -v endpoint="$local_ip:8080" '$4==endpoint {found=1} END {exit !found}' &&
     curl -fsS --max-time 2 -H "Host: $ip:8080" "http://$local_ip:8080/api/health" >/dev/null 2>&1; then
    listening=true; break
  fi
  sleep 1
done
[[ "$listening" == true ]] || { echo 'NIC listener did not become ready' >&2; false; }
curl -fsS --max-time 5 -H "Host: $ip:8080" http://127.0.0.1:8080/api/health
curl -fsS --max-time 5 -H "Host: $ip:8080" http://127.0.0.1:8080/task-board.html >/dev/null
trap - ERR
# Do not enable/reset a firewall or change SSH/other applications' rules.
if command -v ufw >/dev/null; then
  ufw_state=$(LC_ALL=C ufw status)
  if grep -q '^Status: active' <<< "$ufw_state"; then
    ufw allow 8080/tcp
  else
    echo 'UFW is inactive; left unchanged.'
  fi
fi
printf '\nLocal checks passed. Public URL: http://%s:8080/task-board.html\n' "$ip"
echo 'Anonymous read/write enabled. API remains loopback-only; no task data modified.'
echo "Configuration backup: $backup"
echo 'Cloud security-group TCP 8080 ingress and external reachability still need verification.'
