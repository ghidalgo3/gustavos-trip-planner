using System.Globalization;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Services.Maps;

namespace TripPlanner.Api.Services.Destinations;

public interface IDestinationTimeZoneResolver
{
    Task<string?> ResolveAsync(GeographyPoint point, CancellationToken cancellationToken);
}

public sealed class AzureDestinationTimeZoneResolver(
    HttpClient client,
    IMapTokenProvider tokens,
    ILogger<AzureDestinationTimeZoneResolver> logger
) : IDestinationTimeZoneResolver
{
    public async Task<string?> ResolveAsync(
        GeographyPoint point,
        CancellationToken cancellationToken
    )
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(10));
        try
        {
            var token = await tokens.GetTokenAsync(deadline.Token);
            string coordinates = string.Create(
                CultureInfo.InvariantCulture,
                $"{point.Latitude},{point.Longitude}"
            );
            using var request = new HttpRequestMessage(
                HttpMethod.Get,
                $"{token.Endpoint.TrimEnd('/')}/timezone/byCoordinates/json?api-version=1.0&options=none&query={coordinates}"
            );
            request.Headers.TryAddWithoutValidation("Authorization", $"jwt-sas {token.Token}");
            using var response = await client.SendAsync(request, deadline.Token);
            response.EnsureSuccessStatusCode();
            using var json = await JsonDocument.ParseAsync(
                await response.Content.ReadAsStreamAsync(deadline.Token),
                cancellationToken: deadline.Token
            );
            // Version 1.0 responses use PascalCase; accept the documented camelCase too.
            if (
                Property(json.RootElement, "TimeZones", "timeZones")
                    is { ValueKind: JsonValueKind.Array } zones
                && zones.GetArrayLength() == 1
                && Property(zones[0], "Id", "id") is { ValueKind: JsonValueKind.String } id
                && TimeZoneInfo.TryFindSystemTimeZoneById(id.GetString()!, out var zone)
                && zone.HasIanaId
            )
            {
                return zone.Id;
            }
            logger.LogWarning("Destination timezone lookup returned no recognized IANA timezone.");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Destination timezone lookup timed out.");
        }
        catch (HttpRequestException exception)
        {
            logger.LogWarning(
                "Destination timezone lookup failed; HTTP status {StatusCode}.",
                exception.StatusCode
            );
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException)
        {
            logger.LogWarning(
                "Destination timezone lookup unavailable: {ErrorType}.",
                exception.GetType().Name
            );
        }
        // Keep the destination usable without inventing a timezone or UTC offset.
        return null;
    }

    private static JsonElement? Property(JsonElement value, string name, string alternate) =>
        value.ValueKind == JsonValueKind.Object
        && (
            value.TryGetProperty(name, out var result)
            || value.TryGetProperty(alternate, out result)
        )
            ? result
            : null;
}
