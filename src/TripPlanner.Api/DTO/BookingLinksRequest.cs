using System.ComponentModel.DataAnnotations;

namespace TripPlanner.Api.DTO;

public sealed record BookingLinksRequest(
    [property: Required, StringLength(4096, MinimumLength = 1)] string IgnavId
);
