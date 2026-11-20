activate_cloud_environment() {
  export TRIP_PLANNER_CLOUD_STATE="${TRIP_PLANNER_CLOUD_STATE:-/workspace/scratch/trip-planner}"
  export DOTNET_ROOT="$TRIP_PLANNER_CLOUD_STATE/dotnet"
  export DOTNET_CLI_HOME="$TRIP_PLANNER_CLOUD_STATE/dotnet-home"
  export NUGET_PACKAGES="$TRIP_PLANNER_CLOUD_STATE/nuget"
  export XDG_DATA_HOME="$TRIP_PLANNER_CLOUD_STATE/xdg-data"
  export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_GENERATE_ASPNET_CERTIFICATE=false
  export COREPACK_HOME="$TRIP_PLANNER_CLOUD_STATE/corepack"
  export pnpm_config_store_dir="$TRIP_PLANNER_CLOUD_STATE/pnpm-store"
  export PATH="$DOTNET_ROOT:$PATH"
}

install_cloud_dotnet() (
  local sdk_version=10.0.404
  local sdk_hash=577d0eb17fec33d029104c5c63a1ab0accc3e28776274abef2218dbac5af18d2109b5406d26b31d76f5c245215e3ba0926a94c20246c672c41847c9e1eb1dc50
  local sdk_archive
  if [[ -x "$DOTNET_ROOT/dotnet" ]] && "$DOTNET_ROOT/dotnet" --list-sdks | grep -Fq "$sdk_version "; then
    return
  fi
  sdk_archive="$(mktemp)"
  trap 'rm -f "$sdk_archive"' EXIT
  curl -fsSL --retry 2 \
    "https://builds.dotnet.microsoft.com/dotnet/Sdk/$sdk_version/dotnet-sdk-$sdk_version-linux-x64.tar.gz" \
    -o "$sdk_archive"
  printf '%s  %s\n' "$sdk_hash" "$sdk_archive" | sha512sum --check
  mkdir -p "$DOTNET_ROOT"
  tar -xzf "$sdk_archive" -C "$DOTNET_ROOT"
)

cloud_compose() {
  docker compose -f compose.yaml -f compose.cloud.yaml "$@"
}
