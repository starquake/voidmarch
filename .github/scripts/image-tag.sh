#!/usr/bin/env bash
# image-tag.sh ENV REF: the image tag ENV deploys for the ref CI ran on, or
# for a manual run when REF is empty. Prints tag=<tag>.
#   staging:    main or manual -> edge; vX.Y.Z-rc.N -> X.Y.Z-rc.N
#   production: manual -> latest; vX.Y.Z -> X.Y.Z
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: image-tag.sh staging|production REF" >&2
  exit 2
fi
env="$1"
ref="$2"

case "$env" in
  staging)
    if [[ -z "$ref" || "$ref" == main ]]; then
      echo "tag=edge"
    elif [[ "$ref" =~ ^v([0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+)$ ]]; then
      echo "tag=${BASH_REMATCH[1]}"
    else
      echo "error: ${ref} is neither main nor a release candidate tag (vX.Y.Z-rc.N)" >&2
      exit 1
    fi
    ;;
  production)
    if [[ -z "$ref" ]]; then
      echo "tag=latest"
    elif [[ "$ref" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
      echo "tag=${BASH_REMATCH[1]}"
    else
      echo "error: ${ref} is not a release tag (vX.Y.Z)" >&2
      exit 1
    fi
    ;;
  *)
    echo "error: no image tag for environment ${env}" >&2
    exit 1
    ;;
esac
