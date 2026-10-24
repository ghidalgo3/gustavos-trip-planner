using System.ComponentModel.DataAnnotations;

namespace TripPlanner.Api.Models;

public sealed record StayLocationProperties(
    [property: Required, StringLength(200, MinimumLength = 1)] string Name
);
