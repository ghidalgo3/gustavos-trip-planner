namespace TripPlanner.Api.Models;

/// <summary>A planned trip.</summary>
public record Trip(
    Guid Id,
    string Destination,
    DateOnly StartDate,
    DateOnly EndDate,
    string? Notes
);

/// <summary>Payload for creating a new trip.</summary>
public record CreateTripRequest(
    string Destination,
    DateOnly StartDate,
    DateOnly EndDate,
    string? Notes
);
