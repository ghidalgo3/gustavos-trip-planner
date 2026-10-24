using System.Text.Json;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.DTO;

public sealed record FareValidationIssueDto(string Code, string Message, Guid[] ConstraintIds);

public sealed record FareEvaluationDto(string Status, IReadOnlyList<FareValidationIssueDto> Issues);

public sealed record EvaluatedFareSearchResultDto(
    Guid PartyId,
    string CacheKey,
    IgnavFareRequest Request,
    JsonElement Response,
    DateTimeOffset FetchedAt,
    DateTimeOffset ExpiresAt,
    IReadOnlyList<FareEvaluationDto> Evaluations
);

// A flight is provisional until it belongs to a composed, validated itinerary.
public sealed record FlightGridPriceDto(decimal Amount, string Currency);

public sealed record FlightGridOptionDto(
    int LegIndex,
    JsonElement Leg,
    FlightGridPriceDto Price,
    int BookingLegCount
);

// Indexes into response.flights; each connection is a fully validated round trip.
public sealed record FlightGridConnectionDto(int OutboundFlightIndex, int ReturnFlightIndex);

public sealed record FlightGridEdgeDto(int FromFlightIndex, int ToFlightIndex);

// The cost charged at this flight, with a bundled return charged at its outbound.
public sealed record FlightGridRouteCostDto(int FlightIndex, decimal Amount);

// Indexes into response.flightConnections. Each graph keeps one outbound fare's constraints, including its bundled return.
// Every edge belongs to a complete route; edges from separate graphs cannot be mixed.
public sealed record FlightGridRouteGraphDto(
    int[] ConnectionIndexes,
    string Currency,
    FlightGridRouteCostDto[] Costs
);
