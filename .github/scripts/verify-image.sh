#!/usr/bin/env bash
# verify-image.sh IMAGE_REF: resolves the tag to the digest the server pulls
# and checks that ci.yml signed it on main. Prints digest=<sha256:...>.
set -euo pipefail

image_ref="$1"
repo="${image_ref%:*}"

digest="$(docker buildx imagetools inspect "$image_ref" --format '{{.Manifest.Digest}}')"
if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "error: no digest for ${image_ref} (got '${digest}')" >&2
  exit 1
fi

cosign verify "${repo}@${digest}" \
  --certificate-identity-regexp '^https://github\.com/starquake/voidmarch/\.github/workflows/ci\.yml@refs/heads/main$' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' >/dev/null

echo "digest=${digest}"
