#!/usr/bin/env zsh
set -euo pipefail

source "${0:A:h}/common.zsh"

IMAGE_REF="${IMAGE_NAME}:release"
log "Building API container $IMAGE_REF"
catalog_hash="$(shasum -a 256 "$RELEASE_STATE_DIR/airports.json")"
gzip -n -c "$RELEASE_STATE_DIR/airports.json" > "$RELEASE_STATE_DIR/airports.json.gz"
catalog_args=(--secret "id=airport_catalog,src=$RELEASE_STATE_DIR/airports.json.gz" --build-arg "AIRPORT_CATALOG_SHA256=${catalog_hash%% *}")
if [[ -n "${DEPLOYMENT_REVISION:-}" ]]; then
  catalog_args+=(--build-arg "DEPLOYMENT_REVISION=$DEPLOYMENT_REVISION")
fi
if [[ -n "${NUGET_SOURCE:-}" ]]; then
  docker build \
    "${catalog_args[@]}" \
    --platform linux/amd64 \
    --build-arg "NUGET_SOURCE=$NUGET_SOURCE" \
    -f src/TripPlanner.Api/Dockerfile \
    -t "$IMAGE_REF" \
    .
else
  docker build \
    "${catalog_args[@]}" \
    --platform linux/amd64 \
    -f src/TripPlanner.Api/Dockerfile \
    -t "$IMAGE_REF" \
    .
fi
