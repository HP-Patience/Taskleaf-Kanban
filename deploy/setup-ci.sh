#!/usr/bin/env bash
# One-time admin setup. Does not deploy code, restart services, or touch task data.
set -euo pipefail
if [[ "${1:-}" == --help ]]; then
  echo 'Usage: sudo bash setup-ci.sh /absolute/path/to/deploy-key.pub'
  echo 'Creates taskleaf-deploy and grants only the Taskleaf restart command.'
  exit 0
fi
[[ $EUID -eq 0 ]] || { echo 'Run with sudo in your SSH terminal'; exit 1; }
key="${1:?public key file required}"
[[ "$key" == /* && -f "$key" ]]
ssh-keygen -lf "$key" >/dev/null
[[ $(grep -c '^ssh-ed25519 ' "$key") -eq 1 && $(wc -l < "$key") -eq 1 ]] || { echo 'Expected a single Ed25519 public key'; exit 1; }
user=taskleaf-deploy
base=/opt/taskleaf
for path in "$base" "$base/releases"; do
  [[ -d "$path" && "$(realpath "$path")" == "$path" ]] || { echo 'Unexpected installation path'; exit 1; }
done
[[ -L "$base/current" && -f "$base/current/server/server.js" ]]
systemctl is-active --quiet taskleaf
[[ -f /etc/systemd/system/taskleaf.service ]]
grep -qx 'User=taskleaf' /etc/systemd/system/taskleaf.service
if getent passwd "$user" >/dev/null || getent group "$user" >/dev/null || [[ -e /home/taskleaf-deploy || -e /etc/sudoers.d/taskleaf-deploy ]]; then
  echo 'CI account or configuration already exists; inspect instead of overwriting'; exit 1
fi
# A dedicated account avoids exposing the owner's home and personal SSH identity.
umask 077
sudoers=$(mktemp)
printf '%s ALL=(root) NOPASSWD: /usr/bin/systemctl restart taskleaf\n' "$user" > "$sudoers"
visudo -cf "$sudoers"
trap 'echo "Setup stopped; inspect partial CI configuration before retrying. Existing service and task data were not changed." >&2' ERR
useradd --create-home --user-group --shell /bin/bash "$user"
chmod 0700 /home/taskleaf-deploy
install -d -m 0700 -o "$user" -g "$user" /home/taskleaf-deploy/.ssh
{ printf 'restrict '; cat "$key"; } > /home/taskleaf-deploy/.ssh/authorized_keys
chown "$user:$user" /home/taskleaf-deploy/.ssh/authorized_keys
chmod 0600 /home/taskleaf-deploy/.ssh/authorized_keys
install -m 0440 -o root -g root "$sudoers" /etc/sudoers.d/taskleaf-deploy
visudo -cf /etc/sudoers.d/taskleaf-deploy
# Transfer only these two directory entries, not old releases or server data.
chown "$user:$user" "$base" "$base/releases"
runuser -u "$user" -- test -w "$base"
runuser -u "$user" -- test -w "$base/releases"
runuser -u "$user" -- test -r "$base/current/server/server.js"
sudo -l -U "$user"
echo 'CI account ready; existing Taskleaf service was not restarted.'
echo 'Next: verify key login and runner connectivity before enabling DEPLOY_ENABLED.'
