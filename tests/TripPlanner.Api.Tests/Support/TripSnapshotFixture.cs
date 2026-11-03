using System.Text.Json;
using System.Text.Json.Nodes;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Services.Snapshots;

namespace TripPlanner.Api.Tests.Support;

internal static class TripSnapshotFixture
{
    public static TripSnapshotResponse Create(
        int schemaVersion,
        Guid tripId,
        string name,
        string description,
        JsonElement constraints
    )
    {
        var personId = TripSnapshotProjection.Id(Guid.NewGuid());
        var homeId = TripSnapshotProjection.LocalId(tripId, "place", "home");
        JsonObject Reference(string id) => TripSnapshotProjection.Reference(id);
        return new(
            new JsonObject
            {
                ["@vocab"] = "https://schema.org/",
                ["tp"] = TripSnapshotProjection.Vocabulary,
            },
            TripSnapshotProjection.Id(tripId),
            name,
            description,
            "local:1",
            Reference(homeId),
            new JsonObject { ["@type"] = "ItemList", ["itemListElement"] = new JsonArray() },
            [
                new JsonObject
                {
                    ["@id"] = homeId,
                    ["@type"] = "Place",
                    ["name"] = "Home",
                },
            ],
            [
                new JsonObject
                {
                    ["@id"] = personId,
                    ["@type"] = "Person",
                    ["name"] = "Me",
                },
            ],
            [new JsonObject { ["person"] = Reference(personId), ["role"] = "Planner" }],
            Reference(personId),
            [],
            [],
            [],
            new JsonObject
            {
                ["@type"] = "Group",
                ["uid"] = Guid.NewGuid().ToString(),
                ["updated"] = "2026-11-01T00:00:00Z",
                ["entries"] = new JsonArray(),
            },
            new JsonObject
            {
                ["trip"] = new JsonObject
                {
                    ["constraints"] = JsonNode.Parse(constraints.GetRawText()),
                },
                ["destinations"] = new JsonArray(),
                ["days"] = new JsonArray(),
                ["defaultsVersion"] = 1,
            },
            new Dictionary<string, SnapshotResource>()
        )
        {
            SchemaVersion = schemaVersion,
        };
    }
}
