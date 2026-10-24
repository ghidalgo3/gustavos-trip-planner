using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Maps;

namespace TripPlanner.Api.Services.Activities;

public interface IActivityPlaceResolver
{
    Task<GeoJsonPoint?> ResolveAddressAsync(
        string address,
        string city,
        string countryCode,
        CancellationToken cancellationToken,
        GeoJsonPoint? center = null,
        StructuredAddress? structuredAddress = null
    );

    Task<GeoJsonPoint?> ResolveAsync(
        string placeName,
        string city,
        string countryCode,
        CancellationToken cancellationToken,
        GeoJsonPoint? center = null
    );
}

public sealed class AzureActivityPlaceResolver(
    HttpClient client,
    IMapTokenProvider tokens,
    IAddressGeocoder addresses
) : IActivityPlaceResolver
{
    public async Task<GeoJsonPoint?> ResolveAddressAsync(
        string address,
        string city,
        string countryCode,
        CancellationToken cancellationToken,
        GeoJsonPoint? center = null,
        StructuredAddress? structuredAddress = null
    )
    {
        var candidates = await addresses.FindAsync(
            address,
            city,
            countryCode,
            cancellationToken,
            center,
            structuredAddress
        );
        var precise = candidates
            .Where(candidate =>
                candidate.Confidence == AddressMatchConfidence.High && !candidate.Ambiguous
            )
            .ToArray();
        // Activity jobs cannot accept a tentative location on the user's behalf.
        return precise.Length == 1 ? precise[0].Geometry : null;
    }

    public async Task<GeoJsonPoint?> ResolveAsync(
        string placeName,
        string city,
        string countryCode,
        CancellationToken cancellationToken,
        GeoJsonPoint? center = null
    )
    {
        MapToken token = await tokens.GetTokenAsync(cancellationToken);
        string queryName = SearchName(placeName);
        string query = Uri.EscapeDataString(center is null ? $"{queryName}, {city}" : queryName);
        string nearby = center is { Position: not null }
            ? string.Create(
                CultureInfo.InvariantCulture,
                $"&lon={center.Position.Longitude}&lat={center.Position.Latitude}&radius=50000"
            )
            : "";
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"{token.Endpoint.TrimEnd('/')}/search/poi/json?api-version=1.0&query={query}&countrySet={Uri.EscapeDataString(countryCode)}&limit=5&language=en-US{nearby}"
        );
        request.Headers.TryAddWithoutValidation("Authorization", $"jwt-sas {token.Token}");
        using var response = await client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(
            await response.Content.ReadAsStreamAsync(cancellationToken)
        );
        if (
            !json.RootElement.TryGetProperty("results", out var results)
            || results.ValueKind != JsonValueKind.Array
        )
        {
            return await ResolveLandmarkAsync(
                token,
                queryName,
                city,
                countryCode,
                center,
                cancellationToken
            );
        }

        foreach (var place in results.EnumerateArray())
        {
            if (
                !place.TryGetProperty("poi", out var poi)
                || !poi.TryGetProperty("name", out var name)
                || name.GetString() is not { } resultName
                || !NamesMatch(placeName, resultName)
            )
            {
                continue;
            }

            if (
                !place.TryGetProperty("address", out var address)
                || !address.TryGetProperty("countryCode", out var country)
                || !string.Equals(
                    country.GetString(),
                    countryCode,
                    StringComparison.OrdinalIgnoreCase
                )
            )
            {
                continue;
            }

            if (
                !place.TryGetProperty("position", out var position)
                || !position.TryGetProperty("lon", out var lon)
                || !lon.TryGetDouble(out double longitude)
                || !position.TryGetProperty("lat", out var lat)
                || !lat.TryGetDouble(out double latitude)
            )
            {
                continue;
            }

            if (
                double.IsFinite(longitude)
                && double.IsFinite(latitude)
                && Math.Abs(longitude) <= 180
                && Math.Abs(latitude) <= 90
            )
            {
                var point = new GeoJsonPoint(
                    "Point",
                    GeographyPoint.Create(latitude: latitude, longitude: longitude)
                );
                if (MapGeometry.IsNearby(point, center))
                {
                    return point;
                }
            }
        }
        return await ResolveLandmarkAsync(
            token,
            queryName,
            city,
            countryCode,
            center,
            cancellationToken
        );
    }

    private async Task<GeoJsonPoint?> ResolveLandmarkAsync(
        MapToken token,
        string placeName,
        string city,
        string countryCode,
        GeoJsonPoint? center,
        CancellationToken cancellationToken
    )
    {
        string query = Uri.EscapeDataString(
            string.Join(
                ", ",
                placeName
                    .Split(
                        ',',
                        StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries
                    )
                    .Append(city)
                    .Append(countryCode)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
            )
        );
        string coordinates = center is { Position: not null }
            ? string.Create(
                CultureInfo.InvariantCulture,
                $"&coordinates={center.Position.Longitude},{center.Position.Latitude}"
            )
            : "";
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"{token.Endpoint.TrimEnd('/')}/geocode?api-version=2026-01-01&query={query}&top=3{coordinates}"
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
        )
        {
            return null;
        }
        foreach (var feature in features.EnumerateArray())
        {
            if (
                !feature.TryGetProperty("properties", out var properties)
                || !properties.TryGetProperty("confidence", out var confidence)
                || confidence.GetString() != "High"
                || !properties.TryGetProperty("type", out var type)
                || type.GetString()
                    is not (
                        "Temple"
                        or "Shrine"
                        or "Museum"
                        or "Park"
                        or "Landmark"
                        or "LandmarkBuilding"
                        or "TouristStructure"
                        or "Monument"
                        or "TouristAttraction"
                        or "HistoricalSite"
                        or "PointOfInterest"
                        or "Stadium"
                        or "Zoo"
                        or "Airport"
                        or "Building"
                    )
                || !properties.TryGetProperty("address", out var address)
                || !address.TryGetProperty("countryRegion", out var country)
                || !country.TryGetProperty("ISO", out var iso)
                || !string.Equals(iso.GetString(), countryCode, StringComparison.OrdinalIgnoreCase)
                || !address.TryGetProperty("formattedAddress", out var formatted)
                || formatted.GetString() is not { } name
                || !NamesMatch(placeName, name.Split(',')[0])
                || !feature.TryGetProperty("geometry", out var geometry)
                || !geometry.TryGetProperty("type", out var geometryType)
                || geometryType.GetString() != "Point"
                || !geometry.TryGetProperty("coordinates", out var values)
                || values.ValueKind != JsonValueKind.Array
                || values.GetArrayLength() != 2
                || !values[0].TryGetDouble(out double lon)
                || !values[1].TryGetDouble(out double lat)
                || !double.IsFinite(lon)
                || !double.IsFinite(lat)
                || Math.Abs(lon) > 180
                || Math.Abs(lat) > 90
            )
            {
                continue;
            }
            var point = new GeoJsonPoint(
                "Point",
                GeographyPoint.Create(latitude: lat, longitude: lon)
            );
            if (MapGeometry.IsNearby(point, center))
            {
                return point;
            }
        }
        return null;
    }

    private static string SearchName(string value)
    {
        string[] verbs =
        [
            "visit ",
            "explore ",
            "tour ",
            "discover ",
            "see ",
            "walk around ",
            "walk through ",
            "stroll through ",
            "go to ",
        ];
        value = value.Trim();
        foreach (string verb in verbs)
        {
            if (value.StartsWith(verb, StringComparison.OrdinalIgnoreCase))
            {
                return value[verb.Length..].Trim();
            }
        }

        return value;
    }

    // Azure and AI may differ in punctuation, accents, spacing, or activity verbs.
    private static bool NamesMatch(string requested, string found)
    {
        static string Normalize(string value)
        {
            value = SearchName(value);
            return string.Concat(
                    value
                        .Normalize(NormalizationForm.FormD)
                        .Where(ch =>
                            char.IsLetterOrDigit(ch)
                            && CharUnicodeInfo.GetUnicodeCategory(ch)
                                != UnicodeCategory.NonSpacingMark
                        )
                )
                .ToLowerInvariant();
        }
        string query = Normalize(requested.Split(',')[0]),
            name = Normalize(found);
        return query.Length >= 3
            && name.Length >= 3
            && (
                name.Contains(query, StringComparison.Ordinal)
                || (
                    name.Length >= query.Length / 2
                    && query.Contains(name, StringComparison.Ordinal)
                )
            );
    }
}
