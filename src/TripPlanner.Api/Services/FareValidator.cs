using System.Globalization;
using System.Text.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services;

// Evaluations are derived from the saved trip and cached provider response on every GET.
// They are intentionally not stored with the fare so preference and constraint edits can reuse it.
public sealed class FareValidator(AirportCatalog airports)
{
    public IReadOnlyList<FareEvaluationDto> Evaluate(
        FareSearchResult fare,
        PlanningDocument document,
        Party party
    )
    {
        if (
            !fare.Response.TryGetProperty("itineraries", out var itineraries)
            || itineraries.ValueKind != JsonValueKind.Array
        )
            return [];
        var settings = document.Parties.Single(p => p.PartyId == party.Id);
        var constraints = document
            .Constraints.Where(c => party.UserIds.Contains(c.UserId))
            .ToArray();
        return itineraries
            .EnumerateArray()
            .Select(itinerary => EvaluateItinerary(itinerary, fare.Request, settings, constraints))
            .ToArray();
    }

    private FareEvaluationDto EvaluateItinerary(
        JsonElement itinerary,
        IgnavRoundTripRequest request,
        PartySearchSettings settings,
        IReadOnlyList<PlanningConstraint> constraints
    )
    {
        var issues = new List<FareValidationIssueDto>();
        var rejected = false;
        var unverifiable = false;
        void Reject(string code, string message, params Guid[] ids)
        {
            rejected = true;
            issues.Add(new(code, message, ids));
        }
        void Unknown(string message, params Guid[] ids)
        {
            unverifiable = true;
            issues.Add(new("missingData", message, ids));
        }

        if (itinerary.ValueKind != JsonValueKind.Object)
        {
            Unknown("The provider returned an unreadable itinerary.");
            return new("Unverifiable", issues);
        }
        if (
            !TrySegments(itinerary, "outbound", out var outbound, out var outboundLeg)
            || !TrySegments(itinerary, "inbound", out var inbound, out var inboundLeg)
        )
        {
            Unknown("A complete outbound and return flight is required.");
            return new("Unverifiable", issues);
        }

        var outboundFirst = outbound[0];
        var outboundLast = outbound[^1];
        var inboundFirst = inbound[0];
        var inboundLast = inbound[^1];
        var outboundDate = LocalDate(outboundFirst, "departure_time_local");
        var arrivalDate = LocalDate(outboundLast, "arrival_time_local");
        var returnDate = LocalDate(inboundFirst, "departure_time_local");
        if (outboundDate is null || arrivalDate is null || returnDate is null)
            Unknown("Flight dates are missing or invalid, so required stays cannot be checked.");
        var routeAirports = new[]
        {
            Text(outboundFirst, "departure_airport"),
            Text(outboundLast, "arrival_airport"),
            Text(inboundFirst, "departure_airport"),
            Text(inboundLast, "arrival_airport"),
        };
        if (routeAirports.Any(string.IsNullOrWhiteSpace))
            Unknown("An endpoint airport is missing from the itinerary.");
        else if (
            !string.Equals(routeAirports[0], request.Origin, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(
                routeAirports[1],
                request.Destination,
                StringComparison.OrdinalIgnoreCase
            )
            || !string.Equals(
                routeAirports[2],
                request.Destination,
                StringComparison.OrdinalIgnoreCase
            )
            || !string.Equals(routeAirports[3], request.Origin, StringComparison.OrdinalIgnoreCase)
        )
            Reject("route", "The flights do not make the requested round trip.");
        if (outboundDate is { } actualOutbound && actualOutbound != request.DepartureDate)
            Reject("date", "The outbound flight starts on a different day than requested.");
        if (returnDate is { } actualReturn && actualReturn != request.ReturnDate)
            Reject("date", "The return flight starts on a different day than requested.");

        foreach (var leg in new[] { outbound, inbound })
            for (var index = 0; index < leg.Length - 1; index++)
            {
                var connection = Text(leg[index], "arrival_airport");
                var next = Text(leg[index + 1], "departure_airport");
                if (connection is null || next is null)
                    Unknown("A connection airport is missing.");
                else if (!string.Equals(connection, next, StringComparison.OrdinalIgnoreCase))
                    Reject("route", "A connection does not continue from the arrival airport.");
            }

        var hasUsablePrice =
            itinerary.TryGetProperty("price", out var price)
            && price.ValueKind == JsonValueKind.Object
            && price.TryGetProperty("amount", out var amount)
            && amount.ValueKind == JsonValueKind.Number
            && amount.TryGetDecimal(out var fareAmount)
            && fareAmount > 0;
        if (!hasUsablePrice)
            Unknown("The provider did not supply a usable fare price.");

        if (
            settings.MaxStops is { } maximum
            && (outbound.Length - 1 > maximum || inbound.Length - 1 > maximum)
        )
            Reject("stops", $"This itinerary exceeds the party's {maximum}-stop limit.");
        CheckDuration(outboundLeg, outbound, "outbound");
        CheckDuration(inboundLeg, inbound, "return");

        foreach (var constraint in constraints)
        {
            if (constraint.Type == "nonstop" && (outbound.Length != 1 || inbound.Length != 1))
                Reject("nonstop", "Both flights must be nonstop.", constraint.Id);
            if (constraint.Type == "presence")
            {
                if (
                    arrivalDate is { } arrived
                    && constraint.StartDate is { } requiredStart
                    && arrived > requiredStart
                )
                    Reject(
                        "presence",
                        $"Arrival is after the required stay begins on {requiredStart:yyyy-MM-dd}.",
                        constraint.Id
                    );
                if (
                    returnDate is { } leaving
                    && constraint.EndDate is { } requiredEnd
                    && leaving < requiredEnd
                )
                    Reject(
                        "presence",
                        $"The return flight leaves before the required stay ends on {requiredEnd:yyyy-MM-dd}.",
                        constraint.Id
                    );
            }
            if (constraint.Type is "departureWindow" or "returnHomeWindow")
            {
                var date = constraint.Type == "departureWindow" ? outboundDate : returnDate;
                if (
                    date is { } actual
                    && constraint.Window is { } window
                    && (actual < window.Earliest || actual > window.Latest)
                )
                    Reject(
                        "date",
                        "The flight starts outside a traveler's allowed date window.",
                        constraint.Id
                    );
            }
            if (constraint.Type == "avoidLayover")
                CheckLayovers(constraint);
        }

        return new(
            rejected ? "Rejected"
                : unverifiable ? "Unverifiable"
                : "Eligible",
            issues
        );

        void CheckDuration(JsonElement leg, JsonElement[] segments, string direction)
        {
            int? minutes = Duration(leg, segments);
            if (minutes is null)
                Unknown($"The {direction} journey duration cannot be verified.");
            else if (minutes > settings.MaxJourneyHours * 60)
                Reject(
                    "duration",
                    $"The {direction} journey exceeds {settings.MaxJourneyHours} hours."
                );
        }

        void CheckLayovers(PlanningConstraint constraint)
        {
            foreach (var leg in new[] { outbound, inbound })
            foreach (var segment in leg.SkipLast(1))
            {
                var code = Text(segment, "arrival_airport");
                if (code is null)
                {
                    Unknown("A layover airport cannot be identified.", constraint.Id);
                    continue;
                }
                if (constraint.LocationType == "airport")
                {
                    if (
                        string.Equals(code, constraint.Location, StringComparison.OrdinalIgnoreCase)
                    )
                        Reject(
                            "layover",
                            $"The itinerary connects through excluded airport {code}.",
                            constraint.Id
                        );
                    continue;
                }
                var airport = airports.FindByCode(code);
                if (airport is null)
                {
                    Unknown(
                        $"The location of layover airport {code} is not in the catalog.",
                        constraint.Id
                    );
                    continue;
                }
                var excluded = constraint.LocationType switch
                {
                    "city" => airports.IsInCity(code, constraint.Location ?? ""),
                    "country" => string.Equals(
                        airport.Country,
                        constraint.Location,
                        StringComparison.OrdinalIgnoreCase
                    ),
                    "region" => constraint.CountryCodes.Contains(
                        airport.Country,
                        StringComparer.OrdinalIgnoreCase
                    ),
                    _ => false,
                };
                if (excluded)
                    Reject(
                        "layover",
                        $"The itinerary connects through excluded location {constraint.Location} ({code}).",
                        constraint.Id
                    );
            }
        }
    }

    private static bool TrySegments(
        JsonElement itinerary,
        string name,
        out JsonElement[] segments,
        out JsonElement leg
    )
    {
        segments = [];
        leg = default;
        if (
            !itinerary.TryGetProperty(name, out leg)
            || leg.ValueKind != JsonValueKind.Object
            || !leg.TryGetProperty("segments", out var array)
            || array.ValueKind != JsonValueKind.Array
        )
            return false;
        segments = array.EnumerateArray().ToArray();
        return segments.Length > 0 && segments.All(s => s.ValueKind == JsonValueKind.Object);
    }

    private static string? Text(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object
        && element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static DateOnly? LocalDate(JsonElement segment, string property)
    {
        var value = Text(segment, property);
        return
            value is not null
            && DateTime.TryParseExact(
                value,
                ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF"],
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var local
            )
            ? DateOnly.FromDateTime(local)
            : null;
    }

    private static int? Duration(JsonElement leg, JsonElement[] segments)
    {
        if (
            leg.TryGetProperty("duration_minutes", out var value)
            && value.ValueKind == JsonValueKind.Number
            && value.TryGetInt32(out int minutes)
            && minutes > 0
        )
            return minutes;
        if (
            DateTimeOffset.TryParse(
                Text(segments[0], "departure_time_utc"),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal,
                out var departure
            )
            && DateTimeOffset.TryParse(
                Text(segments[^1], "arrival_time_utc"),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal,
                out var arrival
            )
            && arrival > departure
        )
            return (int)(arrival - departure).TotalMinutes;
        return null;
    }
}
