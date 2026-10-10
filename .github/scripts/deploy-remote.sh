# shellcheck shell=sh
# deploy-remote.sh runs on the server through appleboy/ssh-action, which
# exports DEPLOY_DIR, COMPOSE_FILE, IMAGE_NAME, IMAGE_DIGEST and
# TRUSTED_PROXY_IPS first. The image is public, so the pull needs no login.
# POSIX sh: the login shell is the server's.
set -e

case "$IMAGE_DIGEST" in
  sha256:*) ;;
  *) echo "error: IMAGE_DIGEST is not a digest: '$IMAGE_DIGEST'" >&2; exit 1 ;;
esac
# The .env values are single-quoted.
case "$IMAGE_NAME$TRUSTED_PROXY_IPS" in
  *"'"*) echo "error: a value contains a single quote" >&2; exit 1 ;;
esac

cd ~/"$DEPLOY_DIR"
# Two deploys can reach this directory at once.
exec 9>.deploy.lock
flock -w 900 9
umask 077
cat > .env <<ENV
IMAGE_NAME='${IMAGE_NAME}'
IMAGE_DIGEST='${IMAGE_DIGEST}'
TRUSTED_PROXY_IPS='${TRUSTED_PROXY_IPS}'
ENV
cp -f "$COMPOSE_FILE" docker-compose.yml
docker compose pull
docker compose up -d
