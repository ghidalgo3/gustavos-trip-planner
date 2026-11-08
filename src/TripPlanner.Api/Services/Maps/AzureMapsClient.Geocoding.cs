using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services.Maps;

public sealed partial class AzureMapsClient
{
    public async Task<IReadOnlyList<AddressLocationCandidate>> GeocodeAddressAsync(
        string address,
        string city,
        string countryCode,
        CancellationToken cancellationToken,
        GeoJsonPoint? center = null,
        StructuredAddress? structuredAddress = null
    )
    {
        var candidates = await GeocodeAddressCandidatesAsync(
            [("query", address)],
            countryCode,
            center,
            structuredAddress?.PostalCode,
            cancellationToken
        );
        bool precise =
            candidates.Count == 1
            && candidates[0].Confidence == AddressMatchConfidence.High
            && !candidates[0].Ambiguous;
        if (!precise && structuredAddress is { AddressLine.Length: > 0 })
        {
            // Azure's structured fields are mutually exclusive with query.
            // Locality falls back to the known destination, never the model's guessed country.
            (string Name, string? Value)[] fields =
            [
                ("addressLine", structuredAddress.AddressLine),
                ("locality", structuredAddress.Locality ?? city),
                ("adminDistrict", structuredAddress.AdminDistrict),
                ("postalCode", structuredAddress.PostalCode),
                ("countryRegion", countryCode),
            ];
            try
            {
                var structured = await GeocodeAddressCandidatesAsync(
                    fields,
                    countryCode,
                    center,
                    structuredAddress.PostalCode,
                    cancellationToken
                );
                candidates = structured
                    .Concat(candidates)
                    .DistinctBy(candidate => candidate.Geometry.Position)
                    .ToArray();
            }
            catch (Exception exception)
                when (candidates.Count > 0
                    && exception is HttpRequestException or JsonException or IOException
                )
            {
                // Preserve usable first-pass candidates if enrichment is unavailable.
                logger.LogWarning(
                    "Structured address lookup unavailable ({FailureType})",
                    exception.GetType().Name
                );
            }
        }
        cancellationToken.ThrowIfCancellationRequested();
        logger.LogInformation(
            "Azure address lookup returned {CandidateCount} street-address candidates; structured fallback available: {StructuredAddressAvailable}",
            candidates.Count,
            structuredAddress is not null
        );
        return candidates.Take(3).ToArray();
    }

    private async Task<IReadOnlyList<AddressLocationCandidate>> GeocodeAddressCandidatesAsync(
        IEnumerable<(string Name, string? Value)> fields,
        string countryCode,
        GeoJsonPoint? center,
        string? postalCode,
        CancellationToken cancellationToken
    )
    {
        string query = string.Join(
            "&",
            fields
                .Where(field => !string.IsNullOrWhiteSpace(field.Value))
                .Select(field => $"{field.Name}={Uri.EscapeDataString(field.Value!)}")
        );
        string coordinates = center is { Position: not null }
            ? string.Create(
                CultureInfo.InvariantCulture,
                $"&coordinates={center.Position.Longitude},{center.Position.Latitude}"
            )
            : "";
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"geocode?api-version=2026-01-01&{query}&top=5{coordinates}"
        );
        using var response = await SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync(cancellationToken),
            cancellationToken: cancellationToken
        );
        if (
            !json.RootElement.TryGetProperty("features", out var features)
            || features.ValueKind != JsonValueKind.Array
        )
        {
            return [];
        }

        var candidates = new List<AddressLocationCandidate>();
        foreach (var feature in features.EnumerateArray())
        {
            if (
                feature.ValueKind != JsonValueKind.Object
                || !feature.TryGetProperty("properties", out var properties)
                || properties.ValueKind != JsonValueKind.Object
                || Text(properties, "type") != "Address"
                || Text(properties, "confidence") is not ("High" or "Medium")
                || !properties.TryGetProperty("address", out var address)
                || address.ValueKind != JsonValueKind.Object
                || !address.TryGetProperty("countryRegion", out var country)
                || !string.Equals(
                    Text(country, "ISO"),
                    countryCode,
                    StringComparison.OrdinalIgnoreCase
                )
                || Text(address, "formattedAddress") is not { Length: > 0 } formatted
            )
            {
                continue;
            }
            bool ambiguous = false;
            if (properties.TryGetProperty("matchCodes", out var codes))
            {
                if (
                    codes.ValueKind != JsonValueKind.Array
                    || codes
                        .EnumerateArray()
                        .Any(code =>
                            code.ValueKind != JsonValueKind.String
                            || code.GetString() is not ("Good" or "Ambiguous")
                        )
                )
                {
                    continue;
                }
                ambiguous = codes.EnumerateArray().Any(code => code.GetString() == "Ambiguous");
            }
            string expectedPostalCode = NormalizePostalCode(postalCode);
            string actualPostalCode = NormalizePostalCode(Text(address, "postalCode"));
            bool postalMismatch =
                expectedPostalCode.Length > 0 && expectedPostalCode != actualPostalCode;
            if (
                postalMismatch
                && !IsIndividualPostalCodeAlternative(
                    countryCode,
                    expectedPostalCode,
                    actualPostalCode
                )
            )
            {
                continue;
            }
            if (
                !feature.TryGetProperty("geometry", out var geometry)
                || geometry.ValueKind != JsonValueKind.Object
                || Text(geometry, "type") != "Point"
                || !geometry.TryGetProperty("coordinates", out var values)
                || values.ValueKind != JsonValueKind.Array
                || values.GetArrayLength() != 2
                || values[0].ValueKind != JsonValueKind.Number
                || values[1].ValueKind != JsonValueKind.Number
                || !values[0].TryGetDouble(out double longitude)
                || !values[1].TryGetDouble(out double latitude)
                || !double.IsFinite(longitude)
                || !double.IsFinite(latitude)
                || Math.Abs(longitude) > 180
                || Math.Abs(latitude) > 90
            )
            {
                continue;
            }
            var point = new GeoJsonPoint("Point", GeographyPoint.Create(latitude, longitude));
            // The map centre biases the provider query, but must not reject a
            // precise, country-checked address merely because it is a day trip.
            candidates.Add(
                new(
                    point,
                    formatted,
                    !postalMismatch && Text(properties, "confidence") == "High"
                        ? AddressMatchConfidence.High
                        : AddressMatchConfidence.Medium,
                    ambiguous || postalMismatch
                )
                {
                    PostalCodeMismatch = postalMismatch,
                }
            );
        }
        return candidates.DistinctBy(candidate => candidate.Geometry.Position).ToArray();
    }

    private static string? Text(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object
        && element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string NormalizePostalCode(string? value) =>
        string.Concat((value ?? "").Normalize(NormalizationForm.FormKC).Where(char.IsLetterOrDigit))
            .ToUpperInvariant();

    // Japan Post reserves these ranges for individual delivery codes, including large
    // organizations and PO boxes. They need not match a venue's geographic street postcode.
    // Offer same-area street candidates for review; never auto-accept them as precise matches.
    // https://www.post.japanpost.jp/service/search/zipcode/zipmanual/p04.html
    private static bool IsIndividualPostalCodeAlternative(
        string countryCode,
        string expected,
        string actual
    ) =>
        string.Equals(countryCode, "JP", StringComparison.OrdinalIgnoreCase)
        && IsJapanesePostalCode(expected)
        && IsJapanesePostalCode(actual)
        && expected[3] == '8'
        && expected[4] is >= '5' and <= '7'
        && !(actual[3] == '8' && actual[4] is >= '5' and <= '7')
        && expected.AsSpan(0, 3).SequenceEqual(actual.AsSpan(0, 3));

    private static bool IsJapanesePostalCode(string value) =>
        value.Length == 7 && value.All(c => c is >= '0' and <= '9');

    public async Task<GeoJsonPoint?> GeocodeCityAsync(
        string city,
        string countryCode,
        CancellationToken cancellationToken
    )
    {
        string query = Uri.EscapeDataString($"{city}, {countryCode}");
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"geocode?api-version=2026-01-01&query={query}&top=1&resultTypes=PopulatedPlace"
        );
        using var response = await SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(
            await response.Content.ReadAsStreamAsync(cancellationToken)
        );
        if (
            !json.RootElement.TryGetProperty("features", out var features)
            || features.ValueKind != JsonValueKind.Array
            || features.GetArrayLength() == 0
        )
        {
            return null;
        }

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
        {
            return null;
        }

        if (
            !feature.TryGetProperty("geometry", out var geometry)
            || !geometry.TryGetProperty("coordinates", out var point)
            || point.ValueKind != JsonValueKind.Array
            || point.GetArrayLength() < 2
        )
        {
            return null;
        }

        double longitude = point[0].GetDouble(),
            latitude = point[1].GetDouble();
        return
            double.IsFinite(longitude)
            && double.IsFinite(latitude)
            && Math.Abs(longitude) <= 180
            && Math.Abs(latitude) <= 90
            ? new("Point", GeographyPoint.Create(latitude: latitude, longitude: longitude))
            : null;
    }

    public async Task<GeoJsonPoint?> GeocodePlaceAsync(
        string placeName,
        string city,
        string countryCode,
        CancellationToken cancellationToken,
        GeoJsonPoint? center = null
    )
    {
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
            $"search/poi/json?api-version=1.0&query={query}&countrySet={Uri.EscapeDataString(countryCode)}&limit=5&language=en-US{nearby}"
        );
        using var response = await SendAsync(request, cancellationToken);
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
        return await ResolveLandmarkAsync(queryName, city, countryCode, center, cancellationToken);
    }

    private async Task<GeoJsonPoint?> ResolveLandmarkAsync(
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
            $"geocode?api-version=2026-01-01&query={query}&top=3{coordinates}"
        );
        using var response = await SendAsync(request, cancellationToken);
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
