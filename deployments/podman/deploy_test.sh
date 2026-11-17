#!/usr/bin/env bash
# deploy_test.sh: runs deploy.sh in a temporary home against stub podman,
# systemctl, curl, flock and Quadlet, and checks what it installs and runs.
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
digest="sha256:$(printf '%064d' 0)"
image="ghcr.io/starquake/voidmarch@$digest"
failed=0

fail() {
  echo "FAIL: $*" >&2
  failed=1
}

# setup makes a home with stubs that log their arguments to ~/calls.
setup() {
  home="$(mktemp -d)"
  mkdir -p "$home/bin"
  # shellcheck disable=SC2016 # the stubs expand their own arguments
  for cmd in systemctl flock; do
    printf '#!/bin/sh\necho "%s $*" >> "$HOME/calls"\n' "$cmd" > "$home/bin/$cmd"
  done
  # The image is never here yet, so deploy.sh pulls it.
  cat > "$home/bin/podman" <<'STUB'
#!/bin/sh
echo "podman $*" >> "$HOME/calls"
[ "$1" != image ]
STUB
  printf '#!/bin/sh\nexit 0\n' > "$home/bin/curl"
  cat > "$home/bin/quadlet" <<'STUB'
#!/bin/sh
echo "quadlet $*" >> "$HOME/calls"
exit "${QUADLET_EXIT:-0}"
STUB
  chmod +x "$home/bin/"*
}

# upload ENV ID: what deploy-ssh.sh would have copied into the home.
upload() {
  mkdir -p "$home/voidmarch-deploy/$2"
  cp "$here/deploy.sh" "$here/$1.container" "$home/voidmarch-deploy/$2/"
}

# deploy ENV ID [VAR=value...]: runs the uploaded deploy.sh.
deploy() {
  local env="$1" id="$2"
  shift 2
  env HOME="$home" PATH="$home/bin:$PATH" XDG_RUNTIME_DIR="$home" QUADLET="$home/bin/quadlet" \
    HEALTH_SLEEP=0 DEPLOY_ENV="$env" DEPLOY_DIR="voidmarch-deploy/$id" IMAGE="$image" "$@" \
    sh "$home/voidmarch-deploy/$id/deploy.sh" > "$home/out" 2>&1
}

unit() {
  echo "$home/.config/containers/systemd/voidmarch.container"
}

for env in production staging development; do
  setup
  upload "$env" run1
  if ! deploy "$env" run1; then
    fail "$env: deploy.sh failed: $(cat "$home/out")"
  fi
  if ! grep -qx "Image=$image" "$(unit)"; then
    fail "$env: the installed unit has no Image=$image"
  fi
  if ! grep -q "^podman pull --quiet $image" "$home/calls"; then
    fail "$env: the image was not pulled"
  fi
  if [[ "$(grep ^systemctl "$home/calls")" != $'systemctl --user daemon-reload\nsystemctl --user restart voidmarch.service' ]]; then
    fail "$env: systemctl calls = '$(grep ^systemctl "$home/calls")', want daemon-reload then restart"
  fi
  if [[ ! -d "$home/data/voidmarch" ]]; then
    fail "$env: ~/data/voidmarch was not made"
  fi
  if [[ -e "$home/voidmarch-deploy/run1" ]]; then
    fail "$env: the upload was left behind"
  fi
  rm -rf "$home"
done

setup
upload staging run1
if deploy staging run1 IMAGE=ghcr.io/starquake/voidmarch:edge; then
  fail "deploy.sh accepted an image without a digest"
fi
if [[ -e "$(unit)" || -e "$home/calls" ]]; then
  fail "deploy.sh went on after a bad image"
fi
if [[ -e "$home/voidmarch-deploy/run1" ]]; then
  fail "the upload was left behind after a bad image"
fi
rm -rf "$home"

setup
upload staging run1
if deploy staging run1 QUADLET_EXIT=1; then
  fail "deploy.sh went on after Quadlet rejected the unit"
fi
if [[ -e "$(unit)" ]] || grep -q "^systemctl\|^podman pull" "$home/calls"; then
  fail "deploy.sh changed something after Quadlet rejected the unit"
fi
rm -rf "$home"

setup
mkdir -p "$home/elsewhere"
if env HOME="$home" PATH="$home/bin:$PATH" DEPLOY_ENV=staging DEPLOY_DIR=elsewhere IMAGE="$image" \
  sh "$here/deploy.sh" > /dev/null 2>&1; then
  fail "deploy.sh accepted a DEPLOY_DIR outside voidmarch-deploy/"
fi
if [[ ! -d "$home/elsewhere" ]]; then
  fail "deploy.sh removed a DEPLOY_DIR outside voidmarch-deploy/"
fi
rm -rf "$home"

# The preview handover: a pull request's database is its own, kept while the
# slot stays with it, emptied for another one; main's is never touched.
setup
upload development main1
deploy development main1 || fail "development: $(cat "$home/out")"
touch "$home/data/voidmarch/main-marker"
upload development-preview pr1
deploy development-preview pr1 PR_NUMBER=7 || fail "preview #7: $(cat "$home/out")"
if ! grep -qx 'Volume=%h/data/preview:/data:Z,U' "$(unit)"; then
  fail "the preview's unit does not mount ~/data/preview"
fi
[[ "$(cat "$home/.pr")" == 7 ]] || fail ".pr is not 7 after preview #7"
touch "$home/data/preview/pr-marker"
upload development-preview pr2
deploy development-preview pr2 PR_NUMBER=7 || fail "preview #7 again: $(cat "$home/out")"
[[ -e "$home/data/preview/pr-marker" ]] || fail "redeploying preview #7 emptied its database"
upload development-preview pr3
deploy development-preview pr3 PR_NUMBER=8 || fail "preview #8: $(cat "$home/out")"
[[ ! -e "$home/data/preview/pr-marker" ]] || fail "switching to preview #8 kept #7's database"
upload development main2
deploy development main2 || fail "development again: $(cat "$home/out")"
[[ ! -e "$home/.pr" ]] || fail "main's deploy left .pr"
[[ -e "$home/data/voidmarch/main-marker" ]] || fail "the previews touched main's database"
if ! grep -qx 'Volume=%h/data/voidmarch:/data:Z,U' "$(unit)"; then
  fail "main's deploy did not put back main's unit"
fi
upload development-preview pr4
if deploy development-preview pr4 PR_NUMBER=; then
  fail "a preview without PR_NUMBER deployed"
fi
rm -rf "$home"

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi
echo "deploy.sh: ok"
