using System.ComponentModel.DataAnnotations;

namespace TripPlanner.Api.DTO;

public sealed record ActivityPlaceSearchRequest(
    [property: Required, StringLength(200)] string Query
);
