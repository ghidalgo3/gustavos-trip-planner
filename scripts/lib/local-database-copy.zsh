# Sourced by scripts/server and scripts/copy_production_db.
is_local_copy_name() {
  [[ "$1" =~ '^tripplanner_copy_[a-z0-9_]{1,45}$' ]]
}

local_postgres() {
  docker compose exec -T database "$@"
}

dump_application_schema() {
  "$@" --format=custom --schema=gustavo_planner --no-owner --no-privileges --lock-wait-timeout=15s \
    --exclude-table-data='gustavo_planner."OpenIddict"*' \
    --exclude-table-data=gustavo_planner.activity_calendar_subscriptions \
    --exclude-table-data=gustavo_planner.operations \
    --exclude-table-data=gustavo_planner.fare_searches \
    --exclude-table-data='gustavo_planner.*_jobs'
}

restore_local_copy() (
  set -euo pipefail
  archive="$1"
  destination="$2"
  staging="tripplanner_restore_${$}_${RANDOM}"
  created=false
  is_local_copy_name "$destination" || exit 1

  cleanup_restore() {
    local result=$?
    trap - EXIT
    if [[ "$created" == true ]]; then
      local_postgres dropdb -U tripplanner --if-exists "$staging" >&2 || result=1
    fi
    exit "$result"
  }
  trap cleanup_restore EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  local_postgres createdb -U tripplanner --template=template0 "$staging" || exit 1
  created=true
  local_postgres psql -X -U tripplanner -d "$staging" -v ON_ERROR_STOP=1 -q \
    -c 'CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public' || exit 1
  local_postgres pg_restore -U tripplanner --dbname="$staging" --single-transaction \
    --no-owner --no-privileges < "$archive" || exit 1
  local_postgres psql -X -U tripplanner -d "$staging" -v ON_ERROR_STOP=1 -q \
    -c 'SELECT 1 FROM gustavo_planner.schema_migrations LIMIT 0' \
    -c 'SELECT 1 FROM gustavo_planner.trips LIMIT 0' >/dev/null || exit 1
  # PostgreSQL rejects the rename if the destination already exists.
  local_postgres psql -X -U tripplanner -d postgres -v ON_ERROR_STOP=1 -q \
    -v staging="$staging" -v destination="$destination" <<'SQL' || exit 1
ALTER DATABASE :"staging" RENAME TO :"destination";
SQL
  created=false
)
