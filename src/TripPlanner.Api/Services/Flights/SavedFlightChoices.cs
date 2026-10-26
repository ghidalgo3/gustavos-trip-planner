using System.Text.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services.Flights;

public static class SavedFlightChoices
{
    public static FlightChoiceLegRoute[] Bind(
        PlanningDocument document,
        IReadOnlyList<string?> keys
    ) =>
        keys.Select((key, index) => (key, index))
            .Where(item => item.key is not null && item.index <= document.Visits.Length)
            .Select(item => new FlightChoiceLegRoute(
                item.key!,
                item.index == 0 ? null : document.Visits[item.index - 1].Id,
                item.index == document.Visits.Length ? null : document.Visits[item.index].Id
            ))
            .ToArray();

    // Reconcile on read without modifying storage. Older choices have no visit IDs;
    // only an unambiguous match of retained search endpoints and flight dates is safe.
    public static FlightChoiceProgress Reconcile(
        FlightChoiceProgress choice,
        PlanningDocument document,
        AirportCatalog airports
    )
    {
        if (document.Visits.Length == 0)
        {
            return choice;
        }
        var allKeys = choice
            .LegKeys.OfType<string>()
            .Concat(choice.UnmatchedLegKeys)
            .Distinct()
            .ToArray();
        var legs = SelectedLegs(choice with { LegKeys = allKeys })
            .ToDictionary(item => FlightChoiceRoute.FlightKey(item.Leg)!, item => item.Leg);
        var home = document
            .Parties.FirstOrDefault(party => party.PartyId == choice.PartyId)
            ?.Origin;
        var bindings = choice.LegRoutes ?? [];
        var candidates = allKeys
            .Select(key =>
            {
                var binding = bindings.FirstOrDefault(item => item.Key == key);
                var indexes = Enumerable
                    .Range(0, document.Visits.Length + 1)
                    .Where(index =>
                    {
                        if (
                            binding is not null
                            && (
                                binding.OriginVisitId
                                    != (index == 0 ? null : (Guid?)document.Visits[index - 1].Id)
                                || binding.DestinationVisitId
                                    != (
                                        index == document.Visits.Length
                                            ? null
                                            : (Guid?)document.Visits[index].Id
                                    )
                            )
                        )
                        {
                            return false;
                        }
                        var origin = index == 0 ? home : document.Visits[index - 1].Location;
                        var destination =
                            index == document.Visits.Length
                                ? home
                                : document.Visits[index].Location;
                        if (
                            origin is null
                            || destination is null
                            || !legs.TryGetValue(key, out var leg)
                        )
                        {
                            return false;
                        }
                        return FlightChoiceRoute
                                .SearchEdges(key, choice.PartyId, choice.SavedFares)
                                .Any(edge =>
                                    FlightChoiceRoute.Matches(origin, edge.Origin, airports)
                                    && FlightChoiceRoute.Matches(
                                        destination,
                                        edge.Destination,
                                        airports
                                    )
                                )
                            && (
                                index == 0
                                || FitsDate(
                                    leg,
                                    document.Visits[index - 1],
                                    document,
                                    arrival: false
                                )
                            )
                            && (
                                index == document.Visits.Length
                                || FitsDate(leg, document.Visits[index], document, arrival: true)
                            );
                    })
                    .ToArray();
                return (Key: key, Index: indexes.Length == 1 ? (int?)indexes[0] : null);
            })
            .ToArray();
        var keys = new string?[document.Visits.Length + 1];
        foreach (
            var group in candidates
                .Where(item => item.Index is not null)
                .GroupBy(item => item.Index!.Value)
        )
        {
            if (group.Count() == 1)
            {
                keys[group.Key] = group.Single().Key;
            }
        }
        keys = keys.Reverse().SkipWhile(key => key is null).Reverse().ToArray();
        var unmatched = allKeys.Except(keys.OfType<string>()).ToArray();
        return choice with
        {
            LegKeys = keys,
            LegRoutes = Bind(document, keys)
                .Concat(bindings.Where(binding => unmatched.Contains(binding.Key)))
                .ToArray(),
            UnmatchedLegKeys = unmatched,
            NextOrigins =
                FlightChoiceRoute.NextOrigins(
                    document,
                    choice.PartyId,
                    keys,
                    choice.SavedFares,
                    airports
                ) ?? [],
        };
    }

    public static JsonElement[] UnmatchedFlights(FlightChoiceProgress choice) =>
        SelectedLegs(choice with { LegKeys = choice.UnmatchedLegKeys })
            .Select(item => item.Leg)
            .ToArray();

    private static bool FitsDate(
        JsonElement leg,
        PlannedVisit visit,
        PlanningDocument document,
        bool arrival
    )
    {
        var target = arrival ? visit.PresentFrom : visit.PresentThrough;
        if (target is null)
        {
            return true;
        }
        var segments = leg.GetProperty("segments");
        var segment = segments[arrival ? segments.GetArrayLength() - 1 : 0];
        var name = arrival ? "arrival_time_local" : "departure_time_local";
        if (
            !segment.TryGetProperty(name, out var value)
            || value.ValueKind != JsonValueKind.String
            || value.GetString() is not { Length: >= 10 } text
            || !DateOnly.TryParseExact(text[..10], "yyyy-MM-dd", out var date)
        )
        {
            return false;
        }
        var flexibility = arrival ? visit.ArrivalFlexibilityDays : visit.DepartureFlexibilityDays;
        var difference = date.DayNumber - target.Value.DayNumber;
        return flexibility is { } days ? Math.Abs(difference) <= days
            : arrival ? difference <= 0 && difference >= -document.SearchLimits.FlexibilityDays
            : difference >= 0 && difference <= document.SearchLimits.FlexibilityDays;
    }

    public static FlightChoiceLegDto[] SelectedLegs(FlightChoiceProgress choice)
    {
        var legs = choice
            .SavedFares.Where(fare => fare.PartyId == choice.PartyId)
            .SelectMany(Itineraries)
            .SelectMany(FlightLegs)
            .Where(leg => FlightChoiceRoute.FlightKey(leg) is not null)
            .DistinctBy(FlightChoiceRoute.FlightKey)
            .ToDictionary(leg => FlightChoiceRoute.FlightKey(leg)!, leg => leg);
        return choice
            .LegKeys.Select((key, index) => (key, index))
            .Where(item => item.key is not null && legs.ContainsKey(item.key))
            .Select(item => new FlightChoiceLegDto(item.index, legs[item.key!]))
            .ToArray();
    }

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

    private static IEnumerable<string> FlightKeys(JsonElement offer) =>
        FlightLegs(offer).Select(FlightChoiceRoute.FlightKey).OfType<string>();

    private static IEnumerable<JsonElement> FlightLegs(JsonElement offer)
    {
        if (offer.ValueKind != JsonValueKind.Object)
        {
            yield break;
        }
        if (
            offer.TryGetProperty("outbound", out var outbound)
            && outbound.ValueKind == JsonValueKind.Object
        )
        {
            yield return outbound;
        }
        if (offer.TryGetProperty("legs", out var legs) && legs.ValueKind == JsonValueKind.Array)
        {
            foreach (var leg in legs.EnumerateArray())
            {
                yield return leg;
            }
        }
    }
}
