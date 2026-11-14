#!/usr/bin/env zsh
set -euo pipefail

source "${0:A:h}/common.zsh"

log "Refreshing the IATA airport catalog"
curl -fLsS --max-time 120 --retry 2 \
  https://davidmegginson.github.io/ourairports-data/airports.csv \
  -o "$RELEASE_STATE_DIR/airport-codes.csv"
curl -fLsS --max-time 120 --retry 2 \
  https://raw.githubusercontent.com/mborsetti/airportsdata/main/airportsdata/airports.csv \
  -o "$RELEASE_STATE_DIR/airport-time-zones.csv"
node scripts/release-tasks/airport-catalog.mjs \
  "$RELEASE_STATE_DIR/airport-codes.csv" "$RELEASE_STATE_DIR/airport-time-zones.csv" \
  "$RELEASE_STATE_DIR/airports.json"
