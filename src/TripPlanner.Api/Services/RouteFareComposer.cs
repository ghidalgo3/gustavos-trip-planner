using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services;

// Composes only complete, validated journeys. Provider bundles remain indivisible price offers.
public sealed class RouteFareComposer(AirportCatalog airports)
{
    private sealed record Leg(
        JsonElement Value,
        JsonElement[] Segments,
        DateTimeOffset Departure,
        DateTimeOffset Arrival,
        DateOnly DepartureDate,
        DateOnly ArrivalDate,
        string Origin,
        string Destination
    );

    private sealed record Offer(Leg[] Legs, decimal Price, string Currency, string Id, string Key);

    private sealed record Path(
        Leg[] Legs,
        decimal Price,
        string Currency,
        List<object> Bookings,
        Leg? ReservedReturn
    );

    public IReadOnlyList<FareSearchResult> Compose(
        PlanningDocument document,
        IReadOnlyList<Party> parties,
        IReadOnlyList<FareSearchResult> fares
    )
    {
        if (document.Visits.Length == 0)
            return fares;
        var results = new List<FareSearchResult>();
        foreach (var party in parties)
        {
            var settings = document.Parties.Single(p => p.PartyId == party.Id);
            var raw = fares.Where(f => f.PartyId == party.Id).OrderBy(f => f.CacheKey).ToArray();
            if (raw.Length == 0)
                continue;
            var offers = raw.SelectMany(f =>
                    ReadOffers(f, document, party, settings).OrderBy(o => o.Price).Take(30)
                )
                .ToArray();
            var complete = new List<Path>();
            foreach (var order in MultiCityPlanner.Orders(document.Visits))
            {
                var homes = settings.Origin!.AirportCodes;
                var firstAirports = order[0].Location!.AirportCodes;
                var lastAirports = order[^1].Location!.AirportCodes;
                var states = offers
                    .Where(o =>
                        homes.Contains(o.Legs[0].Origin)
                        && firstAirports.Contains(o.Legs[0].Destination)
                        && (
                            o.Legs.Length == 1
                            || (
                                lastAirports.Contains(o.Legs[1].Origin)
                                && homes.Contains(o.Legs[1].Destination)
                            )
                        )
                    )
                    .Select(o => new Path(
                        [o.Legs[0]],
                        o.Price,
                        o.Currency,
                        [
                            new
                            {
                                ignavId = o.Id,
                                legIndexes = o.Legs.Length == 1
                                    ? new[] { 0 }
                                    : new[] { 0, order.Length },
                            },
                        ],
                        o.Legs.Length == 2 ? o.Legs[1] : null
                    ))
                    .Where(p =>
                        document.TravelDates?.StartDate is null
                        || document.Constraints.Any(c =>
                            party.UserIds.Contains(c.UserId) && c.Type == "departureWindow"
                        )
                        || p.Legs[0].DepartureDate == document.TravelDates.StartDate
                    )
                    .ToArray();
                for (int step = 1; step <= order.Length; step++)
                {
                    var visit = order[step - 1];
                    var nextAirports =
                        step == order.Length ? homes : order[step].Location!.AirportCodes;
                    var next = new List<Path>();
                    foreach (var path in states)
                    {
                        if (step == order.Length && path.ReservedReturn is { } reserved)
                        {
                            if (StayFits(path.Legs[^1], reserved, visit, document))
                                next.Add(path with { Legs = [.. path.Legs, reserved] });
                            continue;
                        }
                        foreach (
                            var offer in offers.Where(o =>
                                o.Legs.Length == 1
                                && o.Currency == path.Currency
                                && visit.Location!.AirportCodes.Contains(o.Legs[0].Origin)
                                && nextAirports.Contains(o.Legs[0].Destination)
                            )
                        )
                        {
                            if (!StayFits(path.Legs[^1], offer.Legs[0], visit, document))
                                continue;
                            next.Add(
                                path with
                                {
                                    Legs = [.. path.Legs, offer.Legs[0]],
                                    Price = path.Price + offer.Price,
                                    Bookings =
                                    [
                                        .. path.Bookings,
                                        new { ignavId = offer.Id, legIndexes = new[] { step } },
                                    ],
                                }
                            );
                        }
                    }
                    // Bounded beam retaining alternatives by arrival time, so cheap late arrivals don't erase feasible earlier ones.
                    states = next.GroupBy(p =>
                            (
                                p.Legs[^1].Arrival,
                                p.Legs[^1].Destination,
                                p.ReservedReturn?.Departure,
                                p.Currency
                            )
                        )
                        .SelectMany(g => Rank(g, settings).Take(8))
                        .OrderBy(p => p.Price)
                        .Take(200)
                        .ToArray();
                }
                complete.AddRange(
                    states.Where(p =>
                        p.Legs.Length == order.Length + 1
                        && (
                            document.TravelDates?.EndDate is null
                            || document.Constraints.Any(c =>
                                party.UserIds.Contains(c.UserId) && c.Type == "returnHomeWindow"
                            )
                            || p.Legs[^1].DepartureDate == document.TravelDates.EndDate
                        )
                        && p.Legs[^1].Arrival - p.Legs[0].Departure
                            <= TimeSpan.FromDays(document.SearchLimits.MaxTripDays)
                        && WindowsFit(document, party, p)
                    )
                );
            }
            var ranked = Rank(complete, settings).DistinctBy(Signature).Take(100).ToArray();
            var response = JsonSerializer.SerializeToElement(
                new
                {
                    coverage = "Best itineraries found within the search budget. Date and flight coverage is not exhaustive.",
                    itineraries = ranked.Select(p => new
                    {
                        price = new { amount = p.Price, currency = p.Currency },
                        legs = p.Legs.Select(l => l.Value),
                        bookingOffers = p.Bookings,
                        stops = p.Legs.Sum(l => l.Segments.Length - 1),
                        durationMinutes = (int)
                            p.Legs.Sum(l => (l.Arrival - l.Departure).TotalMinutes),
                        preferredAirlineSegments = PreferredSegments(p, settings),
                        preferredHomeAirport = settings.PreferredAirport is not null
                            && p.Legs[0].Origin == settings.PreferredAirport,
                        separateTickets = p.Bookings.Count > 1,
                    }),
                },
                JsonSerializerOptions.Web
            );
            var provenance =
                JsonSerializer.Serialize(document)
                + string.Join("|", raw.Select(f => $"{f.CacheKey}:{f.FetchedAt:O}"));
            var key = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(provenance)));
            results.Add(
                new(
                    party.Id,
                    key,
                    raw[0].Request with
                    {
                        SearchKind = "itinerary",
                        Legs = null,
                    },
                    response,
                    raw.Min(f => f.FetchedAt),
                    raw.Min(f => f.ExpiresAt)
                )
            );
        }
        return results;
    }

    private static IOrderedEnumerable<Path> Rank(
        IEnumerable<Path> paths,
        PartySearchSettings settings
    ) =>
        paths
            .OrderBy(p => p.Currency, StringComparer.Ordinal)
            .ThenBy(p => p.Price)
            .ThenBy(p => p.Legs.Sum(l => l.Segments.Length - 1))
            .ThenByDescending(p => PreferredSegments(p, settings))
            .ThenByDescending(p => p.Legs[0].Origin == settings.PreferredAirport)
            .ThenBy(p => p.Legs.Sum(l => (l.Arrival - l.Departure).TotalMinutes))
            .ThenBy(Signature, StringComparer.Ordinal);

    private static int PreferredSegments(Path p, PartySearchSettings s) =>
        p.Legs.Sum(l =>
            l.Segments.Count(segment =>
                s.PreferredAirlines.Contains(
                    Text(segment, "marketing_carrier_code"),
                    StringComparer.OrdinalIgnoreCase
                )
            )
        );

    private static string Signature(Path p) =>
        string.Join(
            "|",
            p.Legs.SelectMany(l => l.Segments)
                .Select(s =>
                    $"{Text(s, "departure_airport")}:{Text(s, "arrival_airport")}:{Text(s, "departure_time_local")}:{Text(s, "flight_number")}"
                )
        );

    private static bool StayFits(
        Leg incoming,
        Leg outgoing,
        PlannedVisit visit,
        PlanningDocument document
    )
    {
        if (outgoing.Departure <= incoming.Arrival)
            return false;
        var nights = outgoing.DepartureDate.DayNumber - incoming.ArrivalDate.DayNumber;
        if (nights < 1 || (visit.Nights is { } required && nights != required))
            return false;
        int flex = document.SearchLimits.FlexibilityDays;
        return (
                visit.PresentFrom is not { } start
                || incoming.ArrivalDate <= start && incoming.ArrivalDate >= start.AddDays(-flex)
            )
            && (
                visit.PresentThrough is not { } end
                || outgoing.DepartureDate >= end && outgoing.DepartureDate <= end.AddDays(flex)
            );
    }

    private static bool WindowsFit(PlanningDocument document, Party party, Path path) =>
        document
            .Constraints.Where(c =>
                party.UserIds.Contains(c.UserId)
                && c.Type is "departureWindow" or "returnHomeWindow"
            )
            .All(c =>
            {
                var date =
                    c.Type == "departureWindow"
                        ? path.Legs[0].DepartureDate
                        : path.Legs[^1].DepartureDate;
                return date >= c.Window!.Earliest && date <= c.Window.Latest;
            });

    private IEnumerable<Offer> ReadOffers(
        FareSearchResult fare,
        PlanningDocument doc,
        Party party,
        PartySearchSettings settings
    )
    {
        if (
            fare.Response.ValueKind != JsonValueKind.Object
            || !fare.Response.TryGetProperty("itineraries", out var list)
            || list.ValueKind != JsonValueKind.Array
        )
            yield break;
        foreach (var item in list.EnumerateArray())
        {
            if (
                item.ValueKind != JsonValueKind.Object
                || !item.TryGetProperty("price", out var price)
                || price.ValueKind != JsonValueKind.Object
                || !price.TryGetProperty("amount", out var amount)
                || amount.ValueKind != JsonValueKind.Number
                || !amount.TryGetDecimal(out var cost)
                || cost <= 0
                || Text(price, "currency") is not { } currency
                || Text(item, "ignav_id") is not { } id
                || item.TryGetProperty("requires_self_transfer", out var transfer)
                    && transfer.ValueKind == JsonValueKind.True
            )
                continue;
            JsonElement[] values =
                fare.Request.SearchKind == "flexible"
                    ? item.TryGetProperty("legs", out var legs)
                    && legs.ValueKind == JsonValueKind.Array
                        ? legs.EnumerateArray().ToArray()
                        : []
                    : item.TryGetProperty("outbound", out var outbound)
                        ? [outbound]
                        : [];
            var queries =
                fare.Request.Legs
                ??
                [
                    new IgnavLegRequest(
                        fare.Request.Origin,
                        fare.Request.Destination,
                        fare.Request.DepartureDate,
                        fare.Request.MaxStops
                    ),
                ];
            if (values.Length != queries.Length || values.Length is < 1 or > 2)
                continue;
            var parsed = values.Select(ReadLeg).ToArray();
            if (parsed.Any(l => l is null))
                continue;
            var complete = parsed.Select(l => l!).ToArray();
            bool valid = true;
            for (int i = 0; i < complete.Length; i++)
            {
                var leg = complete[i];
                var query = queries[i];
                if (
                    leg.DepartureDate != query.DepartureDate
                    || !MatchesQuery(query.Origin, leg.Origin, doc, settings)
                    || !MatchesQuery(query.Destination, leg.Destination, doc, settings)
                    || leg.Arrival - leg.Departure > TimeSpan.FromHours(settings.MaxJourneyHours)
                    || settings.MaxStops is { } max && leg.Segments.Length - 1 > max
                )
                {
                    valid = false;
                    break;
                }
                foreach (var c in doc.Constraints.Where(c => party.UserIds.Contains(c.UserId)))
                {
                    if (c.Type == "nonstop" && leg.Segments.Length > 1)
                        valid = false;
                    if (c.Type == "avoidLayover")
                        foreach (var segment in leg.Segments.SkipLast(1))
                        {
                            var code = Text(segment, "arrival_airport");
                            var airport = code is null ? null : airports.FindByCode(code);
                            bool excluded = c.LocationType switch
                            {
                                "airport" => string.Equals(
                                    code,
                                    c.Location,
                                    StringComparison.OrdinalIgnoreCase
                                ),
                                "city" => airport is null
                                    || airports.IsInCity(code!, c.Location ?? ""),
                                "country" => airport is null
                                    || string.Equals(
                                        airport.Country,
                                        c.Location,
                                        StringComparison.OrdinalIgnoreCase
                                    ),
                                "region" => airport is null
                                    || c.CountryCodes.Contains(airport.Country),
                                _ => true,
                            };
                            if (excluded)
                                valid = false;
                        }
                }
            }
            if (valid)
                yield return new(complete, cost, currency, id, fare.CacheKey);
        }
    }

    private bool MatchesQuery(
        string requested,
        string actual,
        PlanningDocument doc,
        PartySearchSettings settings
    ) =>
        requested == actual
        || new[] { settings.Origin! }
            .Concat(doc.Visits.Select(v => v.Location!))
            .Any(location =>
                airports.SearchCode(location) == requested && location.AirportCodes.Contains(actual)
            );

    private Leg? ReadLeg(JsonElement value)
    {
        if (
            value.ValueKind != JsonValueKind.Object
            || !value.TryGetProperty("segments", out var array)
            || array.ValueKind != JsonValueKind.Array
            || array.GetArrayLength() == 0
        )
            return null;
        var segments = array.EnumerateArray().ToArray();
        DateTimeOffset? previousArrival = null;
        string? previousAirport = null;
        foreach (var segment in segments)
        {
            var departure = Instant(segment, "departure");
            var arrival = Instant(segment, "arrival");
            if (
                departure is null
                || arrival is null
                || arrival <= departure
                || previousArrival is { } prior && departure < prior.AddMinutes(45)
                || previousAirport is not null
                    && previousAirport != Text(segment, "departure_airport")
            )
                return null;
            previousArrival = arrival;
            previousAirport = Text(segment, "arrival_airport");
        }
        if (
            !DateTime.TryParse(
                Text(segments[0], "departure_time_local"),
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var start
            )
            || !DateTime.TryParse(
                Text(segments[^1], "arrival_time_local"),
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var end
            )
            || Text(segments[0], "departure_airport") is not { } origin
            || Text(segments[^1], "arrival_airport") is not { } destination
        )
            return null;
        return new(
            value.Clone(),
            segments,
            Instant(segments[0], "departure")!.Value,
            Instant(segments[^1], "arrival")!.Value,
            DateOnly.FromDateTime(start),
            DateOnly.FromDateTime(end),
            origin,
            destination
        );
    }

    private DateTimeOffset? Instant(JsonElement segment, string kind)
    {
        if (
            DateTimeOffset.TryParse(
                Text(segment, kind + "_time_utc"),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal,
                out var utc
            )
        )
            return utc;
        var code = Text(segment, kind + "_airport");
        var airport = code is null ? null : airports.FindByCode(code);
        if (
            airport is null
            || !DateTime.TryParse(
                Text(segment, kind + "_time_local"),
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var local
            )
        )
            return null;
        var zone = TimeZoneInfo.FindSystemTimeZoneById(airport.TimeZone);
        local = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(local) || zone.IsAmbiguousTime(local))
            return null;
        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, zone));
    }

    private static string? Text(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object
        && element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
