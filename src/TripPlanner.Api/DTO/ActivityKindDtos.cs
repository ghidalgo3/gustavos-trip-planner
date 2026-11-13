using System.ComponentModel.DataAnnotations;

namespace TripPlanner.Api.DTO;

public sealed record ActivityKindQuery(
    [property: StringLength(200)] string? Search = null,
    [property: Range(1, 100)] int Top = 20,
    [property: Range(0, 100000)] int Skip = 0
);

public sealed record ActivityKindPage(IReadOnlyList<string> Kinds, bool HasMore);
