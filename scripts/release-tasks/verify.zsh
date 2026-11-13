#!/usr/bin/env zsh
set -euo pipefail

source "${0:A:h}/common.zsh"

load_release_context
expected_index_hash="$(<"$RELEASE_STATE_DIR/index.sha256")"

HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-20}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-15}"
log "Waiting for API health and the published web build at $WEB_APP_URL"
api_ready=false
for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
  if curl -fsS --max-time 20 "${WEB_APP_URL}/health" >/dev/null 2>&1; then
    if served_index_hash="$(curl -fsS --max-time 20 \
      -H 'Cache-Control: no-cache' \
      "${WEB_APP_URL}/?release=${expected_index_hash}" | shasum -a 256)" \
      && [[ "${served_index_hash%% *}" == "$expected_index_hash" ]]; then
      api_ready=true
      break
    fi
  fi
  printf '  attempt %s/%s; retrying in %ss\n' "$attempt" "$HEALTH_ATTEMPTS" "$HEALTH_INTERVAL"
  sleep "$HEALTH_INTERVAL"
done
[[ "$api_ready" == true ]] || die \
  "API health or published web build did not become ready; run: az webapp log tail -g $RESOURCE_GROUP -n $WEB_APP_NAME"

curl -fsS --max-time 20 "$WEB_APP_URL" >/dev/null || die "web application did not respond at $WEB_APP_URL"
curl -fsS --max-time 20 "${WEB_APP_URL}/.well-known/oauth-protected-resource/mcp" >/dev/null \
  || die "MCP resource metadata is unavailable"
curl -fsS --max-time 20 "${WEB_APP_URL}/.well-known/openid-configuration" >/dev/null \
  || die "OAuth discovery is unavailable"
# Stateless MCP handles JSON-RPC POSTs, not browser GETs. Probe the actual
# transport so a website fallback cannot be mistaken for an authentication leak.
mcp_status="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  "${WEB_APP_URL}/mcp")" || die "MCP authentication probe could not reach ${WEB_APP_URL}/mcp"
[[ "$mcp_status" == 401 ]] || die "MCP must reject unauthenticated requests (received $mcp_status)"
printf '\nRelease complete.\n'
printf '  API image:  %s\n' "$IMAGE_REF"
printf '  Application: %s\n' "$WEB_APP_URL"
printf '  MCP server:  %s/mcp (OAuth client ID: chatgpt; no client secret)\n' "$WEB_APP_URL"
