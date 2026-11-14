#!/usr/bin/env zsh
set -euo pipefail

require_release_checkout() {
  local expected_commit="${1:-}"
  local checkout_changes
  checkout_changes="$(git status --porcelain --untracked-files=all --ignore-submodules=none)"
  if [[ -n "$checkout_changes" ]]; then
    print -r -- "$checkout_changes" >&2
    die "commit all staged, unstaged, and untracked changes before releasing"
  fi
  if [[ -n "$expected_commit" && "$(git rev-parse HEAD)" != "$expected_commit" ]]; then
    die "HEAD changed during the release; rerun scripts/release from the intended commit"
  fi
}

next_release_version() {
  local release_day="$1"
  local existing_tag sequence
  local -i highest_sequence=0
  local sequence_pattern='^[1-9][0-9]*$'
  while IFS= read -r existing_tag; do
    sequence="${existing_tag#"$release_day."}"
    if [[ "$sequence" =~ "$sequence_pattern" ]] && (( sequence > highest_sequence )); then
      highest_sequence=$sequence
    fi
  done < <(git tag --list "$release_day.*")
  print -r -- "$release_day.$((highest_sequence + 1))"
}

commit_release_changelog() {
  local release_version="$1" release_commit="$2" prepared_changelog="$3"
  require_release_checkout "$release_commit"
  if cmp -s -- CHANGELOG.md "$prepared_changelog"; then
    log "No Unreleased changelog entries to roll over"
    return
  fi

  cp -- "$prepared_changelog" CHANGELOG.md || die \
    "deployment verified and tag $release_version created, but writing CHANGELOG.md failed; roll over its Unreleased entries and commit separately without moving the tag"
  git commit --only -m "docs: roll over changelog for $release_version" -- CHANGELOG.md || die \
    "deployment verified and tag $release_version created, but committing CHANGELOG.md failed; resolve the Git error and commit the changelog rollover separately without moving the tag"
  log "Committed changelog for $release_version; release tag remains on $release_commit"
}
