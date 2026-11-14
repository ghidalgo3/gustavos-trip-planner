# Build context is the REPOSITORY ROOT, not this directory:
#   docker build -f src/TripPlanner.Api/Dockerfile .
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /source

# Override when the build host cannot reach nuget.org and must go through a mirror:
#   docker build --build-arg NUGET_SOURCE=https://my-feed/v3/index.json ...
# scripts/deploy/deploy.sh forwards the NUGET_SOURCE environment variable for this.
ARG NUGET_SOURCE=https://api.nuget.org/v3/index.json

# Restore first, as its own layer, so source edits don't invalidate the package cache.
COPY src/TripPlanner.Api/TripPlanner.Api.csproj src/TripPlanner.Api/
RUN dotnet restore src/TripPlanner.Api/TripPlanner.Api.csproj --source "$NUGET_SOURCE"

COPY src/ src/
COPY docs/schemas/ docs/schemas/
ARG AIRPORT_CATALOG_SHA256=bundled
RUN --mount=type=secret,id=airport_catalog \
    if [ "$AIRPORT_CATALOG_SHA256" != bundled ]; then \
      gzip -dc /run/secrets/airport_catalog > src/TripPlanner.Api/Data/airports.json && \
      echo "$AIRPORT_CATALOG_SHA256  src/TripPlanner.Api/Data/airports.json" | sha256sum -c -; \
    fi && \
    dotnet publish src/TripPlanner.Api/TripPlanner.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app/publish .
COPY src/TripPlanner.Web/dist ./wwwroot

# App Service routes to the port named by the WEBSITES_PORT app setting; keep the
# three in sync (here, infra/main.bicep, and the deploy script's health check).
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080

# APP_UID is a non-root user supplied by the aspnet base image.
USER $APP_UID

ENTRYPOINT ["dotnet", "TripPlanner.Api.dll"]
