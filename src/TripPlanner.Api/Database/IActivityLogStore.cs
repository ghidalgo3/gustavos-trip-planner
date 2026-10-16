using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public interface IActivityLogStore
{
    Task AppendAsync(TripMutation entry, CancellationToken cancellationToken);
    Task<IReadOnlyList<TripMutation>> ListAsync(
        Guid userId,
        int take,
        int skip,
        CancellationToken cancellationToken
    );
}
