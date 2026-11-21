#!/usr/bin/env zsh
set -euo pipefail
source "${0:A:h}/common.zsh"

slot_id="$(config slotId)"
slot_host="$(web_request get "$slot_id" '' --query properties.defaultHostName -o tsv)"
slot_url="https://$slot_host"

running_backend() {
  local headers
  headers="$(curl -fsS --max-time 5 -D - -o /dev/null "$slot_url/health")" || return 1
  grep -iq '^X-Trip-Planner-Web-Overlay: enabled' <<< "$headers" || return 1
  grep -iq '^X-Trip-Planner-Reviewer-Auth: enabled' <<< "$headers" || return 1
  local revision
  revision="$(awk 'tolower($1) == "x-trip-planner-revision:" { sub(/\r$/, "", $2); print $2 }' <<< "$headers")"
  [[ "$revision" =~ '^[a-f0-9]{40}$' ]] || return 1
  local active_pr
  active_pr="$(web_request post "$slot_id" /config/appsettings/list --query properties.DEPLOYED_PR -o tsv)"
  [[ "$active_pr" == "$PR_NUMBER" ]] || return 1
  print -r -- "$revision"
}

web_only() {
  git fetch --no-tags origin "$1" "$MERGE_SHA" &&
    git diff --quiet "$1" "$MERGE_SHA" -- . \
      ':(exclude)src/TripPlanner.Web/src/**' \
      ':(exclude)src/TripPlanner.Web/index.html'
}

if [[ "$1" == select ]]; then
  if backend="$(running_backend)" && web_only "$backend"; then
    print -r -- "backend=$backend" >> "$GITHUB_OUTPUT"
  fi
  exit 0
fi

[[ "$1" == publish && "$PREVIEW_BACKEND" =~ '^[a-f0-9]{40}$' &&
   "$MERGE_SHA" =~ '^[a-f0-9]{40}$' && "$PR_NUMBER" =~ '^[0-9]+$' ]] || die 'invalid preview selection'
[[ "$(running_backend)" == "$PREVIEW_BACKEND" ]] ||
  die 'the preview backend changed during the build, rerun the workflow'
web_only "$PREVIEW_BACKEND" || die 'the selected revision is not web-only'

current_pr() {
  gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER" |
    jq -e --arg sha "$DEPLOYMENT_REVISION" --arg repo "$GITHUB_REPOSITORY" \
      '.state == "open" and .head.sha == $sha and .head.repo.full_name == $repo' >/dev/null
}

current_pr || exit 0
dist="$RELEASE_STATE_DIR/web"
[[ -s "$dist/index.html" && -d "$dist/assets" ]] || die 'Vite output is missing'
[[ "$(< "$RELEASE_STATE_DIR/revision.sha")" == "$MERGE_SHA" &&
   "$DEPLOYMENT_REVISION" =~ '^[a-f0-9]{40}$' ]] || die 'artifact revision did not match the PR'
printf '\n<!-- tripplanner-preview-head:%s -->\n' "$DEPLOYMENT_REVISION" >> "$dist/index.html"
archive="$RELEASE_STATE_DIR/preview.zip"
python3 - "$dist" "$archive" "$MERGE_SHA" <<'PY'
import re
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

dist, archive, revision = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
with ZipFile(archive, "w", ZIP_DEFLATED) as bundle:
    for asset in sorted((dist / "assets").iterdir()):
        if not asset.is_file() or not re.fullmatch(
            r"[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+", asset.name
        ):
            raise SystemExit(f"Unexpected asset path: {asset.name}")
        bundle.write(asset, f"assets/{asset.name}")
    bundle.write(dist / "index.html", f"index-{revision}.html")
PY

[[ "$slot_host" == *.azurewebsites.net ]] || die 'unexpected App Service hostname'
scm="https://${slot_host%.azurewebsites.net}.scm.azurewebsites.net"
token="$(az account get-access-token --query accessToken -o tsv)"
print -r -- "::add-mask::$token"
folder="site/tripplanner-web/$PREVIEW_BACKEND"
curl -fsS --max-time 60 --oauth2-bearer "$token" -X PUT \
  -H 'Content-Type: application/zip' --data-binary "@$archive" "$scm/api/zip/$folder/" >/dev/null

current_pr || exit 0
jq -cn --arg dir "/home/$folder" --arg revision "$MERGE_SHA" \
  '{dir: $dir, command: ("mv -f index-" + $revision + ".html index.html")}' |
  curl -fsS --max-time 15 --oauth2-bearer "$token" -H 'Content-Type: application/json' \
    --data-binary @- "$scm/api/command" |
  jq -e '.ExitCode == 0' >/dev/null

curl -fsS --max-time 10 "$slot_url/?preview=$MERGE_SHA" -o "$RELEASE_STATE_DIR/served.html"
cmp -s "$dist/index.html" "$RELEASE_STATE_DIR/served.html" || die 'preview is serving a different web build'
printf 'deployed=true\nlogin_url=%s/\n' "$slot_url" >> "$GITHUB_OUTPUT"
printf '[Open the test environment for PR #%s](%s/)\n\nWeb commit `%s`\n' \
  "$PR_NUMBER" "$slot_url" "$MERGE_SHA" >> "$GITHUB_STEP_SUMMARY"
