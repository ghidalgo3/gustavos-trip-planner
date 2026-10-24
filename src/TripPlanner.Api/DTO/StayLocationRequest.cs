using System.ComponentModel.DataAnnotations;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.DTO;

public sealed record StayLocationRequest(
    [property: AllowedValues("Feature")] string Type,
    [property: Required] GeoJsonPoint? Geometry,
    [property: Required] StayLocationProperties? Properties
);
