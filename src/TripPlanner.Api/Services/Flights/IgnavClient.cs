using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;

namespace TripPlanner.Api.Services.Flights;

public interface IIgnavClient
{
    Task<JsonElement> SearchAsync(IgnavFareRequest request, CancellationToken cancellationToken);
    Task<JsonElement> GetBookingLinksAsync(string ignavId, CancellationToken cancellationToken);
}

public sealed class IgnavClient(
    HttpClient client,
    IOptions<IgnavOptions> options,
    ILogger<IgnavClient> logger
) : IIgnavClient
{
    private readonly SemaphoreSlim _requests = new(
        Math.Clamp(options.Value.MaxConcurrentRequests, 1, 32)
    );

    public static string Endpoint(IgnavFareRequest request) =>
        request.SearchKind switch
        {
            "oneWay" => "one-way",
            "flexible" => "search",
            "roundTrip" => "round-trip",
            _ => throw new InvalidOperationException("Unsupported fare request kind."),
        };

    internal static object Body(IgnavFareRequest r)
    {
        var body = new Dictionary<string, object?>
        {
            ["adults"] = r.Adults,
            ["cabin_class"] = r.CabinClass,
            ["market"] = r.Market,
            ["allow_self_transfer"] = r.AllowSelfTransfer,
        };
        if (r.SearchKind == "flexible")
        {
            body["legs"] = r.Legs;
        }
        else
        {
            body["origin"] = r.Origin;
            body["destination"] = r.Destination;
            body["departure_date"] = r.DepartureDate;
            if (r.MaxStops is not null)
            {
                body["max_stops"] = r.MaxStops;
            }

            if (r.SearchKind == "roundTrip")
            {
                body["return_date"] = r.ReturnDate;
            }
        }
        return body;
    }

    public async Task<JsonElement> SearchAsync(
        IgnavFareRequest request,
        CancellationToken cancellationToken
    )
    {
        string? key = options.Value.ApiKey;
        if (
            string.IsNullOrWhiteSpace(key)
            || key.StartsWith("@Microsoft.KeyVault", StringComparison.Ordinal)
        )
        {
            throw new InvalidOperationException("Ignav is not configured.");
        }

        using var message = new HttpRequestMessage(
            HttpMethod.Post,
            "https://ignav.com/api/fares/" + Endpoint(request)
        )
        {
            Content = JsonContent.Create(Body(request)),
        };
        message.Headers.Add("X-Api-Key", key);
        await _requests.WaitAsync(cancellationToken);
        try
        {
            using var response = await client.SendAsync(message, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(cancellationToken);
                logger.LogError(
                    "Ignav POST {Endpoint} failed with HTTP {StatusCode} ({ReasonPhrase}). Search {CacheKey}. Response: {ResponseBody}",
                    message.RequestUri,
                    (int)response.StatusCode,
                    Sanitize(response.ReasonPhrase ?? "", key),
                    SearchPlanBuilder.CacheKey(request),
                    string.IsNullOrWhiteSpace(body) ? "(empty response body)" : Sanitize(body, key)
                );
                throw new HttpRequestException(
                    $"Ignav returned HTTP {(int)response.StatusCode}.",
                    null,
                    response.StatusCode
                );
            }
            using var json = await JsonDocument.ParseAsync(
                await response.Content.ReadAsStreamAsync(cancellationToken),
                cancellationToken: cancellationToken
            );
            if (
                json.RootElement.ValueKind != JsonValueKind.Object
                || !json.RootElement.TryGetProperty("itineraries", out var itineraries)
                || itineraries.ValueKind != JsonValueKind.Array
            )
            {
                throw new JsonException("Ignav returned an invalid fare response.");
            }

            return json.RootElement.Clone();
        }
        finally
        {
            _requests.Release();
        }
    }

    public async Task<JsonElement> GetBookingLinksAsync(
        string ignavId,
        CancellationToken cancellationToken
    )
    {
        string? key = options.Value.ApiKey;
        if (
            string.IsNullOrWhiteSpace(key)
            || key.StartsWith("@Microsoft.KeyVault", StringComparison.Ordinal)
        )
        {
            throw new InvalidOperationException("Ignav is not configured.");
        }

        using var message = new HttpRequestMessage(
            HttpMethod.Post,
            "https://ignav.com/api/fares/booking-links"
        )
        {
            Content = JsonContent.Create(new { ignav_id = ignavId }),
        };
        message.Headers.Add("X-Api-Key", key);
        await _requests.WaitAsync(cancellationToken);
        try
        {
            using var response = await client.SendAsync(message, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                throw new HttpRequestException(
                    $"Ignav booking links returned HTTP {(int)response.StatusCode}.",
                    null,
                    response.StatusCode
                );
            }

            using var json = await JsonDocument.ParseAsync(
                await response.Content.ReadAsStreamAsync(cancellationToken),
                cancellationToken: cancellationToken
            );
            return json.RootElement.Clone();
        }
        finally
        {
            _requests.Release();
        }
    }

    private static string Sanitize(string value, string key)
    {
        // Providers may echo a rejected credential, including as an escaped JSON string.
        var escapedKey = JsonSerializer.Serialize(key)[1..^1];
        var safe = value
            .Replace(escapedKey, "[REDACTED]", StringComparison.Ordinal)
            .Replace(key, "[REDACTED]", StringComparison.Ordinal)
            .Replace('\r', ' ')
            .Replace('\n', ' ');
        const int limit = 4096;
        return safe.Length <= limit ? safe : safe[..limit] + " [truncated]";
    }
}
