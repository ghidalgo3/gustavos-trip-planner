#!/usr/bin/env zsh
set -euo pipefail

REPO_ROOT="${0:A:h:h:h}"
cd "$REPO_ROOT"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }

[[ -n "${RELEASE_STATE_DIR:-}" && -d "$RELEASE_STATE_DIR" ]] || die \
  "release context is missing; run scripts/release"

run_pnpm() {
  (cd "$REPO_ROOT/src/TripPlanner.Web" && CI=true corepack pnpm "$@")
}

load_release_context() {
  source "$RELEASE_STATE_DIR/azure.zsh"
}
