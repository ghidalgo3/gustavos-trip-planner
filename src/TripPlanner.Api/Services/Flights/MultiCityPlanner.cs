using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services.Flights;

// Pure bounded search: visits are constraints; dated provider requests are shared edges.
public sealed class MultiCityPlanner(
    AirportCatalog airports,
    TimeProvider clock,
    int queryLimit = 160
)
{
    public IReadOnlyList<PlanningIssue> Validate(
        PlanningDocument document,
        IReadOnlyList<Party> parties,
        bool complete
    )
    {
        var issues = new List<PlanningIssue>();
        void Issue(string text, params Guid[] ids) =>
            issues.Add(new("invalidInput", text, null, ids));
        if (document.SchemaVersion != 1)
        {
            Issue("Unsupported constraint document format.");
        }

        if (document.Visits.Any(v => v is null))
        {
            Issue("Destinations must be objects.");
            return issues;
        }
        if (document.Visits.Length is < 1 or > 3)
        {
            Issue("Plan between one and three destinations.");
        }

        if (
            document.SearchLimits is null
            || document.SearchLimits.FlexibilityDays is < 0 or > 5
            || document.SearchLimits.MaxTripDays is < 1 or > 60
        )
        {
            Issue("Search limits must allow 0–5 flexible days and 1–60 total trip days.");
        }

        if (
            document.Visits.Select(v => v.Id).Distinct().Count() != document.Visits.Length
            || document.Visits.Any(v => v.Id == Guid.Empty)
        )
        {
            Issue("Each destination needs a distinct ID.");
        }

        foreach (var visit in document.Visits)
        {
            if (
                visit.ArrivalFlexibilityDays is < 0 or > 5
                || visit.DepartureFlexibilityDays is < 0 or > 5
            )
            {
                Issue("Destination date flexibility must be between 0 and 5 days.", visit.Id);
            }

            if (complete && visit.Location is null)
            {
                Issue("Choose a city or airport for every destination.", visit.Id);
            }

            if (
                complete
                && visit.ArrivalFlexibilityDays is >= 0 and <= 5
                && visit.PresentFrom is { } arrival
                && visit.Location is { } target
                && airports.FindByCode(target.AirportCodes.FirstOrDefault() ?? "") is { } airport
            )
            {
                var today = DateOnly.FromDateTime(
                    TimeZoneInfo
                        .ConvertTime(
                            clock.GetUtcNow(),
                            TimeZoneInfo.FindSystemTimeZoneById(airport.TimeZone)
                        )
                        .DateTime
                );
                var latestArrival = arrival.AddDays(visit.ArrivalFlexibilityDays.Value);
                if (latestArrival < today)
                {
                    Issue(
                        $"The latest allowed arrival in {target.Label ?? airport.City} is {latestArrival:yyyy-MM-dd}, which is in the past. Update this destination's dates on Overview.",
                        visit.Id
                    );
                }
            }
            if (
                visit.Location is { } location
                && (
                    location.AirportCodes.Count > 10
                    || location.AirportCodes.Any(c =>
                        string.IsNullOrWhiteSpace(c) || airports.FindByCode(c) is null
                    )
                )
            )
            {
                Issue("Choose recognized airports for each destination.", visit.Id);
            }

            if (
                visit.PresentFrom?.Year is < 2000 or > 2100
                || visit.PresentThrough?.Year is < 2000 or > 2100
            )
            {
                Issue("Required stay dates must be between 2000 and 2100.", visit.Id);
            }

            if (visit.Nights is < 1 or > 60)
            {
                Issue("A stay must be between 1 and 60 nights.", visit.Id);
            }

            if (
                (visit.PresentFrom is null) != (visit.PresentThrough is null)
                || visit.PresentFrom > visit.PresentThrough
            )
            {
                Issue("A required stay needs a start and end date in order.", visit.Id);
            }

            if (complete && visit.Nights is null && visit.PresentFrom is null)
            {
                Issue("Specify nights or a required stay for each destination.", visit.Id);
            }

            if (
                visit.PresentFrom is { } from
                && visit.PresentThrough is { } through
                && visit.Nights is { } nights
                && through.DayNumber - from.DayNumber > nights
            )
            {
                Issue("The number of nights is shorter than the required stay.", visit.Id);
            }

            if (
                visit.AfterVisitIds is null
                || visit.AfterVisitIds.Any(id =>
                    id == visit.Id || !document.Visits.Any(v => v.Id == id)
                )
            )
            {
                Issue(
                    "Destination ordering must reference other destinations in this trip.",
                    visit.Id
                );
            }
        }
        if (issues.Count == 0 && !Orders(document.Visits).Any())
        {
            Issue("The destination order contains a cycle.");
        }

        if (
            complete
            && document.TravelDates?.StartDate is null
            && document.Constraints?.Any(c => c?.Type == "departureWindow") != true
            && !document.Visits.Any(v => v.PresentFrom is not null)
        )
        {
            Issue("Add a departure date or a required destination stay to anchor this trip.");
        }

        if (
            document.TravelDates?.StartDate?.Year is < 2000 or > 2100
            || document.TravelDates?.EndDate?.Year is < 2000 or > 2100
        )
        {
            Issue("Flight dates must be between 2000 and 2100.");
        }

        if (complete && parties.Count == 0)
        {
            Issue("Add a travel party before searching.");
        }

        if (document.TravelDates?.StartDate > document.TravelDates?.EndDate)
        {
            Issue("The return flight cannot begin before departure.");
        }

        if (document.Parties is null || document.Constraints is null)
        {
            Issue("Parties and requirements are required.");
            return issues;
        }
        if (document.Parties.Any(p => p is null) || document.Constraints.Any(c => c is null))
        {
            Issue("Party preferences and requirements must be objects.");
            return issues;
        }
        if (document.Parties.Length > 20 || document.Constraints.Length > 100)
        {
            Issue("The planner supports at most 20 parties and 100 requirements.");
        }

        if (document.Parties.Any(p => !parties.Any(party => party.Id == p.PartyId)))
        {
            Issue("Search preferences must belong to a party in this trip.");
        }

        foreach (var party in parties)
        {
            if (
                complete
                && document.TravelDates?.StartDate is null
                && !document.Visits.Any(v => v.PresentFrom is not null)
                && !document.Constraints.Any(c =>
                    c.Type == "departureWindow" && party.UserIds.Contains(c.UserId)
                )
            )
            {
                Issue(
                    "Each party needs a departure window or a required stay to anchor its route."
                );
            }

            var settings = document.Parties.Where(p => p.PartyId == party.Id).ToArray();
            if (settings.Length != 1)
            {
                Issue("Each party needs one set of search preferences.");
                continue;
            }
            var s = settings[0];
            if (complete && s.Origin is null)
            {
                Issue("Choose a departure city or airport.");
            }

            if (
                s.PreferredAirlines is null
                || s.PreferredAirlines.Length > 30
                || s.PreferredAirlines.Any(code =>
                    code is null || code.Length != 2 || !code.All(char.IsAsciiLetterOrDigit)
                )
            )
            {
                Issue("Preferred airlines must be two-character airline codes.");
            }

            if (
                s.Origin is { } origin
                && origin.AirportCodes.Any(c =>
                    string.IsNullOrWhiteSpace(c) || airports.FindByCode(c) is null
                )
            )
            {
                Issue("Choose a recognized departure airport.");
            }

            if (
                s.MaxJourneyHours is < 1 or > 168
                || s.MaxStops is < 0 or > 2
                || party.UserIds.Count is < 1 or > 9
            )
            {
                Issue("Check the party size, stop limit, and maximum journey hours.");
            }

            if (
                s.Cabin is not ("economy" or "premium_economy" or "business" or "first")
                || s.Market is null
                || s.Market.Length != 2
            )
            {
                Issue("Choose a supported cabin and pricing market.");
            }
        }
        foreach (var c in document.Constraints)
        {
            if (!parties.Any(p => p.UserIds.Contains(c.UserId)))
            {
                Issue("A requirement refers to a traveler outside the trip.", c.Id);
            }

            if (c.Type == "presence")
            {
                Issue("Put required stays on their destination for a multi-city trip.", c.Id);
            }

            if (
                c.Type is "departureWindow" or "returnHomeWindow"
                && (
                    c.Window?.Earliest is null
                    || c.Window.Latest is null
                    || c.Window.Earliest > c.Window.Latest
                    || c.Window.Earliest.Value.Year is < 2000 or > 2100
                    || c.Window.Latest.Value.Year is < 2000 or > 2100
                    || c.Window.Latest.Value.DayNumber - c.Window.Earliest.Value.DayNumber > 365
                )
            )
            {
                Issue("Provide both dates for the flight window.", c.Id);
            }

            if (
                c.Type == "avoidLayover"
                && (
                    c.LocationType is not ("airport" or "city" or "country" or "region")
                    || string.IsNullOrWhiteSpace(c.Location)
                    || c.CountryCodes is null
                    || (c.LocationType == "region" && c.CountryCodes.Length == 0)
                )
            )
            {
                Issue(
                    "Specify a layover location; named regions need an explicit list of countries.",
                    c.Id
                );
            }

            if (
                c.Type == "travelTogether"
                && !parties.Any(p =>
                    p.UserIds.Contains(c.UserId)
                    && c.OtherUserId is { } other
                    && p.UserIds.Contains(other)
                )
            )
            {
                Issue("Travel companions must belong to the same party.", c.Id);
            }

            if (
                c.Type
                is not (
                    "departureWindow"
                    or "returnHomeWindow"
                    or "nonstop"
                    or "avoidLayover"
                    or "travelTogether"
                    or "presence"
                )
            )
            {
                Issue("Unsupported requirement.", c.Id);
            }
        }
        return issues;
    }

    public SearchPlanPreview Build(
        PlanningDocument document,
        IReadOnlyList<Party> parties,
        CancellationToken cancellationToken
    )
    {
        var issues = Validate(document, parties, true).ToList();
        if (issues.Count > 0)
        {
            return new(false, queryLimit, issues, []);
        }

        var previews = new List<PartySearchPreview>();
        foreach (var party in parties.OrderBy(p => p.Id))
        {
            var settings = document.Parties.Single(p => p.PartyId == party.Id);
            var orders = Orders(document.Visits).ToArray();
            var schedules = orders
                .Select(order =>
                    Schedules(
                            document with
                            {
                                Constraints = document
                                    .Constraints.Where(c => party.UserIds.Contains(c.UserId))
                                    .ToArray(),
                            },
                            order,
                            settings,
                            cancellationToken
                        )
                        .DistinctBy(d => string.Join(",", d))
                        .Take(3000)
                        .GetEnumerator()
                )
                .ToArray();
            // Reserve coverage for every leg before spending requests on paired fares.
            // A schedule can expand to many airport combinations, so admitting it as
            // one all-or-nothing batch starves later legs and nearby dates.
            var legCount = document.Visits.Length + 1;
            if (queryLimit < legCount)
            {
                issues.Add(
                    new(
                        "invalidInput",
                        $"The fare request limit must allow at least {legCount} searches for this route.",
                        party.Id,
                        []
                    )
                );
                continue;
            }
            var oneWayBudget = Math.Max(legCount, queryLimit * 7 / 8);
            var perLegBudget = Math.Max(1, oneWayBudget / legCount);
            var legRequests = Enumerable
                .Range(0, legCount)
                .Select(_ => new Dictionary<string, PreparedSearch>())
                .ToArray();
            var pairedRequests = new Dictionary<string, PreparedSearch>();
            var considered = 0;
            // Round-robin orders so a cheaper-looking prefix cannot consume the budget for all orders.
            bool moved;
            do
            {
                moved = false;
                for (int o = 0; o < schedules.Length; o++)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (!schedules[o].MoveNext())
                    {
                        continue;
                    }

                    moved = true;
                    considered++;
                    var dates = schedules[o].Current;
                    var locations = new[] { settings.Origin! }
                        .Concat(orders[o].Select(v => v.Location!))
                        .Append(settings.Origin!)
                        .ToArray();
                    var options = Enumerable
                        .Range(0, dates.Length)
                        .Select(i =>
                            (
                                from origin in SearchCodes(locations[i])
                                from destination in SearchCodes(locations[i + 1])
                                where origin != destination
                                select new IgnavFareRequest(
                                    origin,
                                    destination,
                                    dates[i],
                                    dates[i],
                                    party.UserIds.Count,
                                    settings.Cabin,
                                    settings.Market,
                                    document.Constraints.Any(c =>
                                        party.UserIds.Contains(c.UserId) && c.Type == "nonstop"
                                    )
                                        ? 0
                                        : settings.MaxStops,
                                    "oneWay",
                                    SearchPriority: i == 0 ? 0 : 1
                                )
                            ).ToArray()
                        )
                        .ToArray();
                    if (options.Any(p => p.Length == 0))
                    {
                        continue;
                    }

                    for (int leg = 0; leg < options.Length; leg++)
                    {
                        foreach (var request in options[leg])
                        {
                            var key = SearchPlanBuilder.CacheKey(request);
                            if (legRequests[leg].Count < perLegBudget)
                            {
                                legRequests[leg].TryAdd(key, new(request, key, considered));
                            }
                        }
                    }

                    foreach (var first in options[0])
                    {
                        foreach (var last in options[^1])
                        {
                            var pair = first with
                            {
                                SearchKind = "flexible",
                                ReturnDate = last.DepartureDate,
                                SearchPriority = 2,
                                Legs =
                                [
                                    new(
                                        first.Origin,
                                        first.Destination,
                                        first.DepartureDate,
                                        first.MaxStops
                                    ),
                                    new(
                                        last.Origin,
                                        last.Destination,
                                        last.DepartureDate,
                                        last.MaxStops
                                    ),
                                ],
                            };
                            if (pairedRequests.Count < queryLimit - perLegBudget * legCount)
                            {
                                var key = SearchPlanBuilder.CacheKey(pair);
                                pairedRequests.TryAdd(key, new(pair, key, considered));
                            }
                        }
                    }
                }
            } while (
                moved
                && considered < 6000
                && (
                    legRequests.Any(requests => requests.Count < perLegBudget)
                    || pairedRequests.Count < queryLimit - perLegBudget * legCount
                )
            );
            var requests = legRequests
                .SelectMany(group => group.Values)
                .Concat(pairedRequests.Values)
                .DistinctBy(request => request.CacheKey)
                .ToArray();
            foreach (var schedule in schedules)
            {
                schedule.Dispose();
            }

            if (requests.Length == 0)
            {
                issues.Add(
                    new(
                        "conflict",
                        "No complete route fits the required stays, nights, dates, and search limits. Review the destination cards or increase the maximum trip length.",
                        party.Id,
                        document.Visits.Select(v => v.Id).ToArray()
                    )
                );
            }

            previews.Add(
                new(
                    party.Id,
                    considered,
                    requests,
                    [
                        $"Searching a bounded sample with at most {queryLimit} fare requests; cached responses are reused.",
                        "Separate tickets between stays are allowed. Connections requiring self-transfer are excluded.",
                        "Results are the best combinations found, not an exhaustive search of every date and flight.",
                    ],
                    settings.PreferredAirlines
                )
            );
        }
        return new(issues.Count == 0, queryLimit, issues, previews);
    }

    private IEnumerable<string> SearchCodes(SearchLocation location)
    {
        var code = airports.SearchCode(location);
        return airports.FindByCode(code) is null ? [code] : location.AirportCodes;
    }

    public static IEnumerable<PlannedVisit[]> Orders(PlannedVisit[] visits)
    {
        return Walk([]);
        IEnumerable<PlannedVisit[]> Walk(PlannedVisit[] prefix)
        {
            if (prefix.Length == visits.Length)
            {
                yield return prefix;
                yield break;
            }
            foreach (
                var v in visits.Where(v =>
                    !prefix.Contains(v) && v.AfterVisitIds.All(id => prefix.Any(p => p.Id == id))
                )
            )
            {
                foreach (var result in Walk([.. prefix, v]))
                {
                    yield return result;
                }
            }
        }
    }

    private IEnumerable<DateOnly[]> Schedules(
        PlanningDocument doc,
        PlannedVisit[] visits,
        PartySearchSettings settings,
        CancellationToken token
    )
    {
        int flex = doc.SearchLimits.FlexibilityDays;
        int max = doc.SearchLimits.MaxTripDays;
        var anchor = visits.FirstOrDefault(v => v.PresentFrom is not null);
        var departureWindows = doc.Constraints.Where(c => c.Type == "departureWindow").ToArray();
        DateOnly reference =
            doc.TravelDates?.StartDate
            ?? anchor?.PresentFrom
            ?? departureWindows.Select(c => c.Window!.Earliest!.Value).Max();
        var today = DateOnly.FromDateTime(
            TimeZoneInfo
                .ConvertTime(
                    clock.GetUtcNow(),
                    TimeZoneInfo.FindSystemTimeZoneById(
                        airports.FindByCode(settings.Origin!.AirportCodes[0])!.TimeZone
                    )
                )
                .DateTime
        );
        var start = doc.TravelDates?.StartDate ?? reference.AddDays(-max);
        var end =
            doc.TravelDates?.StartDate ?? reference.AddDays(anchor?.ArrivalFlexibilityDays ?? 0);
        if (departureWindows.Length > 0)
        {
            start = departureWindows.Max(c => c.Window!.Earliest!.Value);
            end = departureWindows.Min(c => c.Window!.Latest!.Value);
        }
        int transitDays = (int)Math.Ceiling(settings.MaxJourneyHours / 24.0) + 1;
        var preferredStart = reference.AddDays(
            -1 - visits.TakeWhile(v => v != anchor).Sum(v => v.Nights ?? 1)
        );
        var starts = Enumerable
            .Range(0, Math.Max(0, end.DayNumber - start.DayNumber + 1))
            .Select(i => start.AddDays(i))
            .Where(d => d >= today)
            .OrderBy(d => Math.Abs(d.DayNumber - preferredStart.DayNumber))
            .ThenBy(d => d);
        foreach (
            var dates in Interleave(
                starts.Select(departure => Walk(0, departure, [departure], departure))
            )
        )
        {
            yield return dates;
        }

        IEnumerable<DateOnly[]> Walk(
            int index,
            DateOnly flightDate,
            DateOnly[] dates,
            DateOnly firstDate
        )
        {
            token.ThrowIfCancellationRequested();
            var visit = visits[index];
            var branches = new List<IEnumerable<DateOnly[]>>();
            // Include local date shifts in either direction; actual timestamps are checked after fares arrive.
            foreach (
                int shift in Enumerable
                    .Range(-1, transitDays + 2)
                    .OrderBy(i => Math.Abs(i - (index == 0 ? 1 : 0)))
            )
            {
                var arrival = flightDate.AddDays(shift);
                if (
                    visit.PresentFrom is { } from
                    && (
                        visit.ArrivalFlexibilityDays is { } arrivalFlex
                            ? arrival < from.AddDays(-arrivalFlex)
                                || arrival > from.AddDays(arrivalFlex)
                            : arrival > from || arrival < from.AddDays(-flex)
                    )
                )
                {
                    continue;
                }

                var earliest = visit.Nights is { } n
                    ? arrival.AddDays(n)
                    : visit.PresentThrough!.Value.AddDays(-(visit.DepartureFlexibilityDays ?? 0));
                var latest = visit.Nights is not null
                    ? earliest
                    : visit.PresentThrough!.Value.AddDays(visit.DepartureFlexibilityDays ?? flex);
                for (var leaving = earliest; leaving <= latest; leaving = leaving.AddDays(1))
                {
                    if (leaving < flightDate || leaving.DayNumber - firstDate.DayNumber > max)
                    {
                        continue;
                    }

                    if (
                        visit.PresentThrough is { } through
                        && (
                            visit.DepartureFlexibilityDays is { } departureFlex
                                ? leaving < through.AddDays(-departureFlex)
                                    || leaving > through.AddDays(departureFlex)
                                : leaving < through || leaving > through.AddDays(flex)
                        )
                    )
                    {
                        continue;
                    }

                    if (index == visits.Length - 1)
                    {
                        if (
                            doc.TravelDates?.EndDate is { } exact
                            && !doc.Constraints.Any(c => c.Type == "returnHomeWindow")
                            && leaving != exact
                        )
                        {
                            continue;
                        }

                        if (
                            !Window(doc, settings.PartyId, "departureWindow", firstDate)
                            || !Window(doc, settings.PartyId, "returnHomeWindow", leaving)
                        )
                        {
                            continue;
                        }

                        yield return [.. dates, leaving];
                    }
                    else
                    {
                        branches.Add(Walk(index + 1, leaving, [.. dates, leaving], firstDate));
                    }
                }
            }
            foreach (var result in Interleave(branches))
            {
                yield return result;
            }
        }
    }

    private static IEnumerable<T> Interleave<T>(IEnumerable<IEnumerable<T>> branches)
    {
        var iterators = branches.Select(branch => branch.GetEnumerator()).ToArray();
        try
        {
            bool moved;
            do
            {
                moved = false;
                foreach (var iterator in iterators)
                {
                    if (iterator.MoveNext())
                    {
                        moved = true;
                        yield return iterator.Current;
                    }
                }
            } while (moved);
        }
        finally
        {
            foreach (var iterator in iterators)
            {
                iterator.Dispose();
            }
        }
    }

    private static bool Window(
        PlanningDocument document,
        Guid partyId,
        string type,
        DateOnly date
    ) =>
        // This document has already been scoped to the current party.
        document
            .Constraints.Where(c => c.Type == type)
            .All(c => date >= c.Window!.Earliest && date <= c.Window.Latest);
}
