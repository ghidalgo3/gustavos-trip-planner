using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Serialization;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Services.Destinations;
using TripPlanner.Api.Services.Flights;

namespace TripPlanner.Api.Services.Documents;

// Pure projection of a transactionally captured read model. No providers or persistence.
public sealed class TripResourceProjection(
    AirportCatalog airports,
    DestinationFlightPlanning flightPlanning,
    RouteFareComposer routes,
    ActivityFlightAvailability availability,
    ActivityPlanningService planning
)
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters =
        {
            new IsoTimeOnlyConverter(),
            new IsoDurationConverter(),
            new UtcDateTimeOffsetConverter(),
        },
    };

    public static string Id(Guid id) => $"urn:uuid:{id:D}";

    public static string LocalId(Guid tripId, string kind, string key) =>
        $"urn:tripplanner:{tripId:D}:{kind}:{Uri.EscapeDataString(key)}";

    public static JsonObject Reference(string id) => new() { ["@id"] = id };

    public static JsonNode? Node<T>(T value) => JsonSerializer.SerializeToNode(value, JsonOptions);

    public static string ETag<T>(T value) =>
        $"\"{Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions)))}\"";

    public static Guid StableGuid(string key)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(key));
        bytes[6] = (byte)((bytes[6] & 0x0f) | 0x80);
        bytes[8] = (byte)((bytes[8] & 0x3f) | 0x80);
        return new Guid(bytes.AsSpan(0, 16), bigEndian: true);
    }

    public TripResourceView Project(TripReadData data)
    {
        var tripId = data.Trip.Id;
        var prefix = $"/trips/{tripId:D}";
        var resources = new SortedDictionary<string, TripResource>(StringComparer.Ordinal);
        void Add(
            string path,
            object? body,
            string? etag = null,
            int status = 200,
            string? context = null,
            string contentType = "application/json"
        )
        {
            var json = JsonSerializer.SerializeToElement(body, JsonOptions);
            resources[path] = new(path, etag ?? ETag(json), json, status, contentType, context);
        }
        var destinations = DestinationService.Describe(data.Destinations, data.Visits, data.Stays);
        var owner = data.People.FirstOrDefault(p => p.Id == data.Trip.OwnerUserId);
        var document = flightPlanning.Describe(data.Trip, destinations, owner, data.Parties);
        var fallbackChoices = data
            .Flights.Where(f => !data.Choices.Any(c => c.PartyId == f.PartyId))
            .Select(f =>
            {
                var legs = BookingLegs(f.Itinerary).ToArray();
                var keys = legs.Select(FlightChoiceRoute.FlightKey).ToArray();
                return new FlightChoiceProgress(f.PartyId, keys, [])
                {
                    // Export saved complete itineraries through one known service
                    // edge per leg; their original requests may be round-trip or flexible.
                    SavedFares = legs.Select(
                            (leg, index) =>
                            {
                                var segments = leg.GetProperty("segments");
                                var origin = segments[0]
                                    .GetProperty("departure_airport")
                                    .GetString()!;
                                var destination = segments[segments.GetArrayLength() - 1]
                                    .GetProperty("arrival_airport")
                                    .GetString()!;
                                return new FareSearchResult(
                                    f.PartyId,
                                    f.CacheKey + ":document:" + index,
                                    f.Request with
                                    {
                                        SearchKind = "oneWay",
                                        Origin = origin,
                                        Destination = destination,
                                        Legs = null,
                                    },
                                    JsonSerializer.SerializeToElement(
                                        new { itineraries = new[] { new { outbound = leg } } }
                                    ),
                                    f.SelectedAt,
                                    f.SelectedAt
                                );
                            }
                        )
                        .ToArray(),
                };
            })
            .ToArray();
        var choices = data
            .Choices.Concat(fallbackChoices)
            .Select(c => SavedFlightChoices.Reconcile(c, document, airports))
            .ToArray();
        var choiceDtos = choices
            .Where(c => data.Choices.Any(original => original.PartyId == c.PartyId))
            .Select(c => new FlightChoiceProgressDto(c.PartyId, c.LegKeys, c.NextOrigins)
            {
                Flights = SavedFlightChoices.SelectedLegs(c),
                UnmatchedFlights = SavedFlightChoices.UnmatchedFlights(c),
                PurchasedOfferIds = c.PurchasedOfferIds,
                Bookings = data.Parties.FirstOrDefault(p => p.Id == c.PartyId) is { } party
                    ? routes.ChoiceBookings(document, party, c)
                    : [],
            })
            .ToArray();
        var parties = data
            .Parties.Select(p => new PlanningParty(
                p.Id,
                p.UserIds.Select(id => new PlanningMember(
                        id,
                        data.People.FirstOrDefault(u => u.Id == id)?.DisplayName
                            ?? "Unknown traveler",
                        data.People.FirstOrDefault(u => u.Id == id)?.HomeCityName,
                        id == data.Trip.OwnerUserId ? PartyRole.Planner : p.RoleFor(id)
                    ))
                    .ToArray(),
                owner is null ? null : airports.SuggestOrigin([owner]),
                owner?.PreferredAirport
            ))
            .ToArray();
        var firstVisit = data.Visits.MinBy(visit => visit.Order);
        var lastVisit = data.Visits.MaxBy(visit => visit.Order);
        var tripResponse = TripResponse.From(data.Trip, data.CanPlan) with
        {
            StartDate = firstVisit?.ArrivalDate ?? firstVisit?.DepartureDate,
            EndDate = lastVisit?.DepartureDate ?? lastVisit?.ArrivalDate,
        };
        Add(prefix, tripResponse, tripResponse.Etag);
        Add($"{prefix}/transportation", data.Transportation);
        foreach (var journey in data.Transportation)
        {
            Add(
                $"{prefix}/transportation/{journey.Id:D}",
                journey,
                $"\"{journey.Etag}\"",
                contentType: "application/geo+json"
            );
        }
        Add($"{prefix}/hotels", data.Hotels);
        foreach (var hotel in data.Hotels)
        {
            Add($"{prefix}/hotels/{hotel.Id:D}", hotel, $"\"{hotel.Etag}\"");
        }
        Add($"{prefix}/parties", parties);
        Add(
            $"{prefix}/travellers",
            parties.SelectMany(p => p.Members).OrderBy(m => m.Id).ToArray()
        );
        foreach (var member in parties.SelectMany(p => p.Members))
        {
            Add($"{prefix}/travellers/{member.Id:D}", member);
        }
        Add($"{prefix}/flights", data.Flights, status: data.Flights.Length == 0 ? 204 : 200);
        Add($"{prefix}/flights/constraints", document);
        Add($"{prefix}/flights/choices", choiceDtos);
        foreach (var party in data.Parties)
        {
            Add(
                $"{prefix}/flights/choices/{party.Id:D}",
                choiceDtos.FirstOrDefault(c => c.PartyId == party.Id)
                    ?? new FlightChoiceProgressDto(party.Id, [], [])
            );
            Add(
                $"{prefix}/flights/{party.Id:D}",
                data.Flights.FirstOrDefault(f => f.PartyId == party.Id)
            );
            foreach (var member in data.People)
            {
                Add(
                    $"{prefix}/parties/{party.Id:D}/members/{member.Id:D}",
                    party.UserIds.Contains(member.Id)
                        ? new { memberId = member.Id, role = party.RoleFor(member.Id).ToString() }
                        : null
                );
            }
        }
        Add(
            $"{prefix}/activity-preferences",
            data.TripPreferences.Preferences,
            ActivityPlanRules.ETag(data.TripPreferences.Version)
        );
        Add($"{prefix}/destinations", destinations.Collection, contentType: "application/geo+json");
        var inactive = data
            .Destinations.Where(p => !data.Visits.Any(v => v.CityId == p.CityId))
            .Select(p => new GeoJsonFeature<DestinationProperties>(
                "Feature",
                p.CityId,
                new("Point", Microsoft.Spatial.GeographyPoint.Create(p.Latitude, p.Longitude)),
                new(p.Name, p.CountryCode, p.TimeZone, p.ContextVersion, null, null, [], false)
                {
                    Constraints = p.Constraints,
                }
            ))
            .ToArray();
        Add(
            $"{prefix}/destinations?includeInactive=true",
            new GeoJsonCollection<DestinationProperties>(
                "FeatureCollection",
                [.. destinations.Collection.Features, .. inactive],
                destinations.Collection.Route
            ),
            contentType: "application/geo+json"
        );

        var places = new SortedDictionary<string, JsonObject>(StringComparer.Ordinal);
        string PlaceId(string key) => LocalId(tripId, "place", key);
        void AddPlace(
            string id,
            string name,
            double? longitude,
            double? latitude,
            string? zone = null,
            string type = "Place"
        )
        {
            var place = new JsonObject
            {
                ["id"] = id,
                ["type"] = type,
                ["name"] = name,
            };
            place["location"] =
                longitude is not null && latitude is not null
                    ? new JsonObject
                    {
                        ["type"] = "Point",
                        ["coordinates"] = new JsonArray(longitude, latitude),
                    }
                    : null;
            if (!string.IsNullOrEmpty(zone))
            {
                place["timeZone"] = zone;
            }
            places[id] = place;
        }
        var homeId = PlaceId("home");
        AddPlace(
            homeId,
            owner?.HomeCityName ?? "Home",
            owner?.HomeCityLocation?.Longitude,
            owner?.HomeCityLocation?.Latitude,
            owner?.HomeCityLocation is { } homePoint
                ? GeoTimeZone
                    .TimeZoneLookup.GetTimeZone(homePoint.Latitude, homePoint.Longitude)
                    .Result
                : null
        );
        foreach (var p in data.Destinations)
        {
            AddPlace(PlaceId(p.CityId), p.Name, p.Longitude, p.Latitude, p.TimeZone);
        }
        foreach (var hotel in data.Hotels)
        {
            var id = PlaceId($"hotel:{hotel.Id:D}");
            AddPlace(
                id,
                hotel.Name,
                hotel.Geometry.Position.Longitude,
                hotel.Geometry.Position.Latitude,
                hotel.TimeZone
            );
            places[id]["hotelId"] = hotel.Id.ToString("D");
            places[id]["address"] = hotel.Address;
            places[id]["etag"] = hotel.Etag;
            places[id]["version"] = hotel.Version;
        }
        foreach (var person in data.People)
        {
            var personPlaceId =
                person.Id == data.Trip.OwnerUserId ? homeId : PlaceId($"home:{person.Id:D}");
            AddPlace(
                personPlaceId,
                person.HomeCityName ?? "Home",
                person.HomeCityLocation?.Longitude,
                person.HomeCityLocation?.Latitude,
                person.HomeCityLocation is { } location
                    ? GeoTimeZone
                        .TimeZoneLookup.GetTimeZone(location.Latitude, location.Longitude)
                        .Result
                    : null
            );
            places[personPlaceId]["userId"] = person.Id.ToString("D");
        }
        foreach (var a in data.Activities)
        {
            if (a.Geometry is not null)
            {
                AddPlace(
                    PlaceId($"activity:{a.Id:D}"),
                    a.Properties.PlaceName ?? a.Properties.Name,
                    a.Geometry.Position.Longitude,
                    a.Geometry.Position.Latitude
                );
            }
        }
        var updated = data
            .Activities.Select(a => a.UpdatedAt)
            .Concat(data.People.Select(p => p.UpdatedAt))
            .Concat(data.Plans.Values.OfType<StoredActivityPlan>().Select(p => p.SavedAt))
            .Append(data.Trip.UpdatedAt)
            .Append(data.ModifiedAt)
            .Max()
            .ToUniversalTime();
        var schedule = new List<JsonObject>();
        var transportation = new List<JsonObject>();
        void Schedule(
            string id,
            string kind,
            DateTimeOffset start,
            TimeSpan? duration,
            string? zone
        )
        {
            if (zone is null || !TimeZoneInfo.TryFindSystemTimeZoneById(zone, out _))
            {
                return;
            }
            var timing = new JsonObject
            {
                ["id"] = id,
                ["kind"] = kind,
                ["start"] = UtcDateTimeOffsetConverter.Format(start),
                ["timeZone"] = zone,
            };
            if (duration is { } elapsed)
            {
                timing["duration"] = ElapsedDuration(elapsed);
            }
            schedule.Add(timing);
        }
        foreach (var place in data.Destinations)
        {
            string cityPrefix = $"{prefix}/destinations/{Uri.EscapeDataString(place.CityId)}";
            var feature =
                destinations.Find(place.CityId) ?? inactive.Single(p => p.Id == place.CityId);
            Add(cityPrefix, feature, contentType: "application/geo+json");
            foreach (var visit in feature.Properties.Stays)
            {
                Add($"{cityPrefix}/stays/{visit.Id:D}", visit);
                Add(
                    $"{cityPrefix}/stays/{visit.Id:D}/location",
                    data.Stays.GetValueOrDefault(visit.Id),
                    status: data.Stays.ContainsKey(visit.Id) ? 200 : 404,
                    contentType: "application/geo+json"
                );
            }
            var activities = data.Activities.Where(a => a.CityId == place.CityId).ToArray();
            Add(
                $"{cityPrefix}/activities",
                new GeoJsonCollection<ActivityProperties>(
                    "FeatureCollection",
                    activities.Select(a => a.ToFeature()).ToArray()
                ),
                context: place.ContextVersion,
                contentType: "application/geo+json"
            );
            foreach (var activity in activities)
            {
                Add(
                    $"{cityPrefix}/activities/{activity.Id:D}",
                    activity.ToFeature(),
                    $"\"{activity.UpdatedAt.UtcTicks}\"",
                    context: place.ContextVersion,
                    contentType: "application/geo+json"
                );
            }
            var preferences = data.DestinationPreferences[place.CityId];
            Add(
                $"{cityPrefix}/activity-preferences",
                preferences.Preferences,
                ActivityPlanRules.ETag(preferences.Version)
            );
            var context = new ActivityPlanningContext(
                data.Trip,
                place,
                data.Visits.Where(v => v.CityId == place.CityId).ToArray(),
                activities,
                data.Parties,
                data.People,
                new(data.PrivatePreferences),
                data.TripPreferences.Preferences,
                preferences.Preferences,
                data.Stays,
                data.Flights,
                data.Plans[place.CityId],
                data.Evidence[place.CityId],
                data.ContextRevision
            )
            {
                FlightChoices = choices,
            };
            context = context with { FlightLegs = availability.ReadLegs(context) };
            var response = planning.Response(context, updated);
            Add(
                $"{cityPrefix}/activity-plan",
                response,
                ActivityPlanRules.ETag(response.Version),
                context: response.ContextVersion
            );
            if (!response.TimingStale)
            {
                foreach (var timing in response.Assessment.Days.SelectMany(day => day.Entries))
                {
                    if (
                        response.Plan.SelectedActivityIds.Contains(timing.ActivityId)
                        && timing.Start is { } start
                        && timing.End is not null
                    )
                    {
                        Schedule(
                            timing.ActivityId.ToString("D"),
                            "activity",
                            start,
                            timing.Duration,
                            response.Plan.TimeZone
                        );
                    }
                }
            }
            foreach (var day in response.Assessment.Days)
            {
                foreach (var leg in day.Travel)
                {
                    var id = StableGuid(
                            $"{tripId}:travel:{day.StayId}:{day.Date}:{leg.FromActivityId}:{leg.ToActivityId}"
                        )
                        .ToString("D");
                    var item = Node(leg)!.AsObject();
                    item["id"] = id;
                    item["kind"] = "transfer";
                    item["visitId"] = day.StayId.ToString("D");
                    item["date"] = Node(day.Date);
                    transportation.Add(item);
                    if (!response.TimingStale && leg.Departure is { } departure)
                    {
                        Schedule(
                            id,
                            "transportation",
                            departure,
                            leg.Duration,
                            response.Plan.TimeZone
                        );
                    }
                }
            }
        }
        foreach (
            var reference in data
                .Transportation.SelectMany(t => t.Features)
                .Select(f => f.Properties.Reference)
                .OfType<TransportationReference>()
                .Where(r => r.Kind == "airport")
                .Distinct()
        )
        {
            var airport = airports.FindById(reference.Id);
            if (airport is null)
            {
                continue;
            }
            var airportId = PlaceId("airport:" + airport.Code);
            AddPlace(
                airportId,
                airport.Name,
                airport.Longitude,
                airport.Latitude,
                airport.TimeZone,
                "Airport"
            );
            places[airportId]["iataCode"] = airport.Code;
            places[airportId]["airportId"] = airport.Id.ToString("D");
            places[airportId]["address"] = new JsonObject { ["addressLocality"] = airport.City };
        }
        foreach (var choice in choices)
        {
            var selected = SavedFlightChoices
                .SelectedLegs(choice)
                .Select(l => (l.Leg, Index: (int?)l.LegIndex))
                .Concat(SavedFlightChoices.UnmatchedFlights(choice).Select(l => (l, (int?)null)));
            foreach (var (leg, index) in selected)
            {
                if (!leg.TryGetProperty("segments", out var segments))
                {
                    continue;
                }
                var key = FlightChoiceRoute.FlightKey(leg)!;
                var binding = choice.LegRoutes?.FirstOrDefault(r => r.Key == key);
                var fromVisit =
                    binding?.OriginVisitId
                    ?? (
                        index > 0 && index <= document.Visits.Length
                            ? document.Visits[index.Value - 1].Id
                            : (Guid?)null
                    );
                var toVisit =
                    binding?.DestinationVisitId
                    ?? (
                        index >= 0 && index < document.Visits.Length
                            ? document.Visits[index.Value].Id
                            : (Guid?)null
                    );
                var toPlace = toVisit is { } target
                    ? data.Visits.FirstOrDefault(v => v.StayId == target)?.CityId is { } city
                        ? PlaceId(city)
                        : null
                    : index == document.Visits.Length
                        ? homeId
                        : null;
                var purchased =
                    (
                        choiceDtos
                            .FirstOrDefault(c => c.PartyId == choice.PartyId)
                            ?.Bookings.Any(b =>
                                b.LegKeys.Contains(key)
                                && choice.PurchasedOfferIds.Contains(b.IgnavId)
                            ) == true
                    )
                    || data.Flights.Any(f =>
                        f.PartyId == choice.PartyId
                        && BookingLegs(f.Itinerary)
                            .Select((l, i) => (Key: FlightChoiceRoute.FlightKey(l), Index: i))
                            .Any(l =>
                                l.Key == key
                                && f.PurchasedLegs is { } flags
                                && l.Index < flags.Length
                                && flags[l.Index]
                            )
                    );
                foreach (var segment in segments.EnumerateArray())
                {
                    string Text(string name) =>
                        segment.TryGetProperty(name, out var value)
                        && value.ValueKind == JsonValueKind.String
                            ? value.GetString()!
                            : "";
                    var localDeparture = Text("departure_time_local");
                    var serviceDate =
                        localDeparture.Length >= 10 ? localDeparture[..10] : localDeparture;
                    var serviceId = Id(
                        StableGuid(
                            $"flight:{Text("marketing_carrier_code")}:{Text("flight_number")}:{Text("departure_airport")}:{Text("arrival_airport")}:{serviceDate}"
                        )
                    );
                    var service = new JsonObject
                    {
                        ["@id"] = serviceId,
                        ["@type"] = "Flight",
                        ["flightNumber"] = Text("flight_number"),
                    };
                    foreach (var direction in new[] { "departure", "arrival" })
                    {
                        var code = Text(direction + "_airport");
                        var airportId = PlaceId("airport:" + code);
                        var airport = airports.FindByCode(code);
                        AddPlace(
                            airportId,
                            airport?.Name ?? code,
                            airport?.Longitude,
                            airport?.Latitude,
                            airport?.TimeZone,
                            "Airport"
                        );
                        places[airportId]["iataCode"] = code;
                        places[airportId]["airportId"] = airport?.Id.ToString("D");
                        places[airportId]["address"] = new JsonObject
                        {
                            ["addressLocality"] = airports.CityName(code),
                        };
                        service[direction + "Airport"] = Reference(airportId);
                        var time = Text(direction + "_time_local");
                        var utc = Text(direction + "_time_utc");
                        if (
                            DateTimeOffset.TryParse(
                                utc,
                                CultureInfo.InvariantCulture,
                                DateTimeStyles.AssumeUniversal,
                                out var knownInstant
                            )
                        )
                        {
                            service[direction + "Time"] = UtcDateTimeOffsetConverter.Format(
                                knownInstant
                            );
                        }
                        else if (
                            DateTime.TryParse(
                                time,
                                CultureInfo.InvariantCulture,
                                DateTimeStyles.None,
                                out var local
                            )
                            && airport is not null
                            && TimeZoneInfo.TryFindSystemTimeZoneById(
                                airport.TimeZone,
                                out var zone
                            )
                            && !zone.IsInvalidTime(local)
                            && !zone.IsAmbiguousTime(local)
                        )
                        {
                            service[direction + "Time"] = UtcDateTimeOffsetConverter.Format(
                                new DateTimeOffset(
                                    DateTime.SpecifyKind(local, DateTimeKind.Unspecified),
                                    zone.GetUtcOffset(local)
                                )
                            );
                        }
                        service["tp:" + direction + "LocalTime"] = time;
                    }
                    var selectionId = StableGuid($"{tripId}:selection:{choice.PartyId}:{serviceId}")
                        .ToString("D");
                    var flight = new JsonObject
                    {
                        ["id"] = selectionId,
                        ["kind"] = "flight",
                        ["serviceId"] = serviceId,
                        ["flightNumber"] = Text("flight_number"),
                        ["originVisitId"] =
                            fromVisit is { } ov && data.Visits.Any(v => v.StayId == ov)
                                ? ov.ToString("D")
                                : null,
                        ["destinationVisitId"] =
                            toVisit is { } dv && data.Visits.Any(v => v.StayId == dv)
                                ? dv.ToString("D")
                                : null,
                        ["destinationPlaceId"] = toPlace,
                        ["unassigned"] = index is null,
                        ["purchased"] = purchased,
                        ["departurePlaceId"] = service["departureAirport"]!["@id"]!.DeepClone(),
                        ["arrivalPlaceId"] = service["arrivalAirport"]!["@id"]!.DeepClone(),
                        ["departureLocalTime"] = service["tp:departureLocalTime"]?.DeepClone(),
                        ["arrivalLocalTime"] = service["tp:arrivalLocalTime"]?.DeepClone(),
                    };
                    foreach (var name in new[] { "departureTime", "arrivalTime" })
                    {
                        if (service[name] is { } instant)
                        {
                            flight[name] = instant.DeepClone();
                        }
                    }
                    transportation.Add(flight);
                    if (
                        service["departureTime"] is { } departureNode
                        && service["arrivalTime"] is { } arrivalNode
                        && DateTimeOffset.TryParse(
                            departureNode.GetValue<string>(),
                            out var departure
                        )
                        && DateTimeOffset.TryParse(arrivalNode.GetValue<string>(), out var arrival)
                        && arrival >= departure
                    )
                    {
                        Schedule(
                            selectionId,
                            "transportation",
                            departure,
                            arrival - departure,
                            airports.FindByCode(Text("departure_airport"))?.TimeZone
                        );
                    }
                }
            }
        }
        foreach (var connection in data.Transportation.OrderBy(c => c.Id))
        {
            var duration = connection.Duration;
            if (
                connection.DepartureDate is { } date
                && connection.DepartureTime is { } time
                && connection.TimeZone is { } zoneId
                && TimeZoneInfo.TryFindSystemTimeZoneById(zoneId, out var zone)
            )
            {
                var local = date.ToDateTime(time, DateTimeKind.Unspecified);
                if (!zone.IsInvalidTime(local) && !zone.IsAmbiguousTime(local))
                {
                    Schedule(
                        connection.Id.ToString("D"),
                        "transportation",
                        new DateTimeOffset(local, zone.GetUtcOffset(local)),
                        duration,
                        zoneId
                    );
                }
            }
        }
        // Revision tracks domain inputs, independently of REST addresses and response metadata.
        var revision = ETag(data).Trim('"');
        var file = TripDocumentProjection.Project(
            data,
            resources,
            revision,
            places.Values.ToArray(),
            transportation.ToArray(),
            new JsonArray(
                schedule
                    .OrderBy(e => e["id"]!.GetValue<string>(), StringComparer.Ordinal)
                    .Select(e => (JsonNode?)e)
                    .ToArray()
            )
        );
        return new(file, resources);
    }

    private static string ElapsedDuration(TimeSpan duration)
    {
        var hours = duration.Ticks / TimeSpan.TicksPerHour;
        var minutes = duration.Minutes;
        var seconds = (duration.Ticks % TimeSpan.TicksPerMinute) / (decimal)TimeSpan.TicksPerSecond;
        var text = new StringBuilder("PT");
        if (hours != 0)
        {
            text.Append(hours.ToString(CultureInfo.InvariantCulture)).Append('H');
        }

        if (minutes != 0)
        {
            text.Append(minutes.ToString(CultureInfo.InvariantCulture)).Append('M');
        }

        if (seconds != 0 || text.Length == 2)
        {
            text.Append(seconds.ToString("0.#######", CultureInfo.InvariantCulture)).Append('S');
        }

        return text.ToString();
    }

    private static IEnumerable<JsonElement> BookingLegs(JsonElement itinerary)
    {
        if (itinerary.ValueKind != JsonValueKind.Object)
        {
            yield break;
        }

        if (itinerary.TryGetProperty("legs", out var legs) && legs.ValueKind == JsonValueKind.Array)
        {
            foreach (var leg in legs.EnumerateArray())
            {
                yield return leg;
            }

            yield break;
        }
        foreach (var name in new[] { "outbound", "inbound" })
        {
            if (
                itinerary.TryGetProperty(name, out var leg)
                && leg.ValueKind == JsonValueKind.Object
            )
            {
                yield return leg;
            }
        }
    }
}
