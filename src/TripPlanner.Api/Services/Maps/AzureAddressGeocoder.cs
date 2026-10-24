using System.Globalization;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services.Maps;

public interface IAddressGeocoder
{
    Task<IReadOnlyList<AddressLocationCandidate>> FindAsync(
        string address,
        string city,
        string countryCode,
        CancellationToken cancellationToken,
        GeoJsonPoint? center = null,
        StructuredAddress? structuredAddress = null
    );
}

public sealed class AzureAddressGeocoder(
    HttpClient client,
    IMapTokenProvider tokens,
    ILogger<AzureAddressGeocoder> logger
) : IAddressGeocoder
{
    public async Task<IReadOnlyList<AddressLocationCandidate>> FindAsync(
        string address,
        string city,
        string countryCode,
        CancellationToken cancellationToken,
        GeoJsonPoint? center = null,
        StructuredAddress? structuredAddress = null
    )
    {
        var token = await tokens.GetTokenAsync(cancellationToken);
        var candidates = await SearchAsync(
            token,
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
                var structured = await SearchAsync(
                    token,
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

    private async Task<IReadOnlyList<AddressLocationCandidate>> SearchAsync(
        MapToken token,
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
            $"{token.Endpoint.TrimEnd('/')}/geocode?api-version=2026-01-01&{query}&top=5{coordinates}"
        );
        request.Headers.TryAddWithoutValidation("Authorization", $"jwt-sas {token.Token}");
        using var response = await client.SendAsync(request, cancellationToken);
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
            if (
                !string.IsNullOrWhiteSpace(postalCode)
                && NormalizePostalCode(postalCode)
                    != NormalizePostalCode(Text(address, "postalCode"))
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
            if (MapGeometry.IsNearby(point, center))
            {
                candidates.Add(
                    new(
                        point,
                        formatted,
                        Text(properties, "confidence") == "High"
                            ? AddressMatchConfidence.High
                            : AddressMatchConfidence.Medium,
                        ambiguous
                    )
                );
            }
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
        string.Concat((value ?? "").Where(char.IsLetterOrDigit)).ToUpperInvariant();
}
