#!/usr/bin/env zsh
set -euo pipefail

source "${0:A:h}/common.zsh"

slot_id="$(config slotId)"
slot_url="https://$(web_request get "$slot_id" "" --query properties.defaultHostName -o tsv)"
settings="$(web_request post "$slot_id" /config/appsettings/list -o json)"
previous_pr="$(jq -r '.properties.DEPLOYED_PR // ""' <<< "$settings")"
previous_revision="$(jq -r '.properties.DEPLOYED_REVISION // ""' <<< "$settings")"
previous_database="$(jq -r '.properties.PREVIEW_DATABASE // ""' <<< "$settings")"
pr_number="${PR_NUMBER:-$previous_pr}"

[[ -n "$pr_number" ]] || exit 0
[[ "$pr_number" =~ '^[0-9]+$' ]] || die 'invalid PR number'

login_url="$slot_url/.auth/login/aad?post_login_redirect_uri=%2F"
unauthenticated_access=false

verify_test_auth_policy() {
  web_request get "$slot_id" /config/authsettingsV2/list --query properties -o json |
    jq -e '.platform.enabled and .globalValidation.requireAuthentication
      and (.identityProviders.azureActiveDirectory.validation.defaultAuthorizationPolicy.allowedPrincipals.identities | length > 0)
      and .globalValidation.excludedPaths == ["/health"]' >/dev/null ||
    die 'the slot must require Entra authentication before attaching copied data'
}

verify_test_sign_in() {
  # App Service starts the authentication sidecar after the application responds.
  # Treat an unauthenticated success response as a failed check.
  local auth_ready=false auth_status=000 auth_response auth_redirect attempt
  print -r -- 'Waiting for Microsoft Entra sign-in on the test environment.'
  for attempt in {1..18}; do
    if auth_response="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code} %{redirect_url}' "$slot_url/")"; then
      auth_status="${auth_response%% *}"
      auth_redirect="${auth_response#* }"
      case "$auth_status" in
        2*)
          unauthenticated_access=true
          die 'test environment served a successful response without Entra authentication'
          ;;
        401|403)
          auth_redirect="$(curl -sS --max-time 10 -o /dev/null -w '%{redirect_url}' "$login_url")" || auth_redirect=''
          ;;
      esac
      if [[ "$auth_redirect" == "$slot_url/.auth/login/aad"* ||
            "$auth_redirect" == https://login.microsoftonline.com/* ]]; then
        auth_ready=true
        break
      fi
    fi
    sleep 10
  done
  [[ "$auth_ready" == true ]] || die "test environment sign-in did not become ready (HTTP $auth_status)"
}

report_test_ready() {
  printf '[Sign in to the test environment for PR #%s](%s)\n\nCommit `%s`\n' \
    "$pr_number" "$login_url" "$revision" >> "$GITHUB_STEP_SUMMARY"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf 'deployed=true\nlogin_url=%s\n' "$login_url" >> "$GITHUB_OUTPUT"
  fi
}

pr_details() { gh api "repos/$GITHUB_REPOSITORY/pulls/$pr_number"; }
pr="$(pr_details)"
if [[ "${EVENT_ACTION:-}" == announce ]]; then
  [[ "$pr_number" == "$previous_pr" ]] || die "PR #$pr_number is not running in the test environment"
  pr_head="${DEPLOYMENT_REVISION:?Missing PR head}"
  jq -e --arg sha "$pr_head" '.state == "open" and .head.sha == $sha' <<< "$pr" >/dev/null ||
    die "PR #$pr_number changed before the announcement"
  revision="$previous_revision"
  [[ "$revision" =~ '^[a-f0-9]{40}$' && -n "$previous_database" ]] ||
    die 'the test environment has no recorded deployment'
  gh api "repos/$GITHUB_REPOSITORY/git/commits/$revision" |
    jq -e --arg sha "$pr_head" '.parents[1].sha == $sha' >/dev/null ||
    die "the test environment is running an older commit for PR #$pr_number"
  verify_test_auth_policy
  verify_revision "$slot_url" "$revision" || die 'the test environment is not healthy'
  verify_test_sign_in
  report_test_ready
  exit 0
fi

if [[ "$(jq -r '.state' <<< "$pr")" == closed ]]; then
  if [[ "$pr_number" == "$previous_pr" ]]; then
    web_request post "$slot_id" /stop -o none
    print -r -- "Stopped the shared test environment for PR #$pr_number."
  fi
  exit 0
fi

[[ "${EVENT_ACTION:-}" != closed ]] || exit 0
[[ "$(jq -r '.head.repo.full_name' <<< "$pr")" == "$GITHUB_REPOSITORY" ]] || exit 0
if [[ -n "${PR_NUMBER:-}" ]]; then
  pr_head="${DEPLOYMENT_REVISION:?Missing PR head}"
  [[ "$pr_head" == "$(jq -r '.head.sha' <<< "$pr")" ]] || exit 0
  revision="$(< "$RELEASE_STATE_DIR/revision.sha")"
else
  revision="$previous_revision"
fi
[[ "$revision" =~ '^[a-f0-9]{40}$' ]] || die 'invalid test environment revision'

registry_name="$(config registryName)"
registry_host="$(config registryHost)"
database_server="$(config databaseServer)"
resource_group="$(config resourceGroup)"
database_user="$(config databaseUser)"
slot_user="$(config slotUser)"
owner_role=tripplanner_preview_owner

case "$previous_database" in
  ""|tripplanner_preview_b) database=tripplanner_preview_a ;;
  tripplanner_preview_a) database=tripplanner_preview_b ;;
  *) die 'unexpected previous test database' ;;
esac

previous_web="$(web_request get "$slot_id" /config/web --query '{properties: {linuxFxVersion: properties.linuxFxVersion}}' -o json)"
preview_image_prefix="$registry_host/tripplanner-preview:pr-$pr_number-"
if [[ -n "${PR_NUMBER:-}" ]]; then
  image_ref="$preview_image_prefix$revision-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
  publish_image "$registry_name" "$image_ref" "$resource_group"
else
  image_ref="$(jq -er '.properties.linuxFxVersion | ltrimstr("DOCKER|")' <<< "$previous_web")"
  [[ "$image_ref" == "$preview_image_prefix"* ]] || die 'unexpected deployed test environment image'
fi

# Keep the dump on the runner, with no GitHub artifact or output containing its contents.
umask 077
work_dir="$(mktemp -d)"
firewall_rule="github-preview-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
firewall_uri="/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$resource_group/providers/Microsoft.DBforPostgreSQL/flexibleServers/$database_server/firewallRules/$firewall_rule?api-version=2024-08-01"
firewall_open=false
switching=false

cleanup() {
  local result=$?
  trap - EXIT
  if [[ "$switching" == true ]]; then
    print -ru2 -- 'Restoring the previous test environment configuration.'
    web_request post "$slot_id" /stop -o none || result=1
    web_request put "$slot_id" /config/appsettings --body "$settings" -o none || result=1
    if [[ -n "$previous_revision" && "$unauthenticated_access" == false ]]; then
      if web_request patch "$slot_id" /config/web --body "$previous_web" -o none; then
        web_request post "$slot_id" /start -o none || result=1
      else
        result=1
      fi
    fi
  fi
  if [[ "$firewall_open" == true ]]; then
    az rest --method delete --uri "$firewall_uri" --only-show-errors -o none || result=1
  fi
  rm -rf -- "$work_dir"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

runner_ip="$(curl -4fsS --retry 3 --max-time 10 https://api.ipify.org)"
[[ "$runner_ip" =~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' ]] || die 'could not resolve runner IPv4'
postgres_roots="${0:A:h}/azure-postgres-roots.pem"
[[ -s "$postgres_roots" ]] || die 'Azure PostgreSQL root certificates are missing'
docker pull postgres:18
firewall_open=true
az rest --method put --uri "$firewall_uri" --body "$(jq -cn --arg ip "$runner_ip"   '{properties: {startIpAddress: $ip, endIpAddress: $ip}}')" --only-show-errors -o none

PGHOST="$database_server.postgres.database.azure.com"
export PGHOST PGUSER="$database_user" PGSSLMODE=verify-full PGSSLROOTCERT=/azure-postgres-roots.pem
PGPASSWORD="$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)"
export PGPASSWORD
print -r -- "::add-mask::$PGPASSWORD"

pg() {
  docker run --rm -i -v "$work_dir:/backup" \
    --mount "type=bind,source=$postgres_roots,target=$PGSSLROOTCERT,readonly" \
    -e PGHOST -e PGUSER -e PGSSLMODE -e PGSSLROOTCERT -e PGPASSWORD -e PGCONNECT_TIMEOUT=5 \
    postgres:18 "$@"
}
wait_for_database() {
  local result
  for attempt in {1..24}; do
    if result="$(pg psql -XqAt -d postgres -c 'select 1' 2>&1)"; then
      return 0
    fi
    print -ru2 -- "$result"
    case "$result" in
      *"certificate verify failed"*|*"root certificate file"*)
        die "TLS verification failed for $PGHOST"
        ;;
    esac
    sleep 10
  done
  die "could not connect to $PGHOST"
}

wait_for_database
pg pg_dump --dbname=tripplanner --format=custom --schema=gustavo_planner \
  --no-owner --no-privileges --lock-wait-timeout=15s \
  --exclude-table-data='gustavo_planner."OpenIddictTokens"' \
  --exclude-table-data='gustavo_planner."OpenIddictAuthorizations"' \
  --exclude-table-data='gustavo_planner."OpenIddictApplications"' \
  --exclude-table-data='gustavo_planner.activity_calendar_subscriptions' \
  --file=/backup/tripplanner.dump

pg psql -X -v ON_ERROR_STOP=1 -q -d postgres -v owner_role="$owner_role" -v database="$database" <<'SQL'
DROP DATABASE IF EXISTS :"database" WITH (FORCE);
CREATE DATABASE :"database" TEMPLATE tripplanner_preview_template;
REVOKE CONNECT, TEMPORARY ON DATABASE :"database" FROM PUBLIC;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE :"database" TO :"owner_role";
SQL

pg pg_restore --dbname="$database" --role="$owner_role" --single-transaction \
  --no-owner --no-privileges /backup/tripplanner.dump

# A newer push or a closed PR can arrive during the database copy.
pr="$(pr_details)"
[[ "$(jq -r '.state' <<< "$pr")" == open ]] || exit 0
if [[ -n "${PR_NUMBER:-}" && "$pr_head" != "$(jq -r '.head.sha' <<< "$pr")" ]]; then
  exit 0
fi

connection="Host=$PGHOST;Port=5432;Database=$database;Username=$slot_user;SSL Mode=VerifyFull;Options=-c role=$owner_role"
next_settings="$(jq -c --arg database "$database" --arg connection "$connection" \
  --arg pr "$pr_number" --arg revision "$revision" \
  '{properties: (.properties + {PREVIEW_DATABASE: $database, ConnectionStrings__TripPlanner: $connection,
    DEPLOYED_PR: $pr, DEPLOYED_REVISION: $revision})}' <<< "$settings")"

# Stop first so the previous image can never migrate the incoming database.
verify_test_auth_policy

switching=true
web_request post "$slot_id" /stop -o none
web_request put "$slot_id" /config/appsettings --body "$next_settings" -o none
web_request patch "$slot_id" /config/web --body "$(jq -cn --arg image "$image_ref" \
  '{properties: {linuxFxVersion: ("DOCKER|" + $image), acrUseManagedIdentityCreds: true}}')" -o none
web_request post "$slot_id" /start -o none
verify_revision "$slot_url" "$revision" || die "test environment failed startup or migrations for $revision"

verify_test_sign_in
switching=false
report_test_ready
