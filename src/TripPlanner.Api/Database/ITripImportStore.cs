using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public sealed record TripImportResult(int Status, Trip? Trip = null);

public interface ITripImportStore
{
    Task<TripImportResult> ImportAsync(
        Guid ownerId,
        Guid transferId,
        TripSnapshotResponse request,
        CancellationToken cancellationToken
    );

    Task<TripImportResult> GetAsync(
        Guid ownerId,
        Guid transferId,
        CancellationToken cancellationToken
    );
}
