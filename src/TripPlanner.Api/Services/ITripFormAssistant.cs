using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services;

public interface ITripFormAssistant
{
    Task<TripFormProposal> ProposeAsync(
        string input,
        PlanningDocument draft,
        User owner,
        IReadOnlyList<PlanningParty> parties,
        CancellationToken cancellationToken = default
    );
}

public sealed record TripFormProposal(PlanningDocument Document, string[] Warnings);
