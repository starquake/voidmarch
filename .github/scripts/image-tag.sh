#!/usr/bin/env bash
# image-tag.sh ENV REF: the image tag ENV deploys for the branch or tag REF.
# Prints tag=<tag>.
#   development: main -> edge
#   staging:     vX.Y.Z-rc.N -> X.Y.Z-rc.N
#   production:  vX.Y.Z -> X.Y.Z; empty (a manual run) -> latest
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: image-tag.sh development|staging|production REF" >&2
  exit 2
fi
env="$1"
ref="$2"

case "$env" in
  development)
    if [[ "$ref" == main ]]; then
      echo "tag=edge"
    else
      echo "error: development deploys main, not '${ref}'" >&2
      exit 1
    fi
    ;;
  staging)
    if [[ "$ref" =~ ^v([0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+)$ ]]; then
      echo "tag=${BASH_REMATCH[1]}"
    else
      echo "error: '${ref}' is not a release candidate tag (vX.Y.Z-rc.N)" >&2
      exit 1
    fi
    ;;
  production)
    if [[ -z "$ref" ]]; then
      echo "tag=latest"
    elif [[ "$ref" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
      echo "tag=${BASH_REMATCH[1]}"
    else
      echo "error: '${ref}' is not a release tag (vX.Y.Z)" >&2
      exit 1
    fi
    ;;
  *)
    echo "error: no image tag for environment '${env}'" >&2
    exit 1
    ;;
esac
