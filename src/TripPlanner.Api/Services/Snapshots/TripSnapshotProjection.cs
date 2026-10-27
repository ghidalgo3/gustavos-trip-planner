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

namespace TripPlanner.Api.Services.Snapshots;

// Pure projection of a transactionally captured read model. No providers or persistence.
public sealed class TripSnapshotProjection(
    AirportCatalog airports,
    DestinationFlightPlanning flightPlanning,
    RouteFareComposer routes,
    ActivityFlightAvailability availability,
    ActivityPlanningService planning
)
{
    public const string Vocabulary = "https://ghidalgo3.github.io/gustavos-trip-planner/vocab#";
    public const string Extension = "ghidalgo3.github.io:";
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

    public TripSnapshotResponse Project(TripSnapshotData data)
    {
        var tripId = data.Trip.Id;
        var prefix = $"/trips/{tripId:D}";
        var resources = new SortedDictionary<string, SnapshotResource>(StringComparer.Ordinal);
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
                var legs = LegacyLegs(f.Itinerary).ToArray();
                var keys = legs.Select(FlightChoiceRoute.FlightKey).ToArray();
                return new FlightChoiceProgress(f.PartyId, keys, [])
                {
                    // Export older complete itineraries through one known service
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
                                    f.CacheKey + ":snapshot:" + index,
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
        Add(
            prefix,
            TripResponse.From(data.Trip, data.CanPlan),
            TripResponse.From(data.Trip, data.CanPlan).Etag
        );
        Add(
            $"{prefix}/travel",
            data.Travel,
            TripPlanner.Api.Endpoints.TripTravelEndpoints.ETag(data.Travel.Version)
        );
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
                ["@id"] = id,
                ["@type"] = type,
                ["name"] = name,
            };
            if (longitude is not null && latitude is not null)
            {
                place["geo"] = new JsonObject
                {
                    ["@type"] = "GeoCoordinates",
                    ["longitude"] = longitude,
                    ["latitude"] = latitude,
                };
            }
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
        foreach (var (visitId, stay) in data.Stays.OrderBy(p => p.Key))
        {
            AddPlace(
                PlaceId($"stay:{visitId:D}"),
                stay.Properties.Name,
                stay.Geometry?.Position.Longitude,
                stay.Geometry?.Position.Latitude
            );
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
        var people = data
            .People.Select(p => new JsonObject
            {
                ["@id"] = Id(p.Id),
                ["@type"] = "Person",
                ["name"] = p.DisplayName,
            })
            .ToArray();
        var travellers = data
            .People.Select(p => new JsonObject
            {
                ["person"] = Reference(Id(p.Id)),
                ["role"] =
                    p.Id == data.Trip.OwnerUserId
                        ? "Planner"
                        : data.Parties.FirstOrDefault(x => x.UserIds.Contains(p.Id))
                            ?.RoleFor(p.Id)
                            .ToString()
                            ?? "Traveller",
            })
            .ToArray();
        var updated = data
            .Activities.Select(a => a.UpdatedAt)
            .Concat(data.People.Select(p => p.UpdatedAt))
            .Concat(data.Plans.Values.OfType<StoredActivityPlan>().Select(p => p.SavedAt))
            .Append(data.Trip.UpdatedAt)
            .Append(data.ModifiedAt)
            .Max()
            .ToUniversalTime();
        var updatedText = UtcDateTimeOffsetConverter.Format(updated);
        var entries = new List<JsonObject>();
        var daySettings = new List<JsonNode?>();
        var destinationSettings = new List<JsonNode?>();
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
            destinationSettings.Add(
                new JsonObject
                {
                    ["destination"] = Reference(PlaceId(place.CityId)),
                    ["constraints"] = Node(place.Constraints),
                    ["preferences"] = Node(preferences.Preferences),
                    ["effectiveSettings"] = Node(response.Plan.Settings),
                    ["assessment"] = Node(response.Assessment),
                    ["savedAssessment"] = Node(response.SavedAssessment),
                    ["timingStale"] = response.TimingStale,
                }
            );
            foreach (var day in response.Plan.Days)
            {
                var dayNode = Node(day)!.AsObject();
                dayNode["visit"] = Reference(Id(day.StayId));
                dayNode["entries"] = new JsonArray(
                    day.ActivityIds.Select(id => (JsonNode?)Reference(Id(id))).ToArray()
                );
                dayNode.Remove("stayId");
                dayNode.Remove("activityIds");
                daySettings.Add(dayNode);
            }
            foreach (var activity in activities)
            {
                var timing = response
                    .Assessment.Days.SelectMany(d => d.Entries)
                    .FirstOrDefault(e => e.ActivityId == activity.Id);
                var selected = response.Plan.SelectedActivityIds.Contains(activity.Id);
                bool scheduled =
                    selected
                    && timing?.Start is not null
                    && timing.End is not null
                    && !response.TimingStale;
                var entry = new JsonObject
                {
                    ["@type"] = scheduled ? "Event" : "Task",
                    ["uid"] = activity.Id.ToString("D"),
                    ["updated"] = updatedText,
                    ["title"] = activity.Properties.Name,
                    ["description"] = activity.Properties.Description,
                    [Extension + "kind"] = "activity",
                    [Extension + "destinationId"] = PlaceId(place.CityId),
                    [Extension + "planningState"] =
                        response.Plan.ExcludedActivityIds.Contains(activity.Id) ? "Rejected"
                        : selected ? "Planned"
                        : activity.Properties.State.ToString(),
                    [Extension + "rules"] = Node(
                        response.Plan.Rules.FirstOrDefault(r => r.ActivityId == activity.Id)
                    ),
                    [Extension + "details"] = Node(activity.Properties),
                };
                if (activity.Geometry is not null)
                {
                    entry[Extension + "placeId"] = PlaceId($"activity:{activity.Id:D}");
                    entry["locations"] = new JsonObject
                    {
                        ["venue"] = new JsonObject
                        {
                            ["@type"] = "Location",
                            ["name"] = activity.Properties.PlaceName ?? activity.Properties.Name,
                            ["coordinates"] = FormattableString.Invariant(
                                $"geo:{activity.Geometry.Position.Latitude},{activity.Geometry.Position.Longitude}"
                            ),
                        },
                    };
                }
                if (scheduled)
                {
                    var zone = response.Plan.TimeZone;
                    if (
                        zone is not null
                        && TimeZoneInfo.TryFindSystemTimeZoneById(zone, out var tz)
                    )
                    {
                        entry["start"] = TimeZoneInfo
                            .ConvertTime(timing!.Start!.Value, tz)
                            .ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture);
                        entry["timeZone"] = zone;
                        entry["duration"] = ElapsedDuration(timing.Duration);
                        entry[Extension + "visitId"] = Id(timing.StayId);
                        entry[Extension + "resolvedStart"] = Node(
                            timing.Start.Value.ToUniversalTime()
                        );
                        entry[Extension + "resolvedEnd"] = Node(
                            timing.End!.Value.ToUniversalTime()
                        );
                        SetEventTiming(entry, timing.Start.Value, timing.Duration, zone);
                    }
                    else
                    {
                        entry["@type"] = "Task";
                    }
                }
                if (
                    entry["@type"]!.GetValue<string>() == "Task"
                    && activity.Properties.Duration is { } duration
                    && duration > TimeSpan.Zero
                )
                {
                    entry["estimatedDuration"] = ElapsedDuration(duration);
                }
                entries.Add(entry);
            }
            foreach (var day in response.Assessment.Days)
            {
                foreach (var leg in day.Travel)
                {
                    var uid = StableGuid(
                        $"{tripId}:travel:{day.StayId}:{day.Date}:{leg.FromActivityId}:{leg.ToActivityId}"
                    );
                    var travel = new JsonObject
                    {
                        ["@type"] = "Task",
                        ["uid"] = uid.ToString("D"),
                        ["updated"] = updatedText,
                        ["title"] = "Travel",
                        ["estimatedDuration"] = ElapsedDuration(leg.Duration),
                        [Extension + "kind"] = "travel",
                        [Extension + "visitId"] = Id(day.StayId),
                        [Extension + "destinationId"] = PlaceId(place.CityId),
                        [Extension + "travel"] = Node(leg),
                        [Extension + "mode"] = NormalizeMode(leg.Mode),
                        [Extension + "modeSelectedBy"] = response.Plan.TransportOverrides.Any(o =>
                            o.Date == day.Date
                            && o.FromActivityId == leg.FromActivityId
                            && o.ToActivityId == leg.ToActivityId
                        )
                            ? "user"
                            : "server",
                        [Extension + "fromPlaceId"] = leg.FromActivityId is { } from
                            ? places.ContainsKey(PlaceId($"activity:{from:D}"))
                                ? PlaceId($"activity:{from:D}")
                                : null
                            : data.Stays.ContainsKey(day.StayId)
                                ? PlaceId($"stay:{day.StayId:D}")
                                : null,
                        [Extension + "toPlaceId"] = leg.ToActivityId is { } to
                            ? places.ContainsKey(PlaceId($"activity:{to:D}"))
                                ? PlaceId($"activity:{to:D}")
                                : null
                            : data.Stays.ContainsKey(day.StayId)
                                ? PlaceId($"stay:{day.StayId:D}")
                                : null,
                    };
                    if (leg.Duration <= TimeSpan.Zero)
                    {
                        travel.Remove("estimatedDuration");
                    }

                    travel[Extension + "planningDate"] = Node(day.Date);
                    AddTravelLocations(
                        travel,
                        travel[Extension + "fromPlaceId"]?.GetValue<string>(),
                        travel[Extension + "toPlaceId"]?.GetValue<string>(),
                        places
                    );
                    if (
                        leg.Departure is { } departure
                        && !response.TimingStale
                        && response.Plan.TimeZone is { } zone
                        && TimeZoneInfo.TryFindSystemTimeZoneById(zone, out var tz)
                    )
                    {
                        travel["@type"] = "Event";
                        travel.Remove("estimatedDuration");
                        travel["start"] = TimeZoneInfo
                            .ConvertTime(departure, tz)
                            .ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture);
                        travel["timeZone"] = zone;
                        travel["duration"] = ElapsedDuration(leg.Duration);
                        SetEventTiming(travel, departure, leg.Duration, zone);
                    }
                    entries.Add(travel);
                }
            }
        }
        var services = new SortedDictionary<string, JsonObject>(StringComparer.Ordinal);
        var reservations = new SortedDictionary<string, JsonObject>(StringComparer.Ordinal);
        // A manually referenced service remains part of the trip even after its
        // flight selection is removed. Retain only its canonical public definition.
        foreach (var connection in data.Travel.Connections)
        {
            if (
                connection.ServiceId is { } serviceId
                && connection.ServiceDefinition is { } definition
            )
            {
                services[serviceId] = JsonNode.Parse(definition.GetRawText())!.AsObject();
            }
        }
        var referencedPlaces = data
            .Travel.Connections.SelectMany(c =>
                new[] { c.From.PlaceId, c.To.PlaceId }.Concat(
                    c.Segments.SelectMany(segment =>
                        new[] { segment.From.PlaceId, segment.To.PlaceId }
                    )
                )
            )
            .Concat(
                services.Values.SelectMany(service =>
                    new[]
                    {
                        service["departureAirport"]?["@id"]?.GetValue<string>(),
                        service["arrivalAirport"]?["@id"]?.GetValue<string>(),
                    }
                )
            );
        foreach (var placeId in referencedPlaces.OfType<string>().Distinct().ToArray())
        {
            var airportPrefix = PlaceId("airport:");
            if (
                !places.ContainsKey(placeId)
                && placeId.StartsWith(airportPrefix, StringComparison.Ordinal)
            )
            {
                var code = Uri.UnescapeDataString(placeId[airportPrefix.Length..]);
                var airport = airports.FindByCode(code);
                AddPlace(
                    placeId,
                    airport?.Name ?? code,
                    airport?.Longitude,
                    airport?.Latitude,
                    airport?.TimeZone,
                    "Airport"
                );
                places[placeId]["iataCode"] = code;
                places[placeId]["address"] = new JsonObject
                {
                    ["@type"] = "PostalAddress",
                    ["addressLocality"] = airports.CityName(code),
                };
            }
        }

        var flights = new List<JsonObject>();
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
                        && LegacyLegs(f.Itinerary)
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
                        places[airportId]["address"] = new JsonObject
                        {
                            ["@type"] = "PostalAddress",
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
                    services[serviceId] = service;
                    var selectionId = Id(
                        StableGuid($"{tripId}:selection:{choice.PartyId}:{serviceId}")
                    );
                    var selection = new JsonObject
                    {
                        ["@id"] = selectionId,
                        ["flight"] = Reference(serviceId),
                        ["destination"] = toPlace is null ? null : Reference(toPlace),
                        ["originVisit"] =
                            fromVisit is { } ov && data.Visits.Any(v => v.StayId == ov)
                                ? Reference(Id(ov))
                                : null,
                        ["destinationVisit"] =
                            toVisit is { } dv && data.Visits.Any(v => v.StayId == dv)
                                ? Reference(Id(dv))
                                : null,
                        ["unassigned"] = index is null,
                    };
                    if (purchased)
                    {
                        var reservationId = Id(StableGuid($"{selectionId}:reservation"));
                        reservations[reservationId] = new JsonObject
                        {
                            ["@id"] = reservationId,
                            ["@type"] = "FlightReservation",
                            ["reservationFor"] = Reference(serviceId),
                            ["reservationStatus"] = "https://schema.org/ReservationConfirmed",
                            ["tp:userReported"] = true,
                        };
                        selection["reservation"] = Reference(reservationId);
                    }
                    flights.Add(selection);
                    var flightEntry = new JsonObject
                    {
                        ["@type"] = "Task",
                        ["uid"] = StableGuid(selectionId + ":calendar").ToString("D"),
                        ["updated"] = updatedText,
                        ["title"] = "Flight " + Text("flight_number"),
                        [Extension + "kind"] = "travel",
                        [Extension + "mode"] = "flight",
                        [Extension + "modeSelectedBy"] = "user",
                        [Extension + "serviceId"] = serviceId,
                        [Extension + "selectionId"] = selectionId,
                        [Extension + "originVisitId"] = selection["originVisit"]
                            ?["@id"]?.DeepClone(),
                        [Extension + "destinationVisitId"] = selection["destinationVisit"]
                            ?["@id"]?.DeepClone(),
                        [Extension + "fromPlaceId"] = service["departureAirport"]![
                            "@id"
                        ]!.DeepClone(),
                        [Extension + "toPlaceId"] = service["arrivalAirport"]!["@id"]!.DeepClone(),
                    };
                    if (
                        service["departureTime"] is { } departureNode
                        && service["arrivalTime"] is { } arrivalNode
                        && DateTimeOffset.TryParse(
                            departureNode.GetValue<string>(),
                            out var departureInstant
                        )
                        && DateTimeOffset.TryParse(
                            arrivalNode.GetValue<string>(),
                            out var arrivalInstant
                        )
                        && arrivalInstant >= departureInstant
                        && airports.FindByCode(Text("departure_airport")) is { } departureAirport
                        && TimeZoneInfo.TryFindSystemTimeZoneById(
                            departureAirport.TimeZone,
                            out var departureZone
                        )
                    )
                    {
                        flightEntry["@type"] = "Event";
                        flightEntry["start"] = TimeZoneInfo
                            .ConvertTime(departureInstant, departureZone)
                            .ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture);
                        flightEntry["timeZone"] = departureAirport.TimeZone;
                        flightEntry["duration"] = ElapsedDuration(
                            arrivalInstant - departureInstant
                        );
                        flightEntry[Extension + "resolvedStart"] = Node(
                            departureInstant.ToUniversalTime()
                        );
                        flightEntry[Extension + "resolvedEnd"] = Node(
                            arrivalInstant.ToUniversalTime()
                        );
                        SetEventTiming(
                            flightEntry,
                            departureInstant,
                            arrivalInstant - departureInstant,
                            departureAirport.TimeZone
                        );
                    }
                    AddTravelLocations(
                        flightEntry,
                        service["departureAirport"]!["@id"]!.GetValue<string>(),
                        service["arrivalAirport"]!["@id"]!.GetValue<string>(),
                        places
                    );
                    entries.Add(flightEntry);
                }
            }
        }
        foreach (var connection in data.Travel.Connections.OrderBy(c => c.Id))
        {
            string? EndpointPlace(TripTravelEndpoint endpoint)
            {
                if (endpoint.PlaceId is not null && places.ContainsKey(endpoint.PlaceId))
                {
                    return endpoint.PlaceId;
                }

                if (
                    endpoint.ActivityId is { } activityId
                    && places.ContainsKey(PlaceId($"activity:{activityId:D}"))
                )
                {
                    return PlaceId($"activity:{activityId:D}");
                }

                if (
                    endpoint.VisitId is { } visitId
                    && data.Visits.FirstOrDefault(v => v.StayId == visitId) is { } visit
                )
                {
                    return data.Stays.ContainsKey(visitId)
                        ? PlaceId($"stay:{visitId:D}")
                        : PlaceId(visit.CityId);
                }

                return null;
            }
            var from = EndpointPlace(connection.From);
            var to = EndpointPlace(connection.To);
            var duration = connection.DurationOverride ?? connection.Estimate?.Duration;
            var entry = new JsonObject
            {
                ["@type"] = "Task",
                ["uid"] = connection.Id.ToString("D"),
                ["updated"] = updatedText,
                ["title"] = connection.Name,
                [Extension + "kind"] = "travel",
                [Extension + "mode"] = connection.Mode,
                [Extension + "modeSelectedBy"] = connection.ModeSelectedBy,
                [Extension + "from"] = Node(connection.From),
                [Extension + "to"] = Node(connection.To),
                [Extension + "segments"] = Node(connection.Segments),
                [Extension + "estimate"] = Node(connection.Estimate),
                [Extension + "durationOverride"] = Node(connection.DurationOverride),
                [Extension + "departureDate"] = Node(connection.DepartureDate),
                [Extension + "departureTime"] = Node(connection.DepartureTime),
                [Extension + "departureTimeZone"] = connection.TimeZone,
                [Extension + "serviceId"] = connection.ServiceId,
                [Extension + "fromPlaceId"] = from,
                [Extension + "toPlaceId"] = to,
            };
            var locations = new JsonObject();
            foreach (var (id, relative) in new[] { (from, "start"), (to, "end") })
            {
                if (id is not null)
                {
                    var location = new JsonObject
                    {
                        ["@type"] = "Location",
                        ["name"] = places[id]["name"]!.DeepClone(),
                        ["relativeTo"] = relative,
                    };
                    if (places[id]["timeZone"] is { } locationZone)
                    {
                        location["timeZone"] = locationZone.DeepClone();
                    }

                    locations[relative] = location;
                }
            }
            if (locations.Count > 0)
            {
                entry["locations"] = locations;
            }

            if (duration > TimeSpan.Zero)
            {
                entry["estimatedDuration"] = ElapsedDuration(duration.Value);
            }

            if (
                duration is not null
                && connection.DepartureDate is { } date
                && connection.DepartureTime is { } time
                && connection.TimeZone is { } zoneId
                && TimeZoneInfo.TryFindSystemTimeZoneById(zoneId, out var zone)
            )
            {
                var local = date.ToDateTime(time, DateTimeKind.Unspecified);
                if (!zone.IsInvalidTime(local) && !zone.IsAmbiguousTime(local))
                {
                    entry["@type"] = "Event";
                    entry.Remove("estimatedDuration");
                    entry["start"] = local.ToString(
                        "yyyy-MM-dd'T'HH:mm:ss",
                        CultureInfo.InvariantCulture
                    );
                    entry["timeZone"] = zoneId;
                    entry["duration"] = ElapsedDuration(duration.Value);
                    entry[Extension + "resolvedStart"] = Node(
                        new DateTimeOffset(local, zone.GetUtcOffset(local)).ToUniversalTime()
                    );
                    entry[Extension + "resolvedEnd"] = Node(
                        new DateTimeOffset(local, zone.GetUtcOffset(local))
                            .Add(duration.Value)
                            .ToUniversalTime()
                    );
                    SetEventTiming(
                        entry,
                        new DateTimeOffset(local, zone.GetUtcOffset(local)),
                        duration.Value,
                        zoneId
                    );
                }
            }
            AddTravelLocations(entry, from, to, places);
            entries.Add(entry);
        }
        var itinerary = new JsonObject
        {
            ["@type"] = "ItemList",
            ["itemListElement"] = new JsonArray(
                data.Visits.OrderBy(v => v.ArrivalDate ?? v.DepartureDate ?? DateOnly.MaxValue)
                    .ThenBy(v => v.Order)
                    .ThenBy(v => v.StayId)
                    .Select(
                        (v, i) =>
                            (JsonNode?)
                                new JsonObject
                                {
                                    ["@id"] = Id(v.StayId),
                                    ["@type"] = "ListItem",
                                    ["position"] = i + 1,
                                    ["item"] = Reference(PlaceId(v.CityId)),
                                    ["tp:arrivalDate"] = Node(v.ArrivalDate),
                                    ["tp:departureDate"] = Node(v.DepartureDate),
                                    ["tp:accommodation"] = data.Stays.ContainsKey(v.StayId)
                                        ? Reference(PlaceId($"stay:{v.StayId:D}"))
                                        : null,
                                }
                    )
                    .ToArray()
            ),
        };
        var revision = ETag(resources).Trim('"');
        var planUid = StableGuid($"{tripId}:calendar");
        return new(
            Context(),
            Id(tripId),
            data.Trip.Name,
            data.Trip.Description,
            revision,
            Reference(homeId),
            itinerary,
            places.Values.ToArray(),
            people,
            travellers,
            Reference(Id(data.Trip.OwnerUserId)),
            services.Values.ToArray(),
            flights.ToArray(),
            reservations.Values.ToArray(),
            new JsonObject
            {
                ["@type"] = "Group",
                ["uid"] = planUid.ToString("D"),
                ["updated"] = updatedText,
                ["title"] = data.Trip.Name,
                ["entries"] = new JsonArray(
                    entries
                        .OrderBy(e => e["uid"]!.GetValue<string>(), StringComparer.Ordinal)
                        .Select(e => (JsonNode?)e)
                        .ToArray()
                ),
            },
            new JsonObject
            {
                ["trip"] = new JsonObject
                {
                    ["constraints"] = Node(data.Trip.Constraints),
                    ["preferences"] = Node(data.TripPreferences.Preferences),
                    ["flightSettings"] = Node(document),
                },
                ["destinations"] = new JsonArray(destinationSettings.ToArray()),
                ["days"] = new JsonArray(daySettings.ToArray()),
                ["defaultsVersion"] = 1,
            },
            resources
        );
    }

    private static void AddTravelLocations(
        JsonObject entry,
        string? from,
        string? to,
        IReadOnlyDictionary<string, JsonObject> places
    )
    {
        var locations = new JsonObject();
        foreach (var (id, relative) in new[] { (from, "start"), (to, "end") })
        {
            if (id is null || !places.TryGetValue(id, out var place))
            {
                continue;
            }

            var location = new JsonObject
            {
                ["@type"] = "Location",
                ["name"] = place["name"]!.DeepClone(),
                ["relativeTo"] = relative,
            };
            if (place["timeZone"] is { } zone)
            {
                location["timeZone"] = zone.DeepClone();
            }

            if (place["geo"] is JsonObject geo)
            {
                location["coordinates"] = FormattableString.Invariant(
                    $"geo:{geo["latitude"]!.GetValue<double>()},{geo["longitude"]!.GetValue<double>()}"
                );
            }

            locations[relative] = location;
        }
        if (locations.Count > 0)
        {
            entry["locations"] = locations;
        }
    }

    public static string ElapsedDuration(TimeSpan duration)
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

    private static void SetEventTiming(
        JsonObject entry,
        DateTimeOffset start,
        TimeSpan duration,
        string zoneId
    )
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(zoneId);
        var local = TimeZoneInfo.ConvertTime(start, zone).DateTime;
        // Native JSCalendar resolves ambiguous local clocks to the earlier offset.
        // Use UTC for a known ambiguous instant so generic readers retain the instant.
        bool ambiguous = zone.IsAmbiguousTime(local);
        entry["start"] = (ambiguous ? start.UtcDateTime : local).ToString(
            "yyyy-MM-dd'T'HH:mm:ss",
            CultureInfo.InvariantCulture
        );
        entry["timeZone"] = ambiguous ? "Etc/UTC" : zoneId;
        entry["duration"] = ElapsedDuration(duration);
        entry[Extension + "displayTimeZone"] = zoneId;
        entry[Extension + "resolvedStart"] = Node(start.ToUniversalTime());
        entry[Extension + "resolvedEnd"] = Node(start.Add(duration).ToUniversalTime());
    }

    private static IEnumerable<JsonElement> LegacyLegs(JsonElement itinerary)
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

    public static string NormalizeMode(string mode) =>
        mode.ToLowerInvariant() switch
        {
            "walking" => "walk",
            "driving" => "car",
            "cycling" => "bike",
            _ => mode.ToLowerInvariant(),
        };

    private static JsonObject Context()
    {
        var context = new JsonObject
        {
            ["@version"] = 1.1,
            ["@vocab"] = "https://schema.org/",
            ["tp"] = Vocabulary,
        };
        foreach (var name in new[] { "plan", "planning", "resources" })
        {
            context[name] = new JsonObject { ["@id"] = "tp:" + name, ["@type"] = "@json" };
        }
        foreach (
            var name in new[]
            {
                "schemaVersion",
                "revision",
                "places",
                "people",
                "travellers",
                "person",
                "role",
                "services",
                "flights",
                "flight",
                "reservation",
                "reservations",
                "destination",
                "originVisit",
                "destinationVisit",
                "unassigned",
                "timeZone",
            }
        )
        {
            context[name] = "tp:" + name;
        }
        return context;
    }
}
