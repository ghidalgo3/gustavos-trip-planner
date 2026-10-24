using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services.Flights;

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
    )
    {
        public string Key { get; } = FlightChoiceRoute.FlightKey(Value)!;
    }

    private sealed record Offer(Leg[] Legs, decimal Price, string Currency, string Id, string Key);

    private sealed record Path(Leg[] Legs, decimal Price, string Currency, List<object> Bookings);

    public IReadOnlyList<FareSearchResult> Compose(
        PlanningDocument document,
        IReadOnlyList<Party> parties,
        IReadOnlyList<FareSearchResult> fares,
        IReadOnlyList<FlightChoiceProgress>? savedChoices = null,
        bool includeAllConnections = false
    )
    {
        if (document.Visits.Length == 0)
        {
            return fares;
        }

        var results = new List<FareSearchResult>();
        foreach (var party in parties)
        {
            var chosen =
                savedChoices?.FirstOrDefault(choice => choice.PartyId == party.Id)?.LegKeys ?? [];
            var settings = document.Parties.Single(p => p.PartyId == party.Id);
            var raw = fares.Where(f => f.PartyId == party.Id).OrderBy(f => f.CacheKey).ToArray();
            if (raw.Length == 0)
            {
                continue;
            }

            var selectedKeys = chosen.OfType<string>().ToHashSet(StringComparer.Ordinal);
            var offers = raw.SelectMany(f =>
                {
                    var available = ReadOffers(f, document, party, settings).ToArray();
                    var rankedOffers = available
                        .GroupBy(o =>
                            Text(o.Legs[0].Segments[0], "operating_carrier_name")
                            ?? Text(o.Legs[0].Segments[0], "marketing_carrier_code")
                        )
                        .SelectMany(carrier => carrier.OrderBy(o => o.Price).Take(12))
                        .OrderBy(o => o.Price)
                        .Take(100);
                    return rankedOffers
                        .Concat(
                            available.Where(offer =>
                                offer.Legs.Any(leg => selectedKeys.Contains(FlightKey(leg)))
                            )
                        )
                        .Distinct();
                })
                .ToArray();
            var gridFlights = GridFlights(document, settings, offers);
            var flightIndexes = gridFlights
                .Select(
                    (flight, index) =>
                        (
                            flight.LegIndex,
                            Key: FlightChoiceRoute.FlightKey(flight.Leg),
                            Index: index
                        )
                )
                .ToDictionary(flight => (flight.LegIndex, flight.Key), flight => flight.Index);
            var compositions = BuildRouteGraphs(
                    document,
                    party,
                    settings,
                    offers,
                    chosen,
                    flightIndexes
                )
                .ToArray();
            var graphCompositions =
                includeAllConnections && chosen.Length > 0
                    ? BuildRouteGraphs(document, party, settings, offers, [], flightIndexes)
                        .ToArray()
                    : compositions;
            var flightConnections = graphCompositions
                .SelectMany(composition => composition.Connections)
                .Distinct()
                .ToArray();
            var connectionIndexes = flightConnections
                .Select((connection, index) => (connection, index))
                .ToDictionary(item => item.connection, item => item.index);
            var routeGraphs = graphCompositions
                .Select(composition => new FlightGridRouteGraphDto(
                    composition
                        .Connections.Select(connection => connectionIndexes[connection])
                        .Order()
                        .ToArray(),
                    composition.Currency,
                    composition.Costs
                ))
                .ToArray();
            var complete = compositions.SelectMany(composition => composition.Paths);
            // Retain a priced, reviewable route for every compatible card. Ranking
            // chooses representatives, never which flights count as connected.
            var ordered = Rank(complete, settings).DistinctBy(Signature).ToArray();
            var diverse = Enumerable
                .Range(0, document.Visits.Length + 1)
                .SelectMany(index => ordered.DistinctBy(path => FlightKey(path.Legs[index])));
            var ranked = Rank(diverse.Concat(ordered.Take(200)).DistinctBy(Signature), settings)
                .ToArray();
            var roundTripConnections =
                document.Visits.Length == 1
                    ? flightConnections
                        .Select(edge => new FlightGridConnectionDto(
                            edge.FromFlightIndex,
                            edge.ToFlightIndex
                        ))
                        .Distinct()
                        .ToArray()
                    : null;
            var response = JsonSerializer.SerializeToElement(
                new
                {
                    flights = gridFlights,
                    roundTripConnections,
                    flightConnections,
                    routeGraphs,
                    choiceKeys = chosen,
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
                + JsonSerializer.Serialize(chosen)
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

    private sealed record RouteNode(
        Leg Leg,
        decimal Cost,
        object? Booking,
        Path Prefix,
        int FlightIndex,
        RouteNode[] Parents
    );

    private static object Booking(Offer offer, params int[] indexes) =>
        new
        {
            ignavId = offer.Id,
            price = new { amount = offer.Price, currency = offer.Currency },
            legIndexes = indexes,
        };

    // A layered graph avoids enumerating the Cartesian product of flights. Keeping
    // each outbound offer separate preserves currency, trip duration and paired-fare
    // restrictions. Within that context only adjacent stays affect connectivity.
    private static IEnumerable<(
        FlightGridEdgeDto[] Connections,
        Path[] Paths,
        string Currency,
        FlightGridRouteCostDto[] Costs
    )> BuildRouteGraphs(
        PlanningDocument document,
        Party party,
        PartySearchSettings settings,
        Offer[] offers,
        string?[] chosen,
        Dictionary<(int, string?), int> flightIndexes
    )
    {
        var visits = document.Visits;
        var homes = settings.Origin!.AirportCodes;
        var starts = offers
            .Where(offer =>
                homes.Contains(offer.Legs[0].Origin)
                && visits[0].Location!.AirportCodes.Contains(offer.Legs[0].Destination)
                && ArrivalFits(offer.Legs[0], visits[0], document)
                && (
                    chosen.Length == 0 || chosen[0] is null || FlightKey(offer.Legs[0]) == chosen[0]
                )
                && (
                    offer.Legs.Length == 1
                    || (
                        visits[^1].Location!.AirportCodes.Contains(offer.Legs[1].Origin)
                        && homes.Contains(offer.Legs[1].Destination)
                    )
                )
                && (
                    document.TravelDates?.StartDate is null
                    || document.Constraints.Any(c =>
                        party.UserIds.Contains(c.UserId) && c.Type == "departureWindow"
                    )
                    || offer.Legs[0].DepartureDate == document.TravelDates.StartDate
                )
                && WindowFits(document, party, "departureWindow", offer.Legs[0].DepartureDate)
            )
            .OrderBy(offer => offer.Price)
            .DistinctBy(offer =>
                (
                    FlightKey(offer.Legs[0]),
                    Return: offer.Legs.Length == 2 ? FlightKey(offer.Legs[1]) : null,
                    offer.Currency
                )
            );
        var onward = Enumerable
            .Range(1, visits.Length)
            .Select(step =>
                offers
                    .Where(offer =>
                        offer.Legs.Length == 1
                        && visits[step - 1].Location!.AirportCodes.Contains(offer.Legs[0].Origin)
                        && (
                            step == visits.Length ? homes : visits[step].Location!.AirportCodes
                        ).Contains(offer.Legs[0].Destination)
                        && DepartureFits(offer.Legs[0], visits[step - 1], document)
                        && (
                            step == visits.Length
                            || ArrivalFits(offer.Legs[0], visits[step], document)
                        )
                        && (
                            step >= chosen.Length
                            || chosen[step] is null
                            || FlightKey(offer.Legs[0]) == chosen[step]
                        )
                    )
                    .OrderBy(offer => offer.Price)
                    .DistinctBy(offer => (offer.Currency, Key: FlightKey(offer.Legs[0])))
                    .ToArray()
            )
            .ToArray();

        foreach (var start in starts)
        {
            var booking = Booking(start, start.Legs.Length == 2 ? [0, visits.Length] : [0]);
            var first = new RouteNode(
                start.Legs[0],
                start.Price,
                booking,
                new Path([start.Legs[0]], start.Price, start.Currency, [booking]),
                flightIndexes[(0, FlightKey(start.Legs[0]))],
                []
            );
            List<RouteNode[]> layers =
            [
                [first],
            ];
            for (int step = 1; step <= visits.Length; step++)
            {
                var reserved = step == visits.Length && start.Legs.Length == 2;
                var options = reserved ? [start] : onward[step - 1];
                var nodes = new List<RouteNode>();
                foreach (var offer in options.Where(offer => offer.Currency == start.Currency))
                {
                    var leg = offer.Legs[reserved ? 1 : 0];
                    if (
                        (
                            step < chosen.Length
                            && chosen[step] is not null
                            && FlightKey(leg) != chosen[step]
                        ) || (step == visits.Length && !EndsFit(document, party, first.Leg, leg))
                    )
                    {
                        continue;
                    }
                    var parents = layers[^1]
                        .Where(parent => StayFits(parent.Leg, leg, visits[step - 1], document))
                        .ToArray();
                    if (parents.Length == 0)
                    {
                        continue;
                    }
                    var prefix = Rank(parents.Select(parent => parent.Prefix), settings).First();
                    var cost = reserved ? 0 : offer.Price;
                    var nextBooking = reserved ? null : Booking(offer, step);
                    nodes.Add(
                        new RouteNode(
                            leg,
                            cost,
                            nextBooking,
                            new Path(
                                [.. prefix.Legs, leg],
                                prefix.Price + cost,
                                start.Currency,
                                nextBooking is null
                                    ? prefix.Bookings
                                    : [.. prefix.Bookings, nextBooking]
                            ),
                            flightIndexes[(step, FlightKey(leg))],
                            parents
                        )
                    );
                }
                layers.Add(nodes.ToArray());
            }
            // Walk back only from valid returns. Dead ends cannot mark a flight as
            // complete. The best suffix and prefix give a priced route through each
            // surviving node without dropping more expensive alternatives.
            var suffixes = layers[^1]
                .ToDictionary(
                    node => node,
                    node => new Path(
                        [node.Leg],
                        node.Cost,
                        start.Currency,
                        node.Booking is null ? [] : [node.Booking]
                    )
                );
            var connections = new List<FlightGridEdgeDto>();
            for (int step = visits.Length; step > 0; step--)
            {
                foreach (var node in layers[step])
                {
                    if (!suffixes.TryGetValue(node, out var suffix))
                    {
                        continue;
                    }
                    foreach (var parent in node.Parents)
                    {
                        connections.Add(
                            new FlightGridEdgeDto(parent.FlightIndex, node.FlightIndex)
                        );
                        var candidate = new Path(
                            [parent.Leg, .. suffix.Legs],
                            parent.Cost + suffix.Price,
                            start.Currency,
                            parent.Booking is null
                                ? suffix.Bookings
                                : [parent.Booking, .. suffix.Bookings]
                        );
                        suffixes[parent] = suffixes.TryGetValue(parent, out var existing)
                            ? Rank([existing, candidate], settings).First()
                            : candidate;
                    }
                }
            }
            if (connections.Count == 0)
            {
                continue;
            }
            var paths = suffixes
                .Select(pair =>
                {
                    var (node, suffix) = pair;
                    return new Path(
                        [.. node.Prefix.Legs, .. suffix.Legs.Skip(1)],
                        node.Prefix.Price + suffix.Price - node.Cost,
                        start.Currency,
                        [
                            .. node.Prefix.Bookings,
                            .. suffix.Bookings.Skip(node.Booking is null ? 0 : 1),
                        ]
                    );
                })
                .ToArray();
            yield return (
                connections.ToArray(),
                paths,
                start.Currency,
                suffixes
                    .Keys.Select(node => new FlightGridRouteCostDto(node.FlightIndex, node.Cost))
                    .ToArray()
            );
        }
    }

    private static bool EndsFit(PlanningDocument document, Party party, Leg first, Leg last) =>
        (
            document.TravelDates?.EndDate is null
            || document.Constraints.Any(c =>
                party.UserIds.Contains(c.UserId) && c.Type == "returnHomeWindow"
            )
            || last.DepartureDate == document.TravelDates.EndDate
        )
        && last.Arrival - first.Departure <= TimeSpan.FromDays(document.SearchLimits.MaxTripDays)
        && WindowFits(document, party, "returnHomeWindow", last.DepartureDate);

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

    // Use the same identity as the cards, including arrival timestamps. Otherwise
    // route deduplication could erase the only witness for a distinct flight card.
    private static string Signature(Path p) =>
        JsonSerializer.Serialize(new { p.Currency, Keys = p.Legs.Select(FlightKey) });

    private static string FlightKey(Leg leg) => leg.Key;

    private static bool StayFits(
        Leg incoming,
        Leg outgoing,
        PlannedVisit visit,
        PlanningDocument document
    )
    {
        if (outgoing.Departure <= incoming.Arrival)
        {
            return false;
        }

        var nights = outgoing.DepartureDate.DayNumber - incoming.ArrivalDate.DayNumber;
        if (nights < 1 || (visit.Nights is { } required && nights != required))
        {
            return false;
        }

        return ArrivalFits(incoming, visit, document) && DepartureFits(outgoing, visit, document);
    }

    private static bool ArrivalFits(Leg leg, PlannedVisit visit, PlanningDocument document) =>
        visit.PresentFrom is not { } start
        || (
            visit.ArrivalFlexibilityDays is { } flex
                ? leg.ArrivalDate >= start.AddDays(-flex) && leg.ArrivalDate <= start.AddDays(flex)
                : leg.ArrivalDate <= start
                    && leg.ArrivalDate >= start.AddDays(-document.SearchLimits.FlexibilityDays)
        );

    private static bool DepartureFits(Leg leg, PlannedVisit visit, PlanningDocument document) =>
        visit.PresentThrough is not { } end
        || (
            visit.DepartureFlexibilityDays is { } flex
                ? leg.DepartureDate >= end.AddDays(-flex) && leg.DepartureDate <= end.AddDays(flex)
                : leg.DepartureDate >= end
                    && leg.DepartureDate <= end.AddDays(document.SearchLimits.FlexibilityDays)
        );

    // Individual offers can arrive before a complete route exists. Keep their
    // column identity separate from complete paths, especially for repeat visits.
    private static IReadOnlyList<FlightGridOptionDto> GridFlights(
        PlanningDocument document,
        PartySearchSettings settings,
        Offer[] offers
    )
    {
        var visits = document.Visits;
        return Enumerable
            .Range(0, visits.Length + 1)
            .SelectMany(index =>
            {
                var origin = index == 0 ? settings.Origin! : visits[index - 1].Location!;
                var destination =
                    index == visits.Length ? settings.Origin! : visits[index].Location!;
                return offers
                    .SelectMany(offer =>
                        offer.Legs.Select(
                            (leg, offerIndex) =>
                                new
                                {
                                    offer,
                                    leg,
                                    offerIndex,
                                }
                        )
                    )
                    .Where(item =>
                        (
                            item.offer.Legs.Length == 1
                            || (item.offerIndex == 0 ? index == 0 : index == visits.Length)
                        )
                        && origin.AirportCodes.Contains(item.leg.Origin)
                        && destination.AirportCodes.Contains(item.leg.Destination)
                        && (index == 0 || DepartureFits(item.leg, visits[index - 1], document))
                        && (
                            index == visits.Length || ArrivalFits(item.leg, visits[index], document)
                        )
                    )
                    .OrderBy(item => item.offer.Currency, StringComparer.Ordinal)
                    .ThenBy(item => item.offer.Price)
                    .DistinctBy(item => FlightKey(item.leg))
                    .Select(item => new FlightGridOptionDto(
                        index,
                        item.leg.Value,
                        new FlightGridPriceDto(item.offer.Price, item.offer.Currency),
                        item.offer.Legs.Length
                    ));
            })
            .ToArray();
    }

    private static bool WindowFits(
        PlanningDocument document,
        Party party,
        string type,
        DateOnly date
    ) =>
        document
            .Constraints.Where(c => party.UserIds.Contains(c.UserId) && c.Type == type)
            .All(c => date >= c.Window!.Earliest && date <= c.Window.Latest);

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
        {
            yield break;
        }

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
            {
                continue;
            }

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
            {
                continue;
            }

            var parsed = values.Select(ReadLeg).ToArray();
            if (parsed.Any(l => l is null))
            {
                continue;
            }

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
                    {
                        valid = false;
                    }

                    if (c.Type == "avoidLayover")
                    {
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
                            {
                                valid = false;
                            }
                        }
                    }
                }
            }
            if (valid)
            {
                yield return new(complete, cost, currency, id, fare.CacheKey);
            }
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
        {
            return null;
        }

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
            {
                return null;
            }

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
        {
            return null;
        }

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
        {
            return utc;
        }

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
        {
            return null;
        }

        var zone = TimeZoneInfo.FindSystemTimeZoneById(airport.TimeZone);
        local = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(local) || zone.IsAmbiguousTime(local))
        {
            return null;
        }

        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, zone));
    }

    private static string? Text(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object
        && element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
