using System.Text.Json;

namespace TripPlanner.Api.DTO;

public sealed record CreateTripRequest(
    string Name,
    string? Description,
    JsonElement? Constraints = null
);

public sealed record UpdateTripRequest(
    string Name,
    string? Description,
    JsonElement? Constraints = null
);

public sealed record TripResponse(
    Guid Id,
    Guid OwnerUserId,
    string Name,
    string Description,
    JsonElement Constraints,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt
)
{
    public static TripResponse From(Models.Trip trip) =>
        new(
            trip.Id,
            trip.OwnerUserId,
            trip.Name,
            trip.Description,
            trip.Constraints,
            trip.CreatedAt,
            trip.UpdatedAt
        );
}
