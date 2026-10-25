using System.ComponentModel.DataAnnotations;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.DTO;

public sealed record ActivityRoutePreviewRequest(
    [property: Required] ActivityPlan Plan,
    [property: Required, StringLength(200)] string ContextVersion,
    [property: Required] Guid StayId,
    [property: SupportedDate] DateOnly Date,
    Guid? FromActivityId,
    Guid? ToActivityId
);

public sealed record ActivityRoutePath(
    [property: AllowedValues("MultiLineString")] string Type,
    [property: MinLength(1)] double[][][] Coordinates
);

public sealed record ActivityRoutePreviewResponse(
    [property: AllowedValues("walking", "driving", "taxi")] string Mode,
    ActivityRoutePath Geometry
);
