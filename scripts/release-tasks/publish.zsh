#!/usr/bin/env zsh
set -euo pipefail

source "${0:A:h}/common.zsh"
source "${0:A:h}/git.zsh"

require_release_checkout "${RELEASE_COMMIT:?release commit is missing; run scripts/release}"

load_release_context

log "Publishing API container $IMAGE_REF"
az acr login --name "$ACR_NAME" --output none
docker tag "${IMAGE_NAME}:release" "$IMAGE_REF"
docker push "$IMAGE_REF"
