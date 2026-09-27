using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public sealed partial class InMemoryPlannerDb
{
    private readonly Dictionary<(Guid TripId, Guid PartyId), SelectedFlight> _selectedFlights = [];

    public Task<IReadOnlyList<SelectedFlight>> GetSelectedFlightsAsync(
        Guid ownerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            IReadOnlyList<SelectedFlight> flights =
                _trips.TryGetValue(tripId, out var trip) && CanViewTrip(ownerUserId, trip)
                    ? _selectedFlights
                        .Values.Where(f => f.TripId == tripId)
                        .OrderBy(f => f.PartyId)
                        .ToArray()
                    : [];
            return Task.FromResult(flights);
        }
    }

    public Task<SelectedFlight> SetSelectedFlightAsync(
        Guid ownerUserId,
        SelectedFlight selectedFlight,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (
                !_trips.TryGetValue(selectedFlight.TripId, out var trip)
                || trip.OwnerUserId != ownerUserId
                || !_parties.TryGetValue(selectedFlight.PartyId, out var party)
                || party.TripId != trip.Id
            )
                throw new InvalidOperationException("The party does not belong to this trip.");
            var saved = selectedFlight with { Itinerary = selectedFlight.Itinerary.Clone() };
            _selectedFlights[(trip.Id, party.Id)] = saved;
            return Task.FromResult(saved);
        }
    }

    public Task DeleteSelectedFlightAsync(
        Guid ownerUserId,
        Guid tripId,
        Guid partyId,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (_trips.TryGetValue(tripId, out var trip) && trip.OwnerUserId == ownerUserId)
                _selectedFlights.Remove((tripId, partyId));
        }
        return Task.CompletedTask;
    }
}
