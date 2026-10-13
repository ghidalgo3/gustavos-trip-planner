using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services;

public interface ICityPlaceResolver
{
    Task<GeoJsonPoint?> ResolveAsync(
        string city,
        string countryCode,
        CancellationToken cancellationToken
    );
}

public sealed class AzureCityPlaceResolver(HttpClient client, IMapTokenProvider tokens)
    : ICityPlaceResolver
{
    public async Task<GeoJsonPoint?> ResolveAsync(
        string city,
        string countryCode,
        CancellationToken cancellationToken
    )
    {
        MapToken token = await tokens.GetTokenAsync(cancellationToken);
        string query = Uri.EscapeDataString($"{city}, {countryCode}");
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"{token.Endpoint.TrimEnd('/')}/geocode?api-version=2026-01-01&query={query}&top=1&resultTypes=PopulatedPlace"
        );
        request.Headers.TryAddWithoutValidation("Authorization", $"jwt-sas {token.Token}");
        using var response = await client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(
            await response.Content.ReadAsStreamAsync(cancellationToken)
        );
        if (
            !json.RootElement.TryGetProperty("features", out var features)
            || features.ValueKind != JsonValueKind.Array
            || features.GetArrayLength() == 0
        )
            return null;
        var feature = features[0];
        if (
            feature.TryGetProperty("properties", out var properties)
            && properties.TryGetProperty("address", out var address)
            && (
                address.TryGetProperty("countryRegionISO2", out var country)
                || (
                    address.TryGetProperty("countryRegion", out var countryRegion)
                    && countryRegion.TryGetProperty("ISO", out country)
                )
            )
            && !string.Equals(country.GetString(), countryCode, StringComparison.OrdinalIgnoreCase)
        )
            return null;
        if (
            !feature.TryGetProperty("geometry", out var geometry)
            || !geometry.TryGetProperty("coordinates", out var point)
            || point.ValueKind != JsonValueKind.Array
            || point.GetArrayLength() < 2
        )
            return null;
        double longitude = point[0].GetDouble(),
            latitude = point[1].GetDouble();
        return
            double.IsFinite(longitude)
            && double.IsFinite(latitude)
            && Math.Abs(longitude) <= 180
            && Math.Abs(latitude) <= 90
            ? new("Point", [longitude, latitude])
            : null;
    }
}

public sealed record DestinationSnapshot(GeoJsonCollection<DestinationProperties> Collection)
{
    public GeoJsonFeature<DestinationProperties>? Find(string cityId) =>
        Collection.Features.FirstOrDefault(f => f.Id == cityId);
}

public sealed class DestinationService(IPlannerDb database, ICityPlaceResolver cities)
{
    public async Task<DestinationSnapshot> GetAsync(
        Guid viewerUserId,
        Trip trip,
        CancellationToken cancellationToken
    )
    {
        var visits = await database.GetDestinationVisitsAsync(
            viewerUserId,
            trip.Id,
            cancellationToken
        );
        var places = await database.GetDestinationPlacesAsync(
            viewerUserId,
            trip.Id,
            cancellationToken
        );
        var features = visits
            .GroupBy(v => v.CityId)
            .Select(group =>
            {
                var place = places.Single(p => p.CityId == group.Key);
                var stays = group
                    .OrderBy(v => v.Order)
                    .Select(v => new DestinationStay(
                        v.StayId,
                        v.Order,
                        v.ArrivalDate,
                        v.DepartureDate,
                        v.ArrivalDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "",
                        v.DepartureDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? ""
                    ))
                    .ToArray();
                return new GeoJsonFeature<DestinationProperties>(
                    "Feature",
                    place.CityId,
                    new("Point", [place.Longitude, place.Latitude]),
                    new(
                        place.Name,
                        place.CountryCode,
                        string.IsNullOrEmpty(place.TimeZone) ? null : place.TimeZone,
                        place.ContextVersion,
                        stays.Length == 1 ? stays[0].ArrivalDate : null,
                        stays.Length == 1 ? stays[0].DepartureDate : null,
                        stays
                    )
                    {
                        Constraints = place.Constraints,
                    }
                );
            })
            .ToArray();
        var route = visits
            .OrderBy(v => v.Order)
            .Select(v => new DestinationRouteItem(v.CityId, v.StayId))
            .ToArray();
        return new(new("FeatureCollection", features, route));
    }

    public async Task<DestinationVisit> AddAsync(
        Guid ownerUserId,
        Trip trip,
        DestinationVisitInput input,
        CancellationToken cancellationToken
    )
    {
        string city = input.Name.Trim(),
            country = input.CountryCode.Trim().ToUpperInvariant();
        string cityId = CityId(city, country);
        GeoJsonPoint? suppliedPoint =
            input.Longitude is { } longitude && input.Latitude is { } latitude
                ? new("Point", [longitude, latitude])
                : null;
        DestinationPlace? place;
        if (suppliedPoint is not null)
        {
            var places = await database.GetDestinationPlacesAsync(
                ownerUserId,
                trip.Id,
                cancellationToken
            );
            place = places.FirstOrDefault(candidate =>
                candidate.Name.Equals(city, StringComparison.OrdinalIgnoreCase)
                && candidate.CountryCode.Equals(country, StringComparison.OrdinalIgnoreCase)
                && DistanceKm(candidate, suppliedPoint) < 10
            );
            if (place is null && places.Any(candidate => candidate.CityId == cityId))
                cityId = $"{cityId}-{CoordinateSuffix(suppliedPoint)}";
        }
        else
        {
            place = await database.GetDestinationPlaceAsync(
                ownerUserId,
                trip.Id,
                cityId,
                cancellationToken
            );
        }
        if (place is null)
        {
            GeoJsonPoint? point = suppliedPoint is not null
                ? suppliedPoint
                : await cities.ResolveAsync(city, country, cancellationToken);
            if (point is null)
                throw new InvalidOperationException("The destination city could not be located.");
            place = await database.SaveDestinationPlaceAsync(
                ownerUserId,
                new(
                    trip.Id,
                    cityId,
                    city,
                    country,
                    input.TimeZone?.Trim() ?? "",
                    point.Coordinates[0],
                    point.Coordinates[1]
                )
                {
                    Constraints =
                        input.Constraints?.Clone() ?? JsonSerializer.SerializeToElement(new { }),
                },
                cancellationToken
            );
        }
        cityId = place.CityId;
        var visit = new DestinationVisit(
            trip.Id,
            cityId,
            Guid.NewGuid(),
            0,
            input.ArrivalDate,
            input.DepartureDate
        );
        return await database.AddDestinationVisitAsync(ownerUserId, visit, cancellationToken)
            ?? throw new InvalidOperationException("The trip could not be updated.");
    }

    private static string CityId(string city, string country)
    {
        string ascii = city.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder();
        foreach (char ch in ascii)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark)
                continue;
            if (char.IsAsciiLetterOrDigit(ch))
                builder.Append(char.ToLowerInvariant(ch));
            else if (builder.Length > 0 && builder[^1] != '-')
                builder.Append('-');
        }
        return $"{builder.ToString().Trim('-')}-{country.ToLowerInvariant()}";
    }

    private static double DistanceKm(DestinationPlace place, GeoJsonPoint point)
    {
        double firstLatitude = place.Latitude * Math.PI / 180;
        double secondLatitude = point.Coordinates[1] * Math.PI / 180;
        double latitudeDelta = secondLatitude - firstLatitude;
        double longitudeDelta = (point.Coordinates[0] - place.Longitude) * Math.PI / 180;
        double haversine =
            Math.Pow(Math.Sin(latitudeDelta / 2), 2)
            + Math.Cos(firstLatitude)
                * Math.Cos(secondLatitude)
                * Math.Pow(Math.Sin(longitudeDelta / 2), 2);
        return 6371 * 2 * Math.Asin(Math.Min(1, Math.Sqrt(haversine)));
    }

    private static string CoordinateSuffix(GeoJsonPoint point)
    {
        string coordinates = string.Create(
            CultureInfo.InvariantCulture,
            $"{point.Coordinates[0]:F4},{point.Coordinates[1]:F4}"
        );
        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(coordinates));
        return Convert.ToHexString(hash.AsSpan(0, 4)).ToLowerInvariant();
    }
}
