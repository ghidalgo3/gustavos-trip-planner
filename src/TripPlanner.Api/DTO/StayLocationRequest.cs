using TripPlanner.Api.Models;

namespace TripPlanner.Api.DTO;

public sealed record StayLocationRequest(
    string Type,
    GeoJsonPoint? Geometry,
    StayLocationProperties? Properties
);
