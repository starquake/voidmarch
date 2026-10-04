# shellcheck shell=sh
# deploy-remote.sh runs on the server through appleboy/ssh-action, which
# exports DEPLOY_DIR, COMPOSE_FILE, IMAGE_NAME, IMAGE_DIGEST,
# TRUSTED_PROXY_IPS, GITHUB_TOKEN and GITHUB_ACTOR first. POSIX sh: the
# login shell is the server's.
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
umask 077
cat > .env <<ENV
IMAGE_NAME='${IMAGE_NAME}'
IMAGE_DIGEST='${IMAGE_DIGEST}'
TRUSTED_PROXY_IPS='${TRUSTED_PROXY_IPS}'
ENV
cp -f "$COMPOSE_FILE" docker-compose.yml
echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
docker compose pull
docker compose up -d
docker logout ghcr.io
