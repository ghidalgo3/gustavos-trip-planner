using System.Text.Json;
using System.Text.Json.Nodes;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Documents;

namespace TripPlanner.Api.Tests.Support;

internal static class TripDocumentFixture
{
    public static TripDocument Create(
        int schemaVersion,
        Guid tripId,
        string name,
        string description,
        JsonElement constraints
    )
    {
        var homeId = TripResourceProjection.LocalId(tripId, "place", "home");
        return new(
            tripId,
            name,
            description,
            "local:1",
            DateTimeOffset.Parse("2026-11-01T00:00:00Z"),
            DateTimeOffset.Parse("2026-11-01T00:00:00Z"),
            homeId,
            [
                new JsonObject
                {
                    ["id"] = Guid.NewGuid().ToString(),
                    ["name"] = "Me",
                    ["role"] = "Planner",
                    ["isOwner"] = true,
                    ["homeCityName"] = null,
                },
            ],
            [
                new JsonObject
                {
                    ["id"] = homeId,
                    ["type"] = "Place",
                    ["name"] = "Home",
                    ["location"] = null,
                },
            ],
            [],
            JsonNode.Parse("{\"legs\":[],\"journeys\":[],\"bookings\":[]}")!.AsObject(),
            JsonNode.Parse("{\"visits\":[],\"days\":[],\"schedule\":[]}")!.AsObject(),
            new JsonObject
            {
                ["constraints"] = JsonNode.Parse(constraints.GetRawText()),
                ["activities"] = new JsonObject { ["instructions"] = "", ["defaults"] = null },
                ["destinations"] = new JsonArray(),
                ["groups"] = new JsonArray(),
                ["flightChoices"] = new JsonArray(),
            }
        )
        {
            SchemaVersion = schemaVersion,
        };
    }

    public static async Task<User> Seed(
        TestApplicationFactory factory,
        HttpClient client,
        string email = "owner@example.com"
    )
    {
        var user = await factory.Database.GetOrCreateUserAsync(new("google", email, "Owner"));
        user = await factory.Database.SetUserProfileAsync(user.Id, new(new("Boston", -71, 42), []));
        client.DefaultRequestHeaders.Add("X-Test-Subject", email);
        client.DefaultRequestHeaders.Add("X-Test-Email", email);
        return user;
    }
}
