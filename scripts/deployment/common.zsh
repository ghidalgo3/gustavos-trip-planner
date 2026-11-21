#!/usr/bin/env zsh
set -euo pipefail

: "${DEPLOYMENT_CONFIG:?Deployment configuration is missing}"

config() { jq -er ".$1 | strings | select(length > 0)" <<< "$DEPLOYMENT_CONFIG"; }
die() { print -ru2 -- "error: $*"; exit 1; }

publish_image() {
  local registry_name="$1" image_ref="$2"
  docker load --input "$RELEASE_STATE_DIR/image.tar.gz"
  docker tag tripplanner-api:release "$image_ref"
  az acr login --name "$registry_name" --only-show-errors
  docker push "$image_ref"
}

web_request() {
  local method="$1" site_id="$2" operation="$3"
  shift 3
  az rest --only-show-errors --method "$method" \
    --uri "${site_id}$operation?api-version=2023-12-01" "$@"
}

verify_revision() {
  local url="$1" revision="$2" response_headers
  for attempt in {1..24}; do
    if response_headers="$(curl -fsS --max-time 15 -D - -o /dev/null "$url/health?revision=$revision")" \
      && printf '%s\n' "$response_headers" | tr -d '\r' | grep -iFxq "X-Trip-Planner-Revision: $revision"; then
      return 0
    fi
    sleep 10
  done
  return 1
}
