using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public sealed partial class InMemoryPlannerDb
{
    private readonly Dictionary<(Guid TripId, Guid PartyId), SelectedFlight> _selectedFlights = [];
    private readonly Dictionary<(Guid TripId, Guid PartyId), FlightChoiceProgress> _flightChoices =
    [];

    public Task<IReadOnlyList<FlightChoiceProgress>> GetFlightChoicesAsync(
        Guid viewerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
            return Task.FromResult<IReadOnlyList<FlightChoiceProgress>>(
                _trips.TryGetValue(tripId, out var trip) && CanViewTrip(viewerUserId, trip)
                    ? _flightChoices
                        .Where(entry => entry.Key.TripId == tripId)
                        .Select(entry => entry.Value)
                        .OrderBy(c => c.PartyId)
                        .ToArray()
                    : []
            );
    }

    public Task<FlightChoiceProgress> SetFlightChoicesAsync(
        Guid ownerUserId,
        Guid tripId,
        FlightChoiceProgress choices,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (
                !_trips.TryGetValue(tripId, out var trip)
                || !CanPlanTrip(ownerUserId, trip)
                || !_parties.TryGetValue(choices.PartyId, out var party)
                || party.TripId != tripId
            )
                throw new InvalidOperationException("The party does not belong to this trip.");
            var saved = choices with { LegKeys = [.. choices.LegKeys] };
            _flightChoices[(tripId, choices.PartyId)] = saved;
            return Task.FromResult(saved);
        }
    }

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
                || !CanPlanTrip(ownerUserId, trip)
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
            if (_trips.TryGetValue(tripId, out var trip) && CanPlanTrip(ownerUserId, trip))
                _selectedFlights.Remove((tripId, partyId));
        }
        return Task.CompletedTask;
    }
}
