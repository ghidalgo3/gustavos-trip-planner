using System.ComponentModel.DataAnnotations;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.DTO;

public sealed record TripFormRequest(
    Guid RequestId,
    [property: Required, StringLength(4000, MinimumLength = 1)] string Input,
    PlanningDocument Constraints
);
