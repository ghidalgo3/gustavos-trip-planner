using TripPlanner.Api.DTO;

namespace TripPlanner.Api.Tests.Database;

public sealed partial class InMemoryPlannerDb
{
    public async Task<TripListPage> GetTripPageAsync(
        Guid viewerUserId,
        TripListQuery query,
        DateOnly today,
        CancellationToken cancellationToken = default
    )
    {
        var trips = new List<TripResponse>();
        foreach (var trip in await GetTripsAsync(viewerUserId, cancellationToken))
        {
            var visits = await GetDestinationVisitsAsync(viewerUserId, trip.Id, cancellationToken);
            var first = visits.MinBy(visit => visit.Order);
            var last = visits.MaxBy(visit => visit.Order);
            trips.Add(
                TripResponse.From(trip, CanPlanTrip(viewerUserId, trip)) with
                {
                    StartDate = first?.ArrivalDate ?? first?.DepartureDate,
                    EndDate = last?.DepartureDate ?? last?.ArrivalDate,
                }
            );
        }
        var page = trips
            .Where(trip =>
                trip.Name.Contains(query.Search?.Trim() ?? "", StringComparison.OrdinalIgnoreCase)
            )
            .Where(trip => query.Past is null || query.Past == (trip.EndDate < today))
            .OrderBy(trip =>
                trip.EndDate < today ? 2
                : (trip.StartDate ?? trip.EndDate) is null ? 1
                : 0
            )
            .ThenBy(trip =>
                trip.EndDate < today
                    ? today.DayNumber - trip.EndDate.Value.DayNumber
                    : Math.Max(
                        (trip.StartDate ?? trip.EndDate)?.DayNumber - today.DayNumber ?? 0,
                        0
                    )
            )
            .ThenBy(trip => trip.Name.ToLowerInvariant(), StringComparer.Ordinal)
            .ThenBy(trip => trip.Id)
            .Skip(query.Skip)
            .Take(TripListQuery.PageSize + 1)
            .ToArray();
        return new(
            page.Take(TripListQuery.PageSize).ToArray(),
            page.Length > TripListQuery.PageSize
        );
    }
}
