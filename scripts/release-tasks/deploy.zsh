#!/usr/bin/env zsh
set -euo pipefail

source "${0:A:h}/common.zsh"

load_release_context

auth_parameters=(
  googleClientId="$GOOGLE_CLIENT_ID"
  microsoftClientId="$MICROSOFT_CLIENT_ID"
  mcpRedirectUri="${MCP_REDIRECT_URI:-https://chatgpt.com/connector_platform_oauth_redirect}"
)
IMAGE_TAG=release

log "Applying release configuration"
az deployment group create \
  --name "$CONFIG_DEPLOYMENT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --template-file infra/release.bicep \
  --parameters infra/release.bicepparam \
    namePrefix="$NAME_PREFIX" imageName="$IMAGE_NAME" imageTag="$IMAGE_TAG" \
    "${auth_parameters[@]}" \
  --output none
az webapp restart --resource-group "$RESOURCE_GROUP" --name "$WEB_APP_NAME" --output none

