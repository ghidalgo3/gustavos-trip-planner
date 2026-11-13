#!/usr/bin/env zsh
set -euo pipefail

source "${0:A:h}/common.zsh"

IMAGE_REF="${IMAGE_NAME}:release"
log "Building API container $IMAGE_REF"
if [[ -n "${NUGET_SOURCE:-}" ]]; then
  docker build \
    --platform linux/amd64 \
    --build-arg "NUGET_SOURCE=$NUGET_SOURCE" \
    -f src/TripPlanner.Api/Dockerfile \
    -t "$IMAGE_REF" \
    .
else
  docker build \
    --platform linux/amd64 \
    -f src/TripPlanner.Api/Dockerfile \
    -t "$IMAGE_REF" \
    .
fi
