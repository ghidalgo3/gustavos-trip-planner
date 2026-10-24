using System.Text.Encodings.Web;
using System.Text.Json;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services.Flights;

public static class FlightChoiceRoute
{
    private sealed record SearchEdge(string Origin, string Destination);

    private static readonly JsonSerializerOptions FlightKeyJson = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    // Flight keys identify fares the browser actually received. Search requests,
    // rather than provider endpoint substitutions, identify the planned cities.
    public static string[]? NextOrigins(
        PlanningDocument document,
        Guid partyId,
        IReadOnlyList<string?> legKeys,
        IReadOnlyList<FareSearchResult> fares,
        AirportCatalog airports
    )
    {
        if (legKeys.Count == 0)
        {
            return [];
        }

        var home = document.Parties.SingleOrDefault(p => p.PartyId == partyId)?.Origin;
        if (home is null || legKeys.Count > document.Visits.Length + 1)
        {
            return null;
        }

        var candidates = legKeys
            .Select(key => key is null ? [] : SearchEdges(key, partyId, fares).Distinct().ToArray())
            .ToArray();
        if (
            candidates
                .Where((edges, index) => legKeys[index] is not null)
                .Any(edges => edges.Length == 0)
        )
        {
            return null;
        }

        var next = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var validOrder = false;
        foreach (var order in MultiCityPlanner.Orders(document.Visits))
        {
            var matches = true;
            for (int i = 0; i < candidates.Length; i++)
            {
                if (legKeys[i] is null)
                {
                    continue;
                }
                var origin = i == 0 ? home : order[i - 1].Location;
                var destination = i == order.Length ? home : order[i].Location;
                if (
                    origin is null
                    || destination is null
                    || !candidates[i]
                        .Any(edge =>
                            Matches(origin, edge.Origin, airports)
                            && Matches(destination, edge.Destination, airports)
                        )
                )
                {
                    matches = false;
                    break;
                }
            }
            if (!matches)
            {
                continue;
            }

            validOrder = true;
            var nextIndex = Enumerable
                .Range(0, order.Length + 1)
                .FirstOrDefault(
                    index => index >= legKeys.Count || legKeys[index] is null,
                    order.Length + 1
                );
            if (nextIndex <= order.Length)
            {
                var location = nextIndex == 0 ? home : order[nextIndex - 1].Location!;
                next.UnionWith(location.AirportCodes);
                next.Add(airports.SearchCode(location));
            }
        }
        return validOrder ? next.Order(StringComparer.OrdinalIgnoreCase).ToArray() : null;
    }

    private static bool Matches(
        SearchLocation location,
        string queryCode,
        AirportCatalog airports
    ) =>
        location.AirportCodes.Contains(queryCode, StringComparer.OrdinalIgnoreCase)
        || string.Equals(
            airports.SearchCode(location),
            queryCode,
            StringComparison.OrdinalIgnoreCase
        );

    private static IEnumerable<SearchEdge> SearchEdges(
        string key,
        Guid partyId,
        IReadOnlyList<FareSearchResult> fares
    )
    {
        foreach (var fare in fares.Where(f => f.PartyId == partyId))
        {
            if (
                fare.Response.ValueKind != JsonValueKind.Object
                || !fare.Response.TryGetProperty("itineraries", out var itineraries)
                || itineraries.ValueKind != JsonValueKind.Array
            )
            {
                continue;
            }

            foreach (var itinerary in itineraries.EnumerateArray())
            {
                if (itinerary.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                if (
                    fare.Request.SearchKind == "oneWay"
                    && itinerary.TryGetProperty("outbound", out var outbound)
                    && FlightKey(outbound) == key
                )
                {
                    yield return new(fare.Request.Origin, fare.Request.Destination);
                }

                if (
                    fare.Request.SearchKind != "flexible"
                    || fare.Request.Legs is not { } requests
                    || !itinerary.TryGetProperty("legs", out var legs)
                    || legs.ValueKind != JsonValueKind.Array
                    || legs.GetArrayLength() != requests.Length
                )
                {
                    continue;
                }

                for (int i = 0; i < requests.Length; i++)
                {
                    if (FlightKey(legs[i]) == key)
                    {
                        yield return new(requests[i].Origin, requests[i].Destination);
                    }
                }
            }
        }
    }

    public static string? FlightKey(JsonElement leg)
    {
        if (
            leg.ValueKind != JsonValueKind.Object
            || !leg.TryGetProperty("segments", out var segments)
            || segments.ValueKind != JsonValueKind.Array
            || segments.GetArrayLength() == 0
        )
        {
            return null;
        }

        var values = new List<string?[]>();
        foreach (var segment in segments.EnumerateArray())
        {
            if (segment.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            values.Add([
                Text(segment, "departure_airport"),
                Text(segment, "arrival_airport"),
                Text(segment, "departure_time_utc") ?? Text(segment, "departure_time_local"),
                Text(segment, "arrival_time_utc") ?? Text(segment, "arrival_time_local"),
                Text(segment, "marketing_carrier_code"),
                Text(segment, "flight_number"),
            ]);
        }
        return JsonSerializer.Serialize(values, FlightKeyJson);
    }

    private static string? Text(JsonElement value, string name) =>
        value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
}
