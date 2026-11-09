using TripPlanner.Api.Models;

namespace TripPlanner.Api.DTO;

// Only the connected user's private preferences may cross the MCP boundary.
public sealed record PlanningContextResponse(
    string GuidanceVersion,
    string Guidance,
    string[] ActivityKinds,
    string[] PreferencePrecedence,
    TripDocument Trip,
    ActivityPreferences ProfilePreferences,
    ActivityPreferences TripPreferences,
    DestinationPlanningPreferences[] DestinationPreferences
);

public sealed record DestinationPlanningPreferences(
    string DestinationCity,
    ActivityPreferences Preferences
);
