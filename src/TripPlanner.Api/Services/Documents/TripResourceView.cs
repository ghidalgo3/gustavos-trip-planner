using System.Text.Json;
using System.Text.Json.Nodes;
using TripPlanner.Api.DTO;

namespace TripPlanner.Api.Services.Documents;

// Internal REST read representations and the single portable document contract.
public sealed record TripResource(
    string Href,
    string Etag,
    JsonElement Data,
    int Status = 200,
    string ContentType = "application/json",
    string? ContextVersion = null
);

public sealed record TripResourceView(
    TripDocument Document,
    IReadOnlyDictionary<string, TripResource> Resources,
    IReadOnlyDictionary<string, JsonObject> Services
);
