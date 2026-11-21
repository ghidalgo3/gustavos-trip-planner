#!/usr/bin/env zsh
set -euo pipefail

source "${0:A:h}/common.zsh"
source "${0:A:h:h}/release-tasks/common.zsh"

registry_name="$(config registryName)"
site_id="$(config siteId)"
registry_host="$(config registryHost)"
export IMAGE_REF="$registry_host/tripplanner-api:release"
export WEB_APP_NAME="${site_id:t}"
export RESOURCE_GROUP="$(config resourceGroup)"
export WEB_APP_URL="https://$(web_request get "$site_id" "" --query properties.defaultHostName -o tsv)"

publish_image "$registry_name" "$IMAGE_REF" "$RESOURCE_GROUP"
web_request patch "$site_id" /config/web --body "$(jq -cn --arg image "$IMAGE_REF" \
  '{properties: {linuxFxVersion: ("DOCKER|" + $image), acrUseManagedIdentityCreds: true}}')" -o none
web_request post "$site_id" /restart -o none
verify_revision "$WEB_APP_URL" "$DEPLOYMENT_REVISION" || die "production is not serving $DEPLOYMENT_REVISION"

# The local release verifier also checks the SPA hash and production OAuth/MCP.
printf 'export IMAGE_REF=%q WEB_APP_NAME=%q WEB_APP_URL=%q RESOURCE_GROUP=%q\n' \
  "$IMAGE_REF" "$WEB_APP_NAME" "$WEB_APP_URL" "$RESOURCE_GROUP" > "$RELEASE_STATE_DIR/azure.zsh"
zsh "${0:A:h:h}/release-tasks/verify.zsh"
