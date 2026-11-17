# shellcheck shell=sh
# deploy.sh runs on the server as the environment's own user (voidmarch-<env>,
# rootless Podman, lingering on), started by .github/scripts/deploy-ssh.sh,
# which has copied this script and the environment's unit into ~/$DEPLOY_DIR,
# a folder of the run's own. It reads:
#   DEPLOY_ENV   production, staging, development or development-preview
#   DEPLOY_DIR   that folder, under the home: voidmarch-deploy/<id>
#   IMAGE        the image pinned to its digest: ghcr.io/...@sha256:...
#   PR_NUMBER    the pull request, for development-preview
#
# It checks the unit with the server's own Quadlet, pulls the image, installs
# the unit as ~/.config/containers/systemd/voidmarch.container, restarts
# voidmarch.service and waits until the server answers on its port. Anything
# failing before the restart leaves the running server as it was. The run's
# folder is removed in any case.
# POSIX sh: the login shell is the server's.
set -eu
set -f

HEALTH_TRIES="${HEALTH_TRIES:-36}"
HEALTH_SLEEP="${HEALTH_SLEEP:-5}"
UNITS="$HOME/.config/containers/systemd"
DATA="$HOME/data"
QUADLET="${QUADLET:-/usr/libexec/podman/quadlet}"

die() {
  echo "error: $*" >&2
  exit 1
}

# Only a run's own folder, so the trap below never removes anything else.
case "${DEPLOY_DIR:-}" in
  voidmarch-deploy/*) ;;
  *) die "DEPLOY_DIR is not voidmarch-deploy/<id>: '${DEPLOY_DIR:-}'" ;;
esac
case "${DEPLOY_DIR#voidmarch-deploy/}" in
  "" | *[!A-Za-z0-9-]*) die "DEPLOY_DIR is not voidmarch-deploy/<id>: '$DEPLOY_DIR'" ;;
esac
SRC="$HOME/$DEPLOY_DIR"
trap 'rm -rf "$SRC"' EXIT

case "${DEPLOY_ENV:-}" in
  production | staging | development) ;;
  development-preview)
    case "${PR_NUMBER:-}" in
      "" | *[!0-9]*) die "PR_NUMBER is not a number: '${PR_NUMBER:-}'" ;;
    esac
    ;;
  *) die "DEPLOY_ENV is not production, staging, development or development-preview: '${DEPLOY_ENV:-}'" ;;
esac
case "${IMAGE:-}" in
  ghcr.io/*@sha256:*) ;;
  *) die "IMAGE is not ghcr.io/...@sha256:...: '${IMAGE:-}'" ;;
esac
digest="${IMAGE#*@sha256:}"
[ "${#digest}" -eq 64 ] || die "IMAGE has no sha256 digest: '$IMAGE'"
case "$digest${IMAGE%%@*}" in
  *[!a-z0-9./_-]*) die "IMAGE holds an unexpected character: '$IMAGE'" ;;
esac

unit="$DEPLOY_ENV.container"
[ -f "$SRC/$unit" ] || die "$SRC/$unit is missing"

: "${XDG_RUNTIME_DIR:=/run/user/$(id -u)}"
export XDG_RUNTIME_DIR
cd "$HOME"
# A deploy waits for the one running (on development: main's and a preview's).
exec 9> .deploy.lock
flock -w 900 9
# A run whose deploy never started leaves its upload; none is a day old.
find "$HOME/voidmarch-deploy" -mindepth 1 -maxdepth 1 -type d -mmin +1440 -exec rm -rf {} + 2> /dev/null || true

umask 077
tmp="$(mktemp -d "$HOME/.deploy.XXXXXX")"
trap 'rm -rf "$tmp" "$SRC"' EXIT
mkdir "$tmp/units"

grep -qx 'Image=@IMAGE@' "$SRC/$unit" || die "no Image=@IMAGE@ in $unit"
sed "s|^Image=@IMAGE@\$|Image=$IMAGE|" "$SRC/$unit" > "$tmp/units/voidmarch.container"
if grep -q '@[A-Z_]*@' "$tmp/units/voidmarch.container"; then
  die "$unit has a value deploy.sh does not fill in"
fi
port="$(sed -n 's/^PublishPort=127\.0\.0\.1:\([0-9]*\):8080$/\1/p' "$tmp/units/voidmarch.container")"
[ -n "$port" ] || die "no PublishPort=127.0.0.1:<port>:8080 in $unit"
# The server's Podman must accept the unit before anything else happens.
if ! QUADLET_UNIT_DIRS="$tmp/units" "$QUADLET" -dryrun -user > "$tmp/quadlet.out" 2>&1; then
  cat "$tmp/quadlet.out" >&2
  die "this server's Quadlet rejects the unit; nothing was changed"
fi

# Public on GHCR: pulled without a login. Already here (a redeploy): no pull.
if ! podman image exists "$IMAGE"; then
  podman pull --quiet "$IMAGE" > /dev/null
fi

# The database. A preview gets its own folder, emptied when the slot switches
# to another pull request; main's folder is never touched by a preview.
case "$DEPLOY_ENV" in
  development-preview)
    if [ "$(cat .pr 2> /dev/null || true)" != "$PR_NUMBER" ]; then
      echo "The development slot switches to pull request #$PR_NUMBER: its preview starts from an empty database."
      systemctl --user stop voidmarch.service 2> /dev/null || true
      # :U made the files the container user's, which is this user: no podman unshare needed.
      rm -rf "$DATA/preview"
    fi
    mkdir -p "$DATA/preview"
    ;;
  development)
    # Takes the slot back; that pull request's next preview starts empty.
    rm -f .pr
    mkdir -p "$DATA/voidmarch"
    ;;
  *)
    mkdir -p "$DATA/voidmarch"
    ;;
esac

mkdir -p "$UNITS"
chmod 644 "$tmp/units/voidmarch.container"
mv -f "$tmp/units/voidmarch.container" "$UNITS/voidmarch.container"
if [ "$DEPLOY_ENV" = development-preview ]; then
  echo "$PR_NUMBER" > .pr
fi
systemctl --user daemon-reload
systemctl --user restart voidmarch.service

i=0
until curl -fsS --max-time 5 "http://127.0.0.1:$port/healthz" > /dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge "$HEALTH_TRIES" ]; then
    systemctl --user status voidmarch.service --no-pager --lines=0 >&2 || true
    die "the server is not healthy on 127.0.0.1:$port after $((HEALTH_TRIES * HEALTH_SLEEP))s: journalctl --user -u voidmarch on the server"
  fi
  sleep "$HEALTH_SLEEP"
done
echo "Voidmarch $DEPLOY_ENV is healthy on 127.0.0.1:$port ($IMAGE)."
