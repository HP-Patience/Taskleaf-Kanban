#!/usr/bin/env bash
# Isolated release control-flow tests. No SSH, sudo, npm install or real service calls.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
mkdir -p "$root/work"
testdir=$(mktemp -d "$root/work/deploy-test.XXXXXXXX")
mkdir "$testdir/bin"
cat > "$testdir/bin/npm" <<'MOCK'
#!/usr/bin/env bash
set -eu
[[ "$*" == *'--offline'* && "$*" == *'--ignore-scripts'* && "$*" == *'--omit=dev'* ]]
[[ "${TEST_MODE:-}" != install-failure ]]
MOCK
cat > "$testdir/bin/node" <<'MOCK'
#!/usr/bin/env bash
[[ "${TEST_MODE:-}" != import-failure ]]
MOCK
cat > "$testdir/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
set -eu
[[ "$*" == '-n /usr/bin/systemctl restart taskleaf' ]]
if [[ "${TEST_MODE:-}" == restart-failure && "$(readlink -f "$TASKLEAF_DEPLOY_ROOT/current")" != */previous ]]; then exit 1; fi
MOCK
cat > "$testdir/bin/curl" <<'MOCK'
#!/usr/bin/env bash
if [[ "${TEST_MODE:-}" == health-failure && "$(readlink -f "$TASKLEAF_DEPLOY_ROOT/current")" != */previous ]]; then exit 1; fi
exit 0
MOCK
printf '#!/usr/bin/env bash\nexit 0\n' > "$testdir/bin/sleep"
chmod +x "$testdir/bin/"*
export PATH="$testdir/bin:$PATH"
id=1111111111111111111111111111111111111111-1-1
for mode in success install-failure import-failure restart-failure health-failure; do
  export TEST_MODE="$mode"
  export TASKLEAF_DEPLOY_ROOT="$testdir/$mode"
  mkdir -p "$TASKLEAF_DEPLOY_ROOT/releases/previous"
  release="$TASKLEAF_DEPLOY_ROOT/releases/$id"
  mkdir -p "$release/dist" "$release/server" "$release/src" "$release/bundle-cache/_cacache"
  touch "$release/server/server.js" "$release/src/schema.js"
  ln -s "$TASKLEAF_DEPLOY_ROOT/releases/previous" "$TASKLEAF_DEPLOY_ROOT/current"
  printf 'unchanged task data\n' > "$TASKLEAF_DEPLOY_ROOT/tasks-sentinel.json"
  status=0
  bash "$root/deploy/release.sh" "$id" > "$TASKLEAF_DEPLOY_ROOT/output.log" 2>&1 || status=$?
  target=$(readlink -f "$TASKLEAF_DEPLOY_ROOT/current")
  if [[ "$mode" == success ]]; then
    [[ "$status" -eq 0 && "$target" == "$release" ]]
  else
    [[ "$status" -ne 0 && "$target" == "$TASKLEAF_DEPLOY_ROOT/releases/previous" ]]
  fi
  [[ $(cat "$TASKLEAF_DEPLOY_ROOT/tasks-sentinel.json") == 'unchanged task data' ]]
  echo "PASS: $mode"
done
if bash "$root/deploy/release.sh" '../invalid' >/dev/null 2>&1; then echo 'Invalid release ID accepted'; exit 1; fi
echo 'PASS: invalid release id rejected'
# Keep only test fixtures in ignored work/ for inspection; never delete computed paths.
