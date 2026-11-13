#!/usr/bin/env zsh
set -euo pipefail

source "${0:A:h}/common.zsh"

docker info >/dev/null 2>&1 || die "the Docker daemon is not running"
az account show >/dev/null 2>&1 || die "not signed in to Azure; run: az login"
az account set --subscription "$SUBSCRIPTION"

EXPECTED_TENANT_ID="${EXPECTED_TENANT_ID:-8ac19fe6-f2db-412e-9750-97a9772a6786}"
ACTUAL_TENANT_ID="$(az account show --query tenantId -o tsv)"
[[ "$ACTUAL_TENANT_ID" == "$EXPECTED_TENANT_ID" ]] || die \
  "subscription is in tenant $ACTUAL_TENANT_ID, expected personal tenant $EXPECTED_TENANT_ID"

log "Reading Azure infrastructure outputs"
deployment_outputs="$(az deployment group show \
  --name "$INFRA_DEPLOYMENT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.outputs --output json)" || die \
  "infrastructure deployment '$INFRA_DEPLOYMENT_NAME' was not found; run scripts/buildout first"

# Parse one response rather than making a network request for each output.
output_values=("${(@f)$(print -r -- "$deployment_outputs" | node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const outputs = JSON.parse(readFileSync(0, "utf8"));
  const keys = ["applicationInsightsName", "acrName", "acrLoginServer", "webAppName", "webAppUrl", "keyVaultName"];
  for (const key of keys) {
    const value = outputs[key]?.value;
    if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) {
      console.error(`Infrastructure output ${key} is missing or invalid; run scripts/buildout first`);
      process.exit(1);
    }
  }
  console.log(keys.map(key => outputs[key].value).join("\n"));
')}") || die "could not read infrastructure outputs; run scripts/buildout first"

APPLICATION_INSIGHTS_NAME="$output_values[1]"
ACR_NAME="$output_values[2]"
ACR_LOGIN_SERVER="$output_values[3]"
WEB_APP_NAME="$output_values[4]"
WEB_APP_URL="$output_values[5]"
KEY_VAULT_NAME="$output_values[6]"
IMAGE_REF="${ACR_LOGIN_SERVER}/${IMAGE_NAME}:release"

az resource show \
  --resource-group "$RESOURCE_GROUP" \
  --resource-type Microsoft.Insights/components \
  --name "$APPLICATION_INSIGHTS_NAME" \
  --output none || die \
  "cannot access Application Insights '$APPLICATION_INSIGHTS_NAME'; if missing, run scripts/buildout with the same resource group and name prefix, then retry scripts/release"

required_auth_secrets=(google-client-id google-client-secret microsoft-client-id microsoft-client-secret)
vault_secret_names=("${(@f)$(az keyvault secret list \
  --vault-name "$KEY_VAULT_NAME" \
  --query '[].name' \
  --output tsv)}") || die \
  "could not list secrets in Key Vault '$KEY_VAULT_NAME'; verify your RBAC access"
(( ${vault_secret_names[(Ie)ignav-api-key]} )) || die "Key Vault is missing ignav-api-key; run scripts/secrets --set-ignav"
(( ${vault_secret_names[(Ie)mcp-signing-certificate]} )) || die "Key Vault is missing mcp-signing-certificate; run scripts/secrets init-mcp"
available_auth_secrets=0
for secret_name in "${required_auth_secrets[@]}"; do
  if (( ${vault_secret_names[(Ie)$secret_name]} )); then
    available_auth_secrets=$((available_auth_secrets + 1))
  fi
done

if (( available_auth_secrets == ${#required_auth_secrets} )); then
  GOOGLE_CLIENT_ID="$(az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name google-client-id --query value -o tsv)"
  MICROSOFT_CLIENT_ID="$(az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name microsoft-client-id --query value -o tsv)"
else
  die "Key Vault has $available_auth_secrets of ${#required_auth_secrets} authentication credentials; run scripts/secrets set-auth"
fi

# Only public resource names and OAuth client IDs are shared with later stages.
# zsh's %q quotes values so they cannot become shell commands when loaded.
for context_name in ACR_NAME IMAGE_REF WEB_APP_NAME WEB_APP_URL GOOGLE_CLIENT_ID MICROSOFT_CLIENT_ID; do
  printf 'export %s=%q\n' "$context_name" "${(P)context_name}"
done > "$RELEASE_STATE_DIR/azure.zsh"
