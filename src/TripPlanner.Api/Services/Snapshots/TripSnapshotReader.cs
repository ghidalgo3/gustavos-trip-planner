using TripPlanner.Api.Database;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services.Snapshots;

public sealed class TripSnapshotReader(IPlannerDb database, ITripDataSession sessions)
{
    public Task<TripSnapshotData?> ReadAsync(Guid userId, Guid tripId, CancellationToken token) =>
        sessions.ReadAsync(() => ReadDataAsync(userId, tripId, token), token);

    private static string LocalTimeZone(double latitude, double longitude)
    {
        var zone = GeoTimeZone.TimeZoneLookup.GetTimeZone(latitude, longitude).Result;
        return
            !zone.StartsWith("Etc/", StringComparison.Ordinal)
            && TimeZoneInfo.TryFindSystemTimeZoneById(zone, out _)
            ? zone
            : "";
    }

    // Called inside an existing write transaction when checking edit preconditions.
    public async Task<TripSnapshotData?> ReadDataAsync(
        Guid userId,
        Guid tripId,
        CancellationToken token
    )
    {
        var trip = await database.GetVisibleTripAsync(userId, tripId, token);
        if (trip is null)
        {
            return null;
        }
        var parties = (await database.GetPartiesAsync(userId, tripId, token)).ToArray();
        var people = new List<User>();
        var profiles = new Dictionary<Guid, ActivityPreferences>();
        foreach (
            var id in parties.SelectMany(p => p.UserIds).Append(trip.OwnerUserId).Distinct().Order()
        )
        {
            if (await database.GetUserAsync(id, token) is { } person)
            {
                people.Add(person);
                profiles[id] = (
                    await database.GetActivityPreferencesAsync(
                        id,
                        "profile",
                        cancellationToken: token
                    )
                ).Preferences;
            }
        }
        var destinations = (await database.GetDestinationPlacesAsync(userId, tripId, token))
            .Select(p =>
                string.IsNullOrWhiteSpace(p.TimeZone)
                    ? p with
                    {
                        TimeZone = LocalTimeZone(p.Latitude, p.Longitude),
                    }
                    : p
            )
            .OrderBy(p => p.CityId, StringComparer.Ordinal)
            .ToArray();
        var activities = new List<Activity>();
        var preferences = new Dictionary<string, StoredActivityPreferences>();
        var plans = new Dictionary<string, StoredActivityPlan?>();
        var evidence = new Dictionary<string, ActivityPlanningEvidence>();
        foreach (var place in destinations)
        {
            activities.AddRange(
                await database.GetActivitiesAsync(userId, tripId, place.CityId, token)
            );
            preferences[place.CityId] = await database.GetActivityPreferencesAsync(
                tripId,
                "destination",
                place.CityId,
                token
            );
            plans[place.CityId] = await database.GetActivityPlanAsync(
                userId,
                tripId,
                place.CityId,
                token
            );
            evidence[place.CityId] = await database.GetActivityPlanningEvidenceAsync(
                userId,
                tripId,
                place.CityId,
                token
            );
        }
        return new(
            trip,
            await database.GetTripAsync(userId, tripId, token) is not null,
            parties,
            people.ToArray(),
            destinations,
            (await database.GetDestinationVisitsAsync(userId, tripId, token))
                .OrderBy(v => v.Order)
                .ThenBy(v => v.StayId)
                .ToArray(),
            await database.GetStayLocationsAsync(userId, tripId, token),
            activities.OrderBy(a => a.Id).ToArray(),
            await database.GetActivityPreferencesAsync(tripId, "trip", cancellationToken: token),
            preferences,
            profiles,
            plans,
            evidence,
            (await database.GetSelectedFlightsAsync(userId, tripId, token))
                .OrderBy(f => f.PartyId)
                .ToArray(),
            (await database.GetFlightChoicesAsync(userId, tripId, token))
                .OrderBy(c => c.PartyId)
                .ToArray(),
            await database.GetActivityPlanningRevisionAsync(userId, tripId, token),
            await database.GetTripTravelAsync(userId, tripId, token),
            await database.GetTripSnapshotModifiedAtAsync(userId, tripId, token)
        );
    }
}
