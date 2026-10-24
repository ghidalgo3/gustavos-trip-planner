using System.Globalization;
using System.Text.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Flights;

namespace TripPlanner.Api.Services.ActivityPlanning;

public sealed class ActivityFlightAvailability(AirportCatalog airports)
{
    public ActivityAvailabilitySuggestion[] Suggest(
        ActivityPlanningContext planningContext,
        ActivityPlan plan
    )
    {
        var zone = ActivityPlanRules.Zone(
            ActivityPlanRules.EffectiveTimeZone(plan, planningContext)
        );
        if (zone is null)
        {
            return [];
        }

        var result = new List<ActivityAvailabilitySuggestion>();
        foreach (var visit in planningContext.Visits)
        {
            foreach (
                var date in new[] { visit.ArrivalDate, visit.DepartureDate }
                    .OfType<DateOnly>()
                    .Distinct()
            )
            {
                var day = plan.Days.FirstOrDefault(d => d.StayId == visit.StayId && d.Date == date);
                var settings = day?.Settings ?? plan.Settings;
                var arrivals = new List<DateTimeOffset>();
                var departures = new List<DateTimeOffset>();
                var choices = new List<string>();
                var availableCandidates = new List<ActivityFlightCandidate>();
                bool ambiguous = false;
                foreach (var traveller in planningContext.Travellers)
                {
                    var parties = planningContext
                        .Parties.Where(p => p.UserIds.Contains(traveller.Id))
                        .Select(p => p.Id)
                        .ToArray();
                    var flights = planningContext
                        .Flights.Where(f => parties.Contains(f.PartyId))
                        .ToArray();
                    var ends = flights.SelectMany(f => Legs(f.Itinerary)).ToArray();
                    ActivityFlightCandidate[] Candidates(bool arrival) =>
                        ends.Select(leg => arrival ? leg.Last() : leg.First())
                            .Where(segment =>
                            {
                                var airport = airports.FindByCode(
                                    Text(segment, arrival ? "arrival_airport" : "departure_airport")
                                        ?? ""
                                );
                                return airport is not null
                                    && ActivityPlanningContext.Distance(
                                        Microsoft.Spatial.GeographyPoint.Create(
                                            airport.Latitude,
                                            airport.Longitude
                                        ),
                                        Microsoft.Spatial.GeographyPoint.Create(
                                            planningContext.Place.Latitude,
                                            planningContext.Place.Longitude
                                        )
                                    ) <= 150;
                            })
                            .Select(segment =>
                                (Segment: segment, Time: ReadInstant(segment, arrival, zone))
                            )
                            .Where(candidate =>
                                candidate.Time is { } time
                                && DateOnly.FromDateTime(time.DateTime) == date
                            )
                            .Select(candidate => new ActivityFlightCandidate(
                                ActivityPlanRules.Hash(
                                    new
                                    {
                                        traveller.Id,
                                        arrival,
                                        candidate.Segment,
                                    }
                                ),
                                traveller.Id,
                                traveller.DisplayName,
                                arrival ? "arrival" : "departure",
                                candidate.Time!.Value
                            ))
                            .DistinctBy(c => c.Id)
                            .ToArray();
                    DateTimeOffset? Choose(ActivityFlightCandidate[] candidates, string direction)
                    {
                        availableCandidates.AddRange(candidates);
                        var match = day?.FlightMatches.FirstOrDefault(m =>
                            m.TravellerId == traveller.Id && m.Direction == direction
                        );
                        return match is not null
                                ? candidates.FirstOrDefault(c => c.Id == match.CandidateId)?.Time
                            : candidates.Length == 1 ? candidates[0].Time
                            : null;
                    }
                    if (date == visit.ArrivalDate)
                    {
                        var candidates = Candidates(true);
                        if (Choose(candidates, "arrival") is not { } chosen)
                        {
                            ambiguous = true;
                        }
                        else
                        {
                            arrivals.Add(
                                chosen.Add(
                                    settings.AirportArrivalBufferDuration
                                        + settings.AirportTransferDuration
                                )
                            );
                        }

                        choices.AddRange(
                            candidates.Select(t =>
                                $"{traveller.DisplayName}: arrival {t.Time:yyyy-MM-dd HH:mm zzz}"
                            )
                        );
                    }
                    if (date == visit.DepartureDate)
                    {
                        var candidates = Candidates(false);
                        if (Choose(candidates, "departure") is not { } chosen)
                        {
                            ambiguous = true;
                        }
                        else
                        {
                            departures.Add(
                                chosen.Add(
                                    -settings.AirportDepartureBufferDuration
                                        - settings.AirportTransferDuration
                                )
                            );
                        }

                        choices.AddRange(
                            candidates.Select(t =>
                                $"{traveller.DisplayName}: departure {t.Time:yyyy-MM-dd HH:mm zzz}"
                            )
                        );
                    }
                }
                DateTimeOffset? from = arrivals.Count > 0 ? arrivals.Max() : null,
                    until = departures.Count > 0 ? departures.Min() : null;
                if (
                    from is { } f && DateOnly.FromDateTime(f.DateTime) != date
                    || until is { } u && DateOnly.FromDateTime(u.DateTime) != date
                    || from > until
                )
                {
                    ambiguous = true;
                }

                result.Add(
                    new(
                        visit.StayId,
                        date,
                        ambiguous || from is null
                            ? null
                            : new TimeOnly(from.Value.Hour, from.Value.Minute),
                        ambiguous || until is null
                            ? null
                            : new TimeOnly(until.Value.Hour, until.Value.Minute),
                        ambiguous,
                        ambiguous
                            ? "Choose the matching flights and assess the draft again, or enter availability manually. Some travellers have missing or ambiguous flight-to-visit matches, or buffers cross a date boundary."
                            : "Proposed shared availability uses the latest traveller arrival and earliest departure, including your airport and transfer buffers. Confirm before using it.",
                        [.. choices]
                    )
                    {
                        Candidates = [.. availableCandidates],
                    }
                );
            }
        }
        return [.. result];
    }

    private DateTimeOffset? ReadInstant(
        JsonElement segment,
        bool arrival,
        TimeZoneInfo destinationZone
    )
    {
        string key = arrival ? "arrival" : "departure";
        if (
            DateTimeOffset.TryParse(
                Text(segment, key + "_time_utc"),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal,
                out var utc
            )
        )
        {
            return TimeZoneInfo.ConvertTime(utc, destinationZone);
        }

        var airport = airports.FindByCode(Text(segment, key + "_airport") ?? "");
        var zone = ActivityPlanRules.Zone(airport?.TimeZone);
        if (
            zone is null
            || !DateTime.TryParse(
                Text(segment, key + "_time_local"),
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var local
            )
        )
        {
            return null;
        }

        local = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        return zone.IsAmbiguousTime(local) || zone.IsInvalidTime(local)
            ? null
            : TimeZoneInfo.ConvertTime(
                new DateTimeOffset(local, zone.GetUtcOffset(local)),
                destinationZone
            );
    }

    private static string? Text(JsonElement item, string key) =>
        item.ValueKind == JsonValueKind.Object
        && item.TryGetProperty(key, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static IEnumerable<JsonElement[]> Legs(JsonElement itinerary)
    {
        if (itinerary.ValueKind != JsonValueKind.Object)
        {
            yield break;
        }

        if (
            itinerary.TryGetProperty("segments", out var segments)
            && segments.ValueKind == JsonValueKind.Array
            && segments.GetArrayLength() > 0
        )
        {
            yield return segments.EnumerateArray().ToArray();
            yield break;
        }
        foreach (var property in itinerary.EnumerateObject())
        {
            if (property.Name is not ("legs" or "outbound" or "inbound"))
            {
                continue;
            }

            if (property.Value.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in property.Value.EnumerateArray())
                {
                    foreach (var leg in Legs(item))
                    {
                        yield return leg;
                    }
                }
            }
            else
            {
                foreach (var leg in Legs(property.Value))
                {
                    yield return leg;
                }
            }
        }
    }
}
