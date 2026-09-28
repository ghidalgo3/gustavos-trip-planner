using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;

namespace TripPlanner.Api.Services;

public interface ISearchPlanBuilder
{
    IReadOnlyList<PlanningIssue> Validate(
        PlanningDocument document,
        IReadOnlyList<Party> parties,
        bool complete
    );
    SearchPlanPreview Build(
        PlanningDocument document,
        IReadOnlyList<Party> parties,
        CancellationToken cancellationToken = default
    );
}

public sealed class SearchPlanBuilder(
    IOptions<PlanningOptions> options,
    TimeProvider clock,
    AirportCatalog? airports = null
) : ISearchPlanBuilder
{
    private readonly MultiCityPlanner _routes = new(
        airports ?? new AirportCatalog(),
        clock,
        Math.Clamp(options.Value.FareRequestLimit, 1, 200)
    );
    private readonly int _limit = Math.Clamp(options.Value.DatePairLimit, 1, 200);
    private static readonly string[] Types =
    [
        "departureWindow",
        "returnHomeWindow",
        "presence",
        "travelTogether",
        "nonstop",
        "avoidLayover",
    ];

    public IReadOnlyList<PlanningIssue> Validate(
        PlanningDocument document,
        IReadOnlyList<Party> parties,
        bool complete
    )
    {
        if (document.Visits is null)
            return [new("invalidInput", "Visits must be an array.", null, [])];
        if (document.Visits is { Length: > 0 })
            return _routes.Validate(document, parties, complete);
        var issues = new List<PlanningIssue>();
        void Issue(string message, Guid? party = null, params Guid[] ids) =>
            issues.Add(new("invalidInput", message, party, ids));

        if (document.SchemaVersion != 1)
            Issue("Unsupported constraint document format.");
        if (document.Parties is null || document.Constraints is null)
        {
            Issue("Parties and constraints must be arrays.");
            return issues;
        }
        if (document.Constraints.Length > 100 || document.Parties.Length > 20)
        {
            Issue("The prototype supports at most 100 constraints and 20 parties.");
            return issues;
        }
        if (
            document.UserTimeZone is not null
            && !TimeZoneInfo.TryFindSystemTimeZoneById(document.UserTimeZone, out _)
        )
            Issue("The browser time zone is not recognized. Reload the page and try again.");
        var dates = document.TravelDates;
        if (
            dates?.StartDate is { } start && !SupportedDate(start)
            || dates?.EndDate is { } end && !SupportedDate(end)
        )
            Issue("Travel dates must be within 2000–2100.");
        if (dates?.StartDate > dates?.EndDate)
            Issue("Return-flight date must be on or after departure.");
        if (complete && dates is not null && (dates.StartDate is null || dates.EndDate is null))
            Issue("Choose both departure and return-flight dates.");
        ValidateLocation(document.Destination, "Destination", complete, null, issues);
        if (complete && parties.Count == 0)
            Issue("The trip needs a travel party.");
        if (parties.SelectMany(p => p.UserIds).GroupBy(id => id).Any(g => g.Count() > 1))
            Issue("Each traveler must belong to exactly one party.");

        var seenParties = new HashSet<Guid>();
        foreach (var settings in document.Parties)
        {
            if (settings is null)
            {
                Issue("A party's settings cannot be null.");
                continue;
            }
            if (!seenParties.Add(settings.PartyId) || !parties.Any(p => p.Id == settings.PartyId))
                Issue(
                    "Party settings must reference a distinct party belonging to this trip.",
                    settings.PartyId
                );
            ValidateLocation(settings.Origin, "Origin", complete, settings.PartyId, issues);
            if (
                settings.Origin is not null
                && document.Destination is not null
                && settings.Origin.AirportCodes.All(code =>
                    document.Destination.AirportCodes.Contains(code)
                )
                && document.Destination.AirportCodes.All(code =>
                    settings.Origin.AirportCodes.Contains(code)
                )
            )
                Issue("Origin and destination must differ.", settings.PartyId);
            if (settings.MaxJourneyHours is < 1 or > 168)
                Issue(
                    "Maximum journey duration must be 1–168 hours per direction.",
                    settings.PartyId
                );
            if (settings.MaxStops is < 0 or > 2)
                Issue("Maximum stops must be 0, 1, or 2.", settings.PartyId);
            if (settings.Cabin is not ("economy" or "premium_economy" or "business" or "first"))
                Issue("Choose a supported cabin.", settings.PartyId);
            if (!Code(settings.Market, "^[A-Z]{2}$"))
                Issue("Pricing market must be a two-letter country code.", settings.PartyId);
            if (
                settings.PreferredAirlines is null
                || settings.PreferredAirlines.Length > 30
                || settings.PreferredAirlines.Any(code => !Code(code, "^[A-Z0-9]{2}$"))
            )
                Issue("Preferred airlines must be two-character airline codes.", settings.PartyId);
        }

        var members = parties.SelectMany(p => p.UserIds).ToHashSet();
        var seenConstraints = new HashSet<Guid>();
        foreach (var constraint in document.Constraints)
        {
            if (constraint is null)
            {
                Issue("A constraint cannot be null.");
                continue;
            }
            Guid? partyId = parties.FirstOrDefault(p => p.UserIds.Contains(constraint.UserId))?.Id;
            void Invalid(string message) => Issue(message, partyId, constraint.Id);
            if (constraint.Id == Guid.Empty || !seenConstraints.Add(constraint.Id))
                Invalid("Each constraint needs a distinct ID.");
            if (!members.Contains(constraint.UserId))
                Invalid("The constraint's traveler must belong to this trip.");
            if (!Types.Contains(constraint.Type))
                Invalid("Unsupported constraint type.");
            if (constraint.OriginalInput?.Length > 4000)
                Invalid("Original input cannot exceed 4000 characters.");
            if (constraint.Type is "departureWindow" or "returnHomeWindow")
            {
                var window = constraint.Window;
                if (window?.Earliest is null || window.Latest is null)
                {
                    if (complete)
                        Invalid("Supply both dates for the travel window.");
                }
                else if (
                    !SupportedDate(window.Earliest.Value)
                    || !SupportedDate(window.Latest.Value)
                    || window.Latest < window.Earliest
                    || window.Latest.Value.DayNumber - window.Earliest.Value.DayNumber > 365
                )
                    Invalid(
                        "Travel windows must be ordered, no longer than 366 days, and within 2000–2100."
                    );
                if (
                    window?.Preferred is { } preferred
                    && (
                        !SupportedDate(preferred)
                        || preferred < window.Earliest
                        || preferred > window.Latest
                    )
                )
                    Invalid("Preferred date must be inside its travel window.");
            }
            if (constraint.Type == "presence")
            {
                if (constraint.StartDate is null || constraint.EndDate is null)
                {
                    if (complete)
                        Invalid("Supply the start and end of the required destination stay.");
                }
                else if (
                    !SupportedDate(constraint.StartDate.Value)
                    || !SupportedDate(constraint.EndDate.Value)
                    || constraint.StartDate > constraint.EndDate
                )
                    Invalid("Required presence dates must be ordered and within 2000–2100.");
            }
            if (constraint.Type == "travelTogether")
            {
                if (constraint.OtherUserId is null)
                {
                    if (complete)
                        Invalid("Choose a traveler to travel with.");
                }
                else if (
                    !members.Contains(constraint.OtherUserId.Value)
                    || constraint.OtherUserId == constraint.UserId
                )
                    Invalid("Choose a different traveler belonging to this trip.");
                else if (
                    complete
                    && !parties.Any(p =>
                        p.UserIds.Contains(constraint.UserId)
                        && p.UserIds.Contains(constraint.OtherUserId.Value)
                    )
                )
                    issues.Add(
                        new(
                            "membershipConflict",
                            "Travel-together requirements conflict with assigned parties. The trip owner must resolve membership.",
                            partyId,
                            [constraint.Id]
                        )
                    );
            }
            if (constraint.Type == "avoidLayover")
            {
                if (constraint.LocationType is not ("airport" or "city" or "country" or "region"))
                    Invalid("Choose airport, city, country, or region for a layover exclusion.");
                if (string.IsNullOrWhiteSpace(constraint.Location))
                {
                    if (complete)
                        Invalid("Name the location to avoid.");
                }
                else if (
                    constraint.Location.Length > 200
                    || (
                        constraint.LocationType == "airport"
                        && !Code(constraint.Location, "^[A-Z]{3}$")
                    )
                    || (
                        constraint.LocationType == "country"
                        && !Code(constraint.Location, "^[A-Z]{2}$")
                    )
                )
                    Invalid(
                        "Use an airport code, country code, or a city/region name of at most 200 characters."
                    );
                if (
                    constraint.CountryCodes is null
                    || constraint.CountryCodes.Length > 250
                    || constraint.CountryCodes.Any(code => !Code(code, "^[A-Z]{2}$"))
                )
                    Invalid("Region countries must be two-letter country codes.");
                else if (
                    complete
                    && constraint.LocationType == "region"
                    && constraint.CountryCodes.Length == 0
                )
                    Invalid(
                        "Define the countries included in this region; its meaning must not be guessed."
                    );
            }
        }
        if (complete)
        {
            foreach (var party in parties)
            {
                if (!seenParties.Contains(party.Id))
                    Issue("Configure an origin and search settings for this party.", party.Id);
                if (party.UserIds.Count is < 1 or > 9)
                    Issue("This prototype supports 1–9 adult account holders per party.", party.Id);
                foreach (string type in new[] { "departureWindow", "returnHomeWindow" })
                    if (
                        (type == "departureWindow" ? dates?.StartDate : dates?.EndDate) is null
                        && !document.Constraints.Any(c =>
                            c is not null && party.UserIds.Contains(c.UserId) && c.Type == type
                        )
                    )
                        Issue(
                            type == "departureWindow"
                                ? "Choose your departure date."
                                : "Choose your return-flight date.",
                            party.Id
                        );
            }
        }
        return issues;
    }

    public SearchPlanPreview Build(
        PlanningDocument document,
        IReadOnlyList<Party> parties,
        CancellationToken cancellationToken = default
    )
    {
        if (document.Visits is { Length: > 0 })
            return _routes.Build(document, parties, cancellationToken);
        var issues = Validate(document, parties, true).ToList();
        if (issues.Count > 0)
            return new(false, _limit, issues, []);
        var previews = new List<PartySearchPreview>();
        var destination = document.Destination!;
        var destinationZone = TimeZoneInfo.FindSystemTimeZoneById(destination.TimeZone);
        foreach (var party in parties.OrderBy(p => p.Id))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var settings = document.Parties.Single(p => p.PartyId == party.Id);
            var origin = settings.Origin!;
            var originZone = TimeZoneInfo.FindSystemTimeZoneById(origin.TimeZone);
            var constraints = document
                .Constraints.Where(c => party.UserIds.Contains(c.UserId))
                .ToArray();
            var departures = constraints.Where(c => c.Type == "departureWindow").ToArray();
            var returnFlights = constraints.Where(c => c.Type == "returnHomeWindow").ToArray();
            var presence = constraints.Where(c => c.Type == "presence").ToArray();
            var depStart =
                departures.Length == 0
                    ? document.TravelDates!.StartDate!.Value
                    : departures.Max(c => c.Window!.Earliest!.Value);
            var depEnd =
                departures.Length == 0
                    ? document.TravelDates!.StartDate!.Value
                    : departures.Min(c => c.Window!.Latest!.Value);
            var returnStart =
                returnFlights.Length == 0
                    ? document.TravelDates!.EndDate!.Value
                    : returnFlights.Max(c => c.Window!.Earliest!.Value);
            var returnEnd =
                returnFlights.Length == 0
                    ? document.TravelDates!.EndDate!.Value
                    : returnFlights.Min(c => c.Window!.Latest!.Value);
            if (depStart > depEnd || returnStart > returnEnd)
            {
                var conflicting = depStart > depEnd ? departures : returnFlights;
                string kind = depStart > depEnd ? "Departure" : "Return-flight";
                issues.Add(
                    new(
                        "conflict",
                        $"{kind} windows do not overlap: {string.Join("; ", conflicting.Select(c => DateRange(c.Window!.Earliest!.Value, c.Window.Latest!.Value)))}. Change or remove a window so they share at least one date.",
                        party.Id,
                        conflicting.Select(c => c.Id).ToArray()
                    )
                );
                continue;
            }
            var today = DateOnly.FromDateTime(
                TimeZoneInfo.ConvertTime(clock.GetUtcNow(), originZone).DateTime
            );
            var allowedDepartureStart = depStart;
            depStart = depStart < today ? today : depStart;
            DateTime? arriveByExclusive =
                presence.Length == 0
                    ? null
                    : DayStart(presence.Min(c => c.StartDate!.Value).AddDays(1), destinationZone);
            DateTime? leaveAfter =
                presence.Length == 0
                    ? null
                    : DayStart(presence.Max(c => c.EndDate!.Value), destinationZone);
            var candidates = new List<PreparedSearch>();
            // Enumerate direct provider date pairs to avoid duplicate paid requests.
            for (var departure = depStart; departure <= depEnd; departure = departure.AddDays(1))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var earliestOutbound = DayStart(departure, originZone);
                if (arriveByExclusive is not null && earliestOutbound >= arriveByExclusive.Value)
                    continue;
                for (
                    var returning = returnStart;
                    returning <= returnEnd;
                    returning = returning.AddDays(1)
                )
                {
                    if (returning < departure)
                        continue; // Ignav's round-trip date contract.
                    var returnDeparture = DayStart(returning, destinationZone);
                    if (returnDeparture < earliestOutbound)
                        continue;
                    if (leaveAfter is not null && returnDeparture < leaveAfter.Value)
                        continue;
                    double distance =
                        departures.Sum(c =>
                            Math.Abs(
                                departure.DayNumber
                                    - Anchor(c.Window!, document.TravelDates?.StartDate)
                            )
                        )
                        + returnFlights.Sum(c =>
                            Math.Abs(
                                returning.DayNumber
                                    - Anchor(c.Window!, document.TravelDates?.EndDate)
                            )
                        );
                    foreach (var originCode in origin.AirportCodes)
                    foreach (var destinationCode in destination.AirportCodes)
                    {
                        if (originCode == destinationCode)
                            continue;
                        var body = new IgnavFareRequest(
                            originCode,
                            destinationCode,
                            departure,
                            returning,
                            party.UserIds.Count,
                            settings.Cabin,
                            settings.Market,
                            constraints.Any(c => c.Type == "nonstop") ? 0 : settings.MaxStops
                        );
                        candidates.Add(new(body, "", distance));
                    }
                }
            }
            if (candidates.Count == 0)
            {
                string explanation;
                Guid[] affected;
                if (depEnd < today)
                {
                    explanation =
                        $"Departure is allowed {DateRange(allowedDepartureStart, depEnd)}, but those dates have passed in {origin.TimeZone}. Choose a future departure window.";
                    affected = departures.Select(c => c.Id).ToArray();
                }
                else if (presence.Length > 0 && returnEnd < presence.Max(c => c.EndDate!.Value))
                {
                    var requiredEnd = presence.Max(c => c.EndDate!.Value);
                    string source =
                        returnFlights.Length == 0
                            ? "Selected return-flight date"
                            : "Return-flight window";
                    explanation =
                        $"{source} allows {DateRange(returnStart, returnEnd)}, but the required destination stay ends {DateLabel(requiredEnd)}. The return flight must begin on or after that day. Move or remove the return-flight requirement, or shorten the required stay.";
                    affected =
                    [
                        .. returnFlights.Select(c => c.Id),
                        .. presence.Where(c => c.EndDate == requiredEnd).Select(c => c.Id),
                    ];
                }
                else if (
                    arriveByExclusive is not null
                    && DayStart(depStart, originZone) >= arriveByExclusive.Value
                )
                {
                    var requiredStart = presence.Min(c => c.StartDate!.Value);
                    explanation =
                        $"Departure is allowed {DateRange(depStart, depEnd)}, but the required destination stay starts {DateLabel(requiredStart)}. Move the departure window earlier or move the required stay later.";
                    affected =
                    [
                        .. departures.Select(c => c.Id),
                        .. presence.Where(c => c.StartDate == requiredStart).Select(c => c.Id),
                    ];
                }
                else if (returnEnd < depStart)
                {
                    explanation =
                        $"The return-flight window ends {DateLabel(returnEnd)}, before the first allowed departure on {DateLabel(depStart)}. Move one of the windows.";
                    affected =
                    [
                        .. departures.Select(c => c.Id),
                        .. returnFlights.Select(c => c.Id),
                    ];
                }
                else
                {
                    explanation =
                        $"No flight-date pair satisfies departure {DateRange(depStart, depEnd)} and return {DateRange(returnStart, returnEnd)}"
                        + (
                            presence.Length == 0
                                ? "."
                                : $" while arriving by {DateLabel(presence.Min(c => c.StartDate!.Value))} and leaving on or after {DateLabel(presence.Max(c => c.EndDate!.Value))}."
                        )
                        + " Adjust the date windows or required stay.";
                    affected = constraints
                        .Where(c => c.Type is "departureWindow" or "returnHomeWindow" or "presence")
                        .Select(c => c.Id)
                        .ToArray();
                }
                issues.Add(new("conflict", explanation, party.Id, affected.Distinct().ToArray()));
            }
            var checks = new List<string>
            {
                "Verify actual outbound arrival and return departure occur in the correct order.",
                $"Verify the return flight departs between {returnStart:yyyy-MM-dd} and {returnEnd:yyyy-MM-dd} in the destination's local date.",
                $"Verify each direction takes at most {settings.MaxJourneyHours} hours, including connections.",
                "Verify every party member can take the same flights and use the same airports.",
            };
            foreach (var c in constraints)
            {
                if (c.Type == "presence")
                    checks.Add(
                        $"[{c.Id}] Arrive at the destination on or before {c.StartDate:yyyy-MM-dd}; depart on or after {c.EndDate:yyyy-MM-dd}."
                    );
                if (c.Type == "nonstop")
                    checks.Add($"[{c.Id}] Both directions must be nonstop.");
                if (c.Type == "avoidLayover")
                    checks.Add(
                        $"[{c.Id}] Exclude connecting airports in {c.LocationType}: {c.Location}"
                            + (
                                c.LocationType == "region"
                                    ? $" ({string.Join(", ", c.CountryCodes.Order())})"
                                    : ""
                            )
                            + ". Resolve airport geography before accepting a fare."
                    );
            }
            previews.Add(
                new(
                    party.Id,
                    candidates
                        .Select(c => (c.Body.DepartureDate, c.Body.ReturnDate))
                        .Distinct()
                        .Count(),
                    candidates
                        .OrderBy(c => c.DateDistance)
                        .ThenBy(c => c.Body.DepartureDate)
                        .ThenBy(c => c.Body.ReturnDate)
                        .GroupBy(c => (c.Body.DepartureDate, c.Body.ReturnDate))
                        .Take(_limit)
                        .SelectMany(group =>
                            group.OrderBy(c => c.Body.Origin).ThenBy(c => c.Body.Destination)
                        )
                        .Take(Math.Clamp(options.Value.FareRequestLimit, 1, 200))
                        .Select(c => c with { CacheKey = CacheKey(c.Body) })
                        .ToArray(),
                    checks,
                    settings.PreferredAirlines.Distinct().Order().ToArray()
                )
            );
        }
        return new(issues.Count == 0, _limit, issues, previews);
    }

    public static string CacheKey(IgnavFareRequest request) =>
        Convert.ToHexStringLower(
            SHA256.HashData(
                Encoding.UTF8.GetBytes(
                    "POST https://ignav.com/api/fares/"
                        + IgnavClient.Endpoint(request)
                        + "\n"
                        + JsonSerializer.Serialize(
                            IgnavClient.Body(request),
                            JsonSerializerOptions.Web
                        )
                )
            )
        );

    private static bool SupportedDate(DateOnly date) => date.Year is >= 2000 and <= 2100;

    private static string DateLabel(DateOnly date) =>
        date.ToString("MMM d, yyyy", CultureInfo.InvariantCulture);

    private static string DateRange(DateOnly first, DateOnly last) =>
        first == last ? DateLabel(first) : $"{DateLabel(first)}–{DateLabel(last)}";

    private static bool Code(string? code, string pattern) =>
        code is not null && Regex.IsMatch(code, pattern, RegexOptions.CultureInvariant);

    private static void ValidateLocation(
        SearchLocation? location,
        string label,
        bool complete,
        Guid? party,
        List<PlanningIssue> issues
    )
    {
        if (location is null || string.IsNullOrWhiteSpace(location.Code))
        {
            if (complete)
                issues.Add(
                    new(
                        "missingInput",
                        $"Choose {label.ToLowerInvariant()} from the airport suggestions.",
                        party,
                        []
                    )
                );
            return;
        }
        if (!Code(location.Code, "^[A-Z]{3}$"))
            issues.Add(
                new("invalidInput", $"{label} must use a three-letter IATA code.", party, [])
            );
        if (
            location.Codes is { Length: > 0 } codes
            && (
                codes.Length > 20
                || codes.Any(code => !Code(code, "^[A-Z]{3}$"))
                || codes.Distinct().Count() != codes.Length
                || !codes.Contains(location.Code)
            )
        )
            issues.Add(
                new(
                    "invalidInput",
                    $"{label} must contain distinct IATA airport codes, including its primary airport.",
                    party,
                    []
                )
            );
        if (string.IsNullOrWhiteSpace(location.TimeZone))
            issues.Add(
                new(
                    "invalidInput",
                    $"{label} is missing airport time-zone data. Choose it from the suggestions again.",
                    party,
                    []
                )
            );
        else if (
            !TimeZoneInfo.TryFindSystemTimeZoneById(location.TimeZone, out var zone)
            || !zone.HasIanaId
        )
            issues.Add(
                new(
                    "invalidInput",
                    $"{label} has invalid airport time-zone data. Choose it from the suggestions again.",
                    party,
                    []
                )
            );
    }

    // A local day can start during a clock gap or overlap. Use its first valid instant.
    private static DateTime DayStart(DateOnly date, TimeZoneInfo zone)
    {
        var local = date.ToDateTime(TimeOnly.MinValue);
        while (zone.IsInvalidTime(local))
            local = local.AddMinutes(1);
        if (zone.IsAmbiguousTime(local))
            return DateTime.SpecifyKind(
                local - zone.GetAmbiguousTimeOffsets(local).Max(),
                DateTimeKind.Utc
            );
        return TimeZoneInfo.ConvertTimeToUtc(local, zone);
    }

    private static double Anchor(DateWindow window, DateOnly? selected = null) =>
        (window.Preferred ?? selected)?.DayNumber
        ?? (window.Earliest!.Value.DayNumber + window.Latest!.Value.DayNumber) / 2.0;
}
