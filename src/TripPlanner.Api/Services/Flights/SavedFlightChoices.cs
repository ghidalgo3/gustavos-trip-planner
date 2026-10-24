using System.Text.Json;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services.Flights;

public static class SavedFlightChoices
{
    public static IReadOnlyList<FareSearchResult> Restore(
        IReadOnlyList<FareSearchResult>? current,
        IReadOnlyList<FlightChoiceProgress> choices,
        SearchPlanPreview preview
    )
    {
        var requests = preview
            .Parties.SelectMany(party =>
                party.Requests.Select(request => (party.PartyId, request.CacheKey))
            )
            .ToHashSet();
        return (current ?? [])
            .Concat(choices.SelectMany(choice => choice.SavedFares))
            .Where(fare => requests.Contains((fare.PartyId, fare.CacheKey)))
            .GroupBy(fare => (fare.PartyId, fare.CacheKey))
            .Select(group =>
                group.First() with
                {
                    FetchedAt = group.Min(fare => fare.FetchedAt),
                    ExpiresAt = group.Min(fare => fare.ExpiresAt),
                    Response = JsonSerializer.SerializeToElement(
                        new
                        {
                            itineraries = group
                                .SelectMany(Itineraries)
                                .DistinctBy(itinerary => itinerary.GetRawText())
                                .ToArray(),
                        }
                    ),
                }
            )
            .ToArray();
    }

    public static FareSearchResult[] Capture(
        Guid partyId,
        IReadOnlyList<string?> keys,
        IReadOnlyList<FareSearchResult> fares
    )
    {
        var selected = keys.OfType<string>().ToHashSet(StringComparer.Ordinal);
        return fares
            .Where(fare => fare.PartyId == partyId)
            .Select(fare =>
                (
                    Fare: fare,
                    Offers: Itineraries(fare)
                        .Where(offer => FlightKeys(offer).Any(selected.Contains))
                        .ToArray()
                )
            )
            .Where(item => item.Offers.Length > 0)
            .Select(item =>
                item.Fare with
                {
                    Response = JsonSerializer.SerializeToElement(new { itineraries = item.Offers }),
                }
            )
            .ToArray();
    }

    public static SearchPlanPreview RemainingSearches(
        SearchPlanPreview preview,
        IReadOnlyList<FlightChoiceProgress> choices
    ) =>
        preview with
        {
            Parties = preview
                .Parties.Select(party =>
                {
                    var choice = choices.FirstOrDefault(item => item.PartyId == party.PartyId);
                    if (choice is null)
                    {
                        return party;
                    }
                    var retainedByLeg = party
                        .Requests.SelectMany(request =>
                            request.LegIndexes.Select(index =>
                                (
                                    Index: index,
                                    Keys: choice
                                        .SavedFares.Where(fare => fare.CacheKey == request.CacheKey)
                                        .SelectMany(Itineraries)
                                        .SelectMany(FlightKeys)
                                )
                            )
                        )
                        .GroupBy(item => item.Index)
                        .ToDictionary(
                            group => group.Key,
                            group => group.SelectMany(item => item.Keys).ToHashSet()
                        );
                    bool Selected(int index) =>
                        index < choice.LegKeys.Length
                        && choice.LegKeys[index] is { } key
                        && retainedByLeg.TryGetValue(index, out var keys)
                        && keys.Contains(key);
                    return party with
                    {
                        // A bundled request would search the chosen leg again. Unchosen legs
                        // still have their own one-way requests. Shared one-way queries remain
                        // necessary while any of the visits they cover is unselected.
                        Requests = party
                            .Requests.Where(request =>
                                request.LegIndexes.Length == 0
                                || (
                                    request.Body.SearchKind == "flexible"
                                        ? !request.LegIndexes.Any(Selected)
                                        : !request.LegIndexes.All(Selected)
                                )
                            )
                            .ToArray(),
                    };
                })
                .ToArray(),
        };

    private static IEnumerable<JsonElement> Itineraries(FareSearchResult fare) =>
        fare.Response.ValueKind == JsonValueKind.Object
        && fare.Response.TryGetProperty("itineraries", out var itineraries)
        && itineraries.ValueKind == JsonValueKind.Array
            ? itineraries.EnumerateArray()
            : [];

    private static IEnumerable<string> FlightKeys(JsonElement offer)
    {
        if (offer.ValueKind != JsonValueKind.Object)
        {
            yield break;
        }
        if (
            offer.TryGetProperty("outbound", out var outbound)
            && FlightChoiceRoute.FlightKey(outbound) is { } outboundKey
        )
        {
            yield return outboundKey;
        }
        if (offer.TryGetProperty("legs", out var legs) && legs.ValueKind == JsonValueKind.Array)
        {
            foreach (var leg in legs.EnumerateArray())
            {
                if (FlightChoiceRoute.FlightKey(leg) is { } key)
                {
                    yield return key;
                }
            }
        }
    }
}
