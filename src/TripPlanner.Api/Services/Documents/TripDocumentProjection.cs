using System.Text.Json;
using System.Text.Json.Nodes;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services.Documents;

// Pure projection of a consistent read and public resource definitions into the file.
// Validators are attached to stable domain entities and editable sections.
public static class TripDocumentProjection
{
    private static string Token(string headerValue) => headerValue[1..^1];

    private static JsonObject Copy(JsonNode node) => node.DeepClone().AsObject();

    private static JsonArray Array(IEnumerable<JsonObject> values) =>
        new(values.Select(v => (JsonNode?)v).ToArray());

    private static string Text(JsonNode? node) => node?.GetValue<string>() ?? "";

    private static JsonNode? Clone(JsonNode? node) => node?.DeepClone();

    public static TripDocument Project(
        TripReadData data,
        IReadOnlyDictionary<string, TripResource> resources,
        string revision,
        JsonObject[] placeDefinitions,
        JsonObject[] transportation,
        JsonArray schedule
    )
    {
        var tripId = data.Trip.Id.ToString("D");
        var prefix = $"/trips/{tripId}";
        JsonNode? Resource(string path) =>
            resources.TryGetValue(prefix + path, out var resource)
                ? JsonNode.Parse(resource.Data.GetRawText())
                : null;
        JsonObject Validator(string path)
        {
            var resource = resources[prefix + path];
            var value = new JsonObject { ["etag"] = Token(resource.Etag) };
            if (resource.ContextVersion is not null)
            {
                value["contextVersion"] = resource.ContextVersion;
            }
            if (
                resource.Data.ValueKind == JsonValueKind.Object
                && resource.Data.TryGetProperty("version", out var version)
                && version.ValueKind == JsonValueKind.Number
                && version.TryGetInt64(out var number)
            )
            {
                value["version"] = number;
            }
            return value;
        }
        void AddValidator(JsonObject value, string path, string? scope = null)
        {
            foreach (var (name, item) in Validator(path))
            {
                var property = scope is null
                    ? name
                    : scope + char.ToUpperInvariant(name[0]) + name[1..];
                value[property] = Clone(item);
            }
        }
        JsonObject WithValidator(JsonNode value, string path, string? scope = null)
        {
            var result = Copy(value);
            AddValidator(result, path, scope);
            return result;
        }
        var trip = Resource("")!.AsObject();
        var parties = Resource("/parties")!.AsArray();
        var people = data
            .People.Select(person => new JsonObject
            {
                ["id"] = person.Id.ToString("D"),
                ["name"] = person.DisplayName,
                ["role"] =
                    data.Parties.FirstOrDefault(g => g.UserIds.Contains(person.Id))
                        ?.RoleFor(person.Id)
                        .ToString()
                    ?? "Traveller",
                ["isOwner"] = person.Id == data.Trip.OwnerUserId,
                ["homeCityName"] = person.HomeCityName,
            })
            .ToArray();
        foreach (var person in people)
        {
            var path = $"/travellers/{Text(person["id"])}";
            if (resources.ContainsKey(prefix + path))
            {
                AddValidator(person, path);
            }
        }
        var places = placeDefinitions.Select(Copy).ToArray();
        var cities = Resource("/destinations?includeInactive=true")!["features"]!.AsArray();
        foreach (var feature in cities)
        {
            var id = Text(feature!["id"]);
            var place = places.Single(p =>
                Text(p["id"]) == TripResourceProjection.LocalId(Guid.Parse(tripId), "place", id)
            );
            var properties = feature["properties"]!;
            place["destinationId"] = id;
            place["countryCode"] = Clone(properties["countryCode"]);
            place["active"] = Clone(properties["isActive"]);
            var path = $"/destinations/{Uri.EscapeDataString(id)}";
            AddValidator(place, path);
            place["activitiesEtag"] = Token(resources[prefix + path + "/activities"].Etag);
            if (resources[prefix + path + "/activities"].ContextVersion is { } contextVersion)
            {
                place["contextVersion"] = contextVersion;
            }
            // Preserve the source coordinates exactly for GeoJSON editing adapters.
            place["location"] = Clone(feature["geometry"]);
        }
        var visits = new List<JsonObject>();
        foreach (var feature in cities)
        {
            foreach (var stay in feature!["properties"]!["stays"]!.AsArray())
            {
                var visit = Copy(stay!);
                visit["destinationId"] = Clone(feature["id"]);
                visit["accommodationPlaceId"] = stay!["stayLocation"] is null
                    ? null
                    : TripResourceProjection.LocalId(
                        Guid.Parse(tripId),
                        "place",
                        "stay:" + Text(stay["id"])
                    );
                var path =
                    $"/destinations/{Uri.EscapeDataString(Text(feature["id"]))}/stays/{Text(stay["id"])}";
                AddValidator(visit, path);
                AddValidator(visit, path + "/location", "accommodation");
                visit.Remove("stayLocation");
                visit.Remove("arrivalAt");
                visit.Remove("departureAt");
                visits.Add(visit);
            }
        }
        // Explicit route order remains authoritative when dates overlap.
        visits = visits.OrderBy(v => v["order"]!.GetValue<int>()).ToList();

        var activities = new List<JsonObject>();
        var destinationPreferences = new List<JsonObject>();
        var days = new List<JsonObject>();
        foreach (var feature in cities)
        {
            var city = Text(feature!["id"]);
            var path = $"/destinations/{Uri.EscapeDataString(city)}";
            var response = Resource(path + "/activity-plan")!;
            var plan = WithValidator(response["plan"]!, path + "/activity-plan");
            var selected = plan["selectedActivityIds"]!.AsArray().Select(Text).ToHashSet();
            var excluded = plan["excludedActivityIds"]!.AsArray().Select(Text).ToHashSet();
            foreach (var activity in Resource(path + "/activities")!["features"]!.AsArray())
            {
                var id = Text(activity!["id"]);
                var value = Copy(activity["properties"]!);
                value["id"] = id;
                value["destinationId"] = city;
                value["placeId"] = activity["geometry"] is null
                    ? null
                    : TripResourceProjection.LocalId(Guid.Parse(tripId), "place", "activity:" + id);
                value["selection"] =
                    selected.Contains(id) ? "Selected"
                    : excluded.Contains(id) ? "Excluded"
                    : "Unassigned";
                value["rule"] = Clone(
                    plan["rules"]!.AsArray().FirstOrDefault(r => Text(r?["activityId"]) == id)
                );
                AddValidator(value, path + "/activities/" + id);
                activities.Add(value);
            }
            foreach (var day in plan["days"]!.AsArray())
            {
                var value = Copy(day!);
                value["destinationId"] = city;
                days.Add(value);
            }
            foreach (
                var name in new[] { "selectedActivityIds", "excludedActivityIds", "rules", "days" }
            )
            {
                plan.Remove(name);
            }
            destinationPreferences.Add(
                new JsonObject
                {
                    ["destinationId"] = city,
                    ["constraints"] = Clone(feature["properties"]!["constraints"]),
                    ["activities"] = WithValidator(
                        Resource(path + "/activity-preferences")!,
                        path + "/activity-preferences"
                    ),
                    ["schedule"] = plan,
                }
            );
        }
        var legs = transportation.Select(Copy).ToList();
        var connections = Resource("/travel")!["connections"]!.AsArray();
        foreach (var connection in connections)
        {
            var leg = Copy(connection!);
            leg["kind"] = "connection";
            legs.Add(leg);
        }
        var choices = Resource("/flights/choices")!.AsArray();
        var journeys = new List<JsonObject>();
        var flightChoices = new List<JsonObject>();
        foreach (var choice in choices)
        {
            var input = Copy(choice!);
            var group = Text(input["partyId"]);
            input["groupId"] = group;
            input.Remove("partyId");
            foreach (var flight in input["flights"]!.AsArray())
            {
                journeys.Add(
                    new JsonObject
                    {
                        ["groupId"] = group,
                        ["legIndex"] = Clone(flight!["legIndex"]),
                        ["details"] = Clone(flight["leg"]),
                    }
                );
            }
            foreach (var flight in input["unmatchedFlights"]!.AsArray())
            {
                journeys.Add(
                    new JsonObject
                    {
                        ["groupId"] = group,
                        ["legIndex"] = null,
                        ["details"] = Clone(flight),
                    }
                );
            }
            input.Remove("flights");
            input.Remove("unmatchedFlights");
            flightChoices.Add(input);
        }
        var groups = parties.Select(p =>
        {
            var value = Copy(p!);
            value["personIds"] = new JsonArray(
                value["members"]!.AsArray().Select(m => Clone(m!["id"])).ToArray()
            );
            value["memberEtags"] = new JsonObject(
                data.People.Select(person => new KeyValuePair<string, JsonNode?>(
                    person.Id.ToString("D"),
                    JsonValue.Create(
                        Token(
                            resources[
                                $"{prefix}/parties/{Text(p!["id"])}/members/{person.Id:D}"
                            ].Etag
                        )
                    )
                ))
            );
            AddValidator(value, $"/flights/choices/{Text(p!["id"])}", "flightChoices");
            AddValidator(value, $"/flights/{Text(p!["id"])}", "booking");
            value.Remove("members");
            return value;
        });
        return new TripDocument(
            Guid.Parse(tripId),
            data.Trip.Name,
            data.Trip.Description,
            revision,
            trip["createdAt"]!.GetValue<DateTimeOffset>(),
            trip["updatedAt"]!.GetValue<DateTimeOffset>(),
            TripResourceProjection.LocalId(data.Trip.Id, "place", "home"),
            people,
            places,
            activities.ToArray(),
            WithValidator(
                new JsonObject
                {
                    ["legs"] = Array(legs),
                    ["journeys"] = Array(journeys),
                    // Older saved provider bookings are retained for fare display and editing.
                    ["bookings"] = Resource("/flights"),
                },
                "/travel",
                "connections"
            ),
            new JsonObject
            {
                ["visits"] = Array(visits),
                ["days"] = Array(days),
                ["schedule"] = schedule.DeepClone(),
            },
            new JsonObject
            {
                ["constraints"] = Clone(trip["constraints"]),
                ["activities"] = WithValidator(
                    Resource("/activity-preferences")!,
                    "/activity-preferences"
                ),
                ["destinations"] = Array(destinationPreferences),
                ["groups"] = Array(groups),
                ["flightChoices"] = Array(flightChoices),
                ["flightPlanningEtag"] = Token(resources[prefix + "/flights/constraints"].Etag),
            }
        )
        {
            CanPlan = trip["canPlan"]!.GetValue<bool>(),
            Etag = Token(resources[prefix].Etag),
        };
    }
}
