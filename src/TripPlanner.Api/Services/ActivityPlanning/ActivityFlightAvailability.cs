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
        return SuggestKnown(planningContext with { FlightLegs = ReadLegs(planningContext) }, plan);
    }

    public static ActivityAvailabilitySuggestion[] SuggestKnown(
        ActivityPlanningContext planningContext,
        ActivityPlan plan
    )
    {
        var zone = ActivityPlanRules.Zone(
            (
                string.IsNullOrWhiteSpace(planningContext.Place.TimeZone)
                    ? ActivityPlanRules.EffectiveTimeZone(plan, planningContext)
                    : planningContext.Place.TimeZone
            )
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
                    ActivityFlightCandidate[] Candidates(bool arrival) =>
                        planningContext
                            .FlightLegs.Where(leg =>
                                leg.TravellerId == traveller.Id
                                && (arrival ? leg.ArrivesDestination : leg.DepartsDestination)
                            )
                            .Select(leg => (Leg: leg, Time: arrival ? leg.Arrival : leg.Departure))
                            .Where(c =>
                                c.Time is { } instant
                                && DateOnly.FromDateTime(
                                    TimeZoneInfo.ConvertTime(instant, zone).DateTime
                                ) == date
                            )
                            .Select(c => new ActivityFlightCandidate(
                                arrival ? c.Leg.ArrivalCandidateId : c.Leg.DepartureCandidateId,
                                traveller.Id,
                                traveller.DisplayName,
                                arrival ? "arrival" : "departure",
                                TimeZoneInfo.ConvertTime(c.Time!.Value, zone)
                            )
                            {
                                DepartureAirport = c.Leg.DepartureAirport,
                                ArrivalAirport = c.Leg.ArrivalAirport,
                                Departure = c.Leg.Departure is { } departure
                                    ? TimeZoneInfo.ConvertTime(departure, zone)
                                    : null,
                                Arrival = c.Leg.Arrival is { } landing
                                    ? TimeZoneInfo.ConvertTime(landing, zone)
                                    : null,
                            })
                            .DistinctBy(c => c.Id)
                            .ToArray();
                    DateTimeOffset? Choose(ActivityFlightCandidate[] candidates, string direction)
                    {
                        var match = day?.FlightMatches.FirstOrDefault(m =>
                            m.TravellerId == traveller.Id && m.Direction == direction
                        );
                        var selected =
                            match is not null
                                ? candidates.FirstOrDefault(c => c.Id == match.CandidateId)
                            : candidates.Length == 1 ? candidates[0]
                            : null;
                        availableCandidates.AddRange(
                            candidates.Select(c => c with { Selected = c.Id == selected?.Id })
                        );
                        if (selected is null && candidates.Length > 1)
                        {
                            ambiguous = true;
                            return direction == "arrival"
                                ? candidates.Max(c => c.Time)
                                : candidates.Min(c => c.Time);
                        }
                        return selected?.Time;
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
                                TimeZoneInfo.ConvertTime(
                                    chosen.Add(
                                        settings.AirportArrivalBufferDuration
                                            + settings.AirportTransferDuration
                                    ),
                                    zone
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
                                TimeZoneInfo.ConvertTime(
                                    chosen.Add(
                                        -settings.AirportDepartureBufferDuration
                                            - settings.AirportTransferDuration
                                    ),
                                    zone
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
                            : "Proposed shared availability uses the latest traveller arrival and earliest departure, including your airport and transfer buffers. Selected flights automatically limit activity planning.",
                        [.. choices]
                    )
                    {
                        Candidates = [.. availableCandidates],
                        AvailableFromInstant = from,
                        AvailableUntilInstant = until,
                    }
                );
            }
        }
        return [.. result];
    }

    public static ActivityAvailabilitySuggestion? ForDay(
        ActivityAvailabilitySuggestion[] suggestions,
        ActivityPlanDay day
    )
    {
        var visit = suggestions.Where(s => s.StayId == day.StayId).ToArray();
        if (visit.Length == 0)
        {
            return null;
        }
        var starts = visit.Select(s => s.AvailableFromInstant).OfType<DateTimeOffset>().ToArray();
        var ends = visit.Select(s => s.AvailableUntilInstant).OfType<DateTimeOffset>().ToArray();
        return visit[0] with
        {
            Date = day.Date,
            Ambiguous = visit.Any(s => s.Ambiguous),
            AvailableFromInstant = starts.Length > 0 ? starts.Max() : null,
            AvailableUntilInstant = ends.Length > 0 ? ends.Min() : null,
            Candidates = visit.SelectMany(s => s.Candidates).DistinctBy(c => c.Id).ToArray(),
        };
    }

    public static bool IncludesMeal(
        ActivityPlanDay day,
        DailyPlanningSettings settings,
        TimeZoneInfo zone,
        ActivityAvailabilitySuggestion? window,
        string meal
    )
    {
        var target = meal switch
        {
            "breakfast" => settings.SleepEnd.ToTimeSpan(),
            "lunch" => new TimeOnly(13, 0).ToTimeSpan(),
            _ => ActivityPlanRules.DinnerTarget.ToTimeSpan(),
        };
        var instant = ActivityPlanRules.Instant(day.Date, target, zone);
        return instant is null
            || !(
                window?.AvailableFromInstant is { } ready && instant < ready
                || window?.AvailableUntilInstant is { } leave && instant >= leave
            );
    }

    public ActivityFlightLeg[] ReadLegs(ActivityPlanningContext context)
    {
        var zone = ActivityPlanRules.Zone(context.Place.TimeZone) ?? TimeZoneInfo.Utc;
        bool Nearby(string? code)
        {
            var airport = airports.FindByCode(code ?? "");
            return airport is not null
                && ActivityPlanningContext.Distance(
                    Microsoft.Spatial.GeographyPoint.Create(airport.Latitude, airport.Longitude),
                    Microsoft.Spatial.GeographyPoint.Create(
                        context.Place.Latitude,
                        context.Place.Longitude
                    )
                ) <= 150;
        }
        return context
            .Travellers.SelectMany(traveller =>
            {
                var parties = context
                    .Parties.Where(p => p.UserIds.Contains(traveller.Id))
                    .Select(p => p.Id)
                    .ToHashSet();
                return context
                    .Flights.Where(f =>
                        parties.Contains(f.PartyId)
                        && !context.FlightChoices.Any(c =>
                            c.PartyId == f.PartyId
                            && (c.LegKeys.Length == 0 || c.SavedFares.Length > 0)
                        )
                    )
                    .SelectMany(f => Legs(f.Itinerary))
                    .Concat(
                        context
                            .FlightChoices.Where(c => parties.Contains(c.PartyId))
                            .SelectMany(SavedFlightChoices.SelectedLegs)
                            .SelectMany(leg => Legs(leg.Leg))
                    )
                    .Select(leg => new ActivityFlightLeg(
                        traveller.Id,
                        traveller.DisplayName,
                        Text(leg[0], "departure_airport") ?? "",
                        Text(leg[^1], "arrival_airport") ?? "",
                        ReadInstant(leg[0], false, zone),
                        ReadInstant(leg[^1], true, zone),
                        Nearby(Text(leg[0], "departure_airport")),
                        Nearby(Text(leg[^1], "arrival_airport")),
                        ActivityPlanRules.Hash(
                            new
                            {
                                traveller.Id,
                                arrival = false,
                                Segment = leg[0],
                            }
                        ),
                        ActivityPlanRules.Hash(
                            new
                            {
                                traveller.Id,
                                arrival = true,
                                Segment = leg[^1],
                            }
                        )
                    ))
                    .DistinctBy(leg => (leg.ArrivalCandidateId, leg.DepartureCandidateId));
            })
            .ToArray();
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
