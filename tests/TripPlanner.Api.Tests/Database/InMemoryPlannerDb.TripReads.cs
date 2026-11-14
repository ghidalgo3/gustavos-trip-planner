using TripPlanner.Api.Models;

namespace TripPlanner.Api.Tests.Database;

public sealed partial class InMemoryPlannerDb
{
    public async Task<TripReadData?> ReadTripDataAsync(
        Guid userId,
        Guid tripId,
        CancellationToken token
    )
    {
        var trip = await GetVisibleTripAsync(userId, tripId, token);
        if (trip is null)
        {
            return null;
        }
        var parties = (await GetPartiesAsync(userId, tripId, token)).ToArray();
        var people = new List<User>();
        var profiles = new Dictionary<Guid, ActivityPreferences>();
        foreach (
            var id in parties.SelectMany(p => p.UserIds).Append(trip.OwnerUserId).Distinct().Order()
        )
        {
            if (await GetUserAsync(id, token) is { } person)
            {
                people.Add(person);
                profiles[id] = (
                    await GetActivityPreferencesAsync(id, "profile", cancellationToken: token)
                ).Preferences;
            }
        }
        var destinations = (await GetDestinationPlacesAsync(userId, tripId, token))
            .OrderBy(p => p.CityId, StringComparer.Ordinal)
            .ToArray();
        var activities = new List<Activity>();
        var preferences = new Dictionary<string, StoredActivityPreferences>();
        var plans = new Dictionary<string, StoredActivityPlan?>();
        var evidence = new Dictionary<string, ActivityPlanningEvidence>();
        foreach (var place in destinations)
        {
            activities.AddRange(await GetActivitiesAsync(userId, tripId, place.CityId, token));
            preferences[place.CityId] = await GetActivityPreferencesAsync(
                tripId,
                "destination",
                place.CityId,
                token
            );
            plans[place.CityId] = await GetActivityPlanAsync(userId, tripId, place.CityId, token);
            evidence[place.CityId] = await GetActivityPlanningEvidenceAsync(
                userId,
                tripId,
                place.CityId,
                token
            );
        }
        var transportation = (await GetTransportationAsync(userId, tripId, token)).ToArray();
        return new TripReadData(
            trip,
            await GetTripAsync(userId, tripId, token) is not null,
            parties,
            people.ToArray(),
            destinations,
            (await GetDestinationVisitsAsync(userId, tripId, token))
                .OrderBy(v => v.Order)
                .ThenBy(v => v.StayId)
                .ToArray(),
            await GetStayLocationsAsync(userId, tripId, token),
            activities.OrderBy(a => a.Id).ToArray(),
            await GetActivityPreferencesAsync(tripId, "trip", cancellationToken: token),
            preferences,
            profiles,
            plans,
            evidence,
            (await GetSelectedFlightsAsync(userId, tripId, token))
                .OrderBy(f => f.PartyId)
                .ToArray(),
            (await GetFlightChoicesAsync(userId, tripId, token)).OrderBy(c => c.PartyId).ToArray(),
            await GetActivityPlanningRevisionAsync(userId, tripId, token),
            transportation,
            await GetTripModifiedAtAsync(userId, tripId, token)
        )
        {
            Hotels = (await GetHotelsAsync(userId, tripId, token)).ToArray(),
        };
    }
}
