namespace TripPlanner.Api.Models;

// Components copied from the researched venue address, not inferred coordinates.
public sealed record StructuredAddress(
    string AddressLine,
    string? Locality = null,
    string? AdminDistrict = null,
    string? PostalCode = null
);

public enum AddressMatchConfidence
{
    High,
    Medium,
}

public sealed record AddressLocationCandidate(
    GeoJsonPoint Geometry,
    string FormattedAddress,
    AddressMatchConfidence Confidence,
    bool Ambiguous
)
{
    public bool PostalCodeMismatch { get; init; }
}
