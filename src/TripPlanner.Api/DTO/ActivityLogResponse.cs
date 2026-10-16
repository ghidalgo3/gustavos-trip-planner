using TripPlanner.Api.Models;

namespace TripPlanner.Api.DTO;

public sealed record ActivityLogEntry(
    Guid Id,
    DateTimeOffset OccurredAt,
    Guid ActorUserId,
    string ActorName,
    string Source,
    string Action,
    Guid TripId,
    string TripName,
    string? ResourceId,
    string Description
)
{
    public static ActivityLogEntry From(TripMutation entry) =>
        new(
            entry.Id,
            entry.OccurredAt,
            entry.ActorUserId,
            entry.ActorName,
            entry.Source,
            entry.Action,
            entry.TripId,
            entry.TripName,
            entry.ResourceId,
            entry.Description
        );
}

public sealed record ActivityLogPage(IReadOnlyList<ActivityLogEntry> Entries, bool HasMore);
