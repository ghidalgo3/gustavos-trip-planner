using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace TripPlanner.Api.DTO;

public sealed record CreateTripRequest(
    [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    [property: StringLength(4000)] string? Description,
    [property: JsonObjectValue] JsonElement? Constraints = null
);

public sealed record UpdateTripRequest(
    [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    [property: StringLength(4000)] string? Description,
    [property: JsonObjectValue] JsonElement? Constraints = null
);

public sealed record TripListQuery(
    [property: Range(0, int.MaxValue)] int Skip = 0,
    [property: StringLength(200)] string? Search = null,
    bool? Past = null,
    [property: DataType(DataType.Date)] DateOnly? Today = null
)
{
    public const int PageSize = 10;
}

public sealed record TripListPage(IReadOnlyList<TripResponse> Trips, bool HasMore);

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
    public bool CanPlan { get; init; }
    public DateOnly? StartDate { get; init; }
    public DateOnly? EndDate { get; init; }

    public string Etag =>
        TripPlanner.Api.Services.Documents.TripResourceProjection.ETag(
            new
            {
                Id,
                OwnerUserId,
                Name,
                Description,
                Constraints,
                CreatedAt,
                UpdatedAt,
                CanPlan,
            }
        );

    public static TripResponse From(Models.Trip trip, bool canPlan) =>
        new(
            trip.Id,
            trip.OwnerUserId,
            trip.Name,
            trip.Description,
            trip.Constraints,
            trip.CreatedAt,
            trip.UpdatedAt
        )
        {
            CanPlan = canPlan,
        };
}
