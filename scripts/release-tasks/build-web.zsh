#!/usr/bin/env zsh
set -euo pipefail

source "${0:A:h}/common.zsh"

log "Building web application"
run_pnpm run build
expected_index_hash="$(shasum -a 256 src/TripPlanner.Web/dist/index.html)"
print -r -- "${expected_index_hash%% *}" > "$RELEASE_STATE_DIR/index.sha256"
