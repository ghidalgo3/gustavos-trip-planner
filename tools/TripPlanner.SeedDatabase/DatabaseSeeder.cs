using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Transactions;
using Microsoft.Spatial;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.SeedDatabase;

public sealed record SeedResult(int Created, int Updated, int Skipped);

public sealed class DatabaseSeeder(IPlannerDb database)
{
    private sealed record City(
        string Id,
        string Name,
        string Country,
        string TimeZone,
        double Longitude,
        double Latitude
    );

    private static readonly City NewYork = new(
        "new-york-us",
        "New York",
        "US",
        "America/New_York",
        -74.0060,
        40.7128
    );
    private static readonly City Amsterdam = new(
        "amsterdam-nl",
        "Amsterdam",
        "NL",
        "Europe/Amsterdam",
        4.9041,
        52.3676
    );
    private static readonly City London = new(
        "london-gb",
        "London",
        "GB",
        "Europe/London",
        -0.1276,
        51.5072
    );
    private static readonly City Rome = new(
        "rome-it",
        "Rome",
        "IT",
        "Europe/Rome",
        12.4964,
        41.9028
    );
    private static readonly City Istanbul = new(
        "istanbul-tr",
        "Istanbul",
        "TR",
        "Europe/Istanbul",
        28.9784,
        41.0082
    );
    private static readonly City HongKong = new(
        "hong-kong-hk",
        "Hong Kong",
        "HK",
        "Asia/Hong_Kong",
        114.1694,
        22.3193
    );
    private static readonly City Seoul = new(
        "seoul-kr",
        "Seoul",
        "KR",
        "Asia/Seoul",
        126.9780,
        37.5665
    );
    private static readonly City Tokyo = new(
        "tokyo-jp",
        "Tokyo",
        "JP",
        "Asia/Tokyo",
        139.6917,
        35.6895
    );
    private static readonly City Sydney = new(
        "sydney-au",
        "Sydney",
        "AU",
        "Australia/Sydney",
        151.2093,
        -33.8688
    );
    private static readonly City Honolulu = new(
        "honolulu-us",
        "Honolulu",
        "US",
        "Pacific/Honolulu",
        -157.8583,
        21.3069
    );
    private static readonly City LosAngeles = new(
        "los-angeles-us",
        "Los Angeles",
        "US",
        "America/Los_Angeles",
        -118.2437,
        34.0522
    );
    private static readonly City Chicago = new(
        "chicago-us",
        "Chicago",
        "US",
        "America/Chicago",
        -87.6298,
        41.8781
    );

    private static readonly (string Name, City[] Cities, bool IncludeActivities)[] Templates =
    [
        ("Trip Small", [NewYork], false),
        ("Trip Medium", [Amsterdam, London], false),
        (
            "Trip Large",
            [
                NewYork,
                London,
                Rome,
                Istanbul,
                HongKong,
                Seoul,
                Tokyo,
                Sydney,
                Honolulu,
                LosAngeles,
                Chicago,
            ],
            true
        ),
    ];

    public async Task<User> FindOwnerAsync(
        string? email,
        CancellationToken cancellationToken = default
    )
    {
        if (email is not null)
        {
            return await database.GetUserByEmailAsync(
                    email.Trim().ToLowerInvariant(),
                    cancellationToken
                )
                ?? throw new InvalidOperationException(
                    "No matching user; sign in locally first and check the supplied email."
                );
        }

        var users = await database.SearchUsersAsync(Guid.Empty, "", cancellationToken);
        if (users.Count != 1)
        {
            throw new InvalidOperationException(
                users.Count == 0
                    ? "No users exist; start scripts/server and sign in locally first."
                    : "Multiple users exist; run scripts/seed_database USER_EMAIL to select the owner."
            );
        }
        return await database.GetUserAsync(users[0].Id, cancellationToken)
            ?? throw new InvalidOperationException("The selected user no longer exists.");
    }

    private sealed record SeedTrip(
        string Name,
        City[] Cities,
        bool IncludeActivities,
        Trip? Existing,
        IReadOnlyList<DestinationVisit> Visits
    )
    {
        public int DurationDays => (Visits.Count == 0 ? Cities.Length : Visits.Count) * 3;
    }

    public async Task<SeedResult> SeedAsync(
        Guid ownerId,
        int count,
        DateOnly today,
        Action<int>? progress = null,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(count, 3);
        var existing = (await database.GetTripsAsync(ownerId, cancellationToken))
            .Where(trip => trip.OwnerUserId == ownerId)
            .ToLookup(trip => trip.Name, StringComparer.Ordinal);
        var seeds = new List<SeedTrip>();
        for (int index = 0; index < count; index++)
        {
            var template = Templates[index % Templates.Length];
            string name =
                index < Templates.Length
                    ? template.Name
                    : string.Create(
                        CultureInfo.InvariantCulture,
                        $"{template.Name} {index + 1:0000}"
                    );
            var trip = existing[name].SingleOrDefault();
            var visits = trip is null
                ? []
                : await database.GetDestinationVisitsAsync(ownerId, trip.Id, cancellationToken);
            seeds.Add(
                new(
                    name,
                    template.Cities,
                    template.IncludeActivities,
                    trip,
                    visits.OrderBy(visit => visit.Order).ToArray()
                )
            );
        }

        var cursor = today.AddDays(1);
        var schedule = new List<(SeedTrip Trip, DateOnly Start)>();
        foreach (var seed in seeds)
        {
            var end = cursor.AddDays(seed.DurationDays);
            if (cursor.Year < 2000 || end.Year > 2100)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(count),
                    "The seed schedule must fit within the application's supported dates, 2000–2100."
                );
            }
            schedule.Add((seed, cursor));
            cursor = end.AddDays(1);
        }

        int created = 0;
        int updated = 0;
        int skipped = 0;
        foreach (var (seed, start) in schedule)
        {
            cancellationToken.ThrowIfCancellationRequested();
            bool needsDates =
                seed.Visits.Count == 0
                || seed.Visits.Where(
                        (visit, index) =>
                            visit.ArrivalDate != start.AddDays(index * 3)
                            || visit.DepartureDate != start.AddDays((index + 1) * 3)
                    )
                    .Any();
            if (seed.Existing is not null && !needsDates && !seed.IncludeActivities)
            {
                skipped++;
            }
            else
            {
                bool addedActivities = false;
                using (
                    var transaction = new TransactionScope(
                        TransactionScopeOption.Required,
                        new TransactionOptions
                        {
                            IsolationLevel = IsolationLevel.ReadCommitted,
                            Timeout = TimeSpan.FromMinutes(2),
                        },
                        TransactionScopeAsyncFlowOption.Enabled
                    )
                )
                {
                    var trip =
                        seed.Existing
                        ?? await database.CreateTripAsync(
                            ownerId,
                            seed.Name,
                            "",
                            cancellationToken
                        );
                    if (seed.Visits.Count == 0)
                    {
                        for (int index = 0; index < seed.Cities.Length; index++)
                        {
                            var city = seed.Cities[index];
                            await database.SaveDestinationPlaceAsync(
                                ownerId,
                                new(
                                    trip.Id,
                                    city.Id,
                                    city.Name,
                                    city.Country,
                                    city.TimeZone,
                                    city.Longitude,
                                    city.Latitude
                                ),
                                cancellationToken
                            );
                            _ =
                                await database.AddDestinationVisitAsync(
                                    ownerId,
                                    new(
                                        trip.Id,
                                        city.Id,
                                        Guid.NewGuid(),
                                        index,
                                        start.AddDays(index * 3),
                                        start.AddDays((index + 1) * 3)
                                    ),
                                    cancellationToken
                                )
                                ?? throw new InvalidOperationException(
                                    $"Could not add {city.Name} to {seed.Name}."
                                );
                        }
                    }
                    else if (needsDates)
                    {
                        // Clear old ranges inside this transaction first; otherwise a
                        // moved visit can temporarily overlap a neighbour's old dates.
                        foreach (
                            var visit in seed.Visits.Where(visit =>
                                visit.ArrivalDate is not null || visit.DepartureDate is not null
                            )
                        )
                        {
                            await ReplaceDatesAsync(
                                ownerId,
                                visit,
                                new(null, null),
                                cancellationToken
                            );
                        }
                        for (int index = 0; index < seed.Visits.Count; index++)
                        {
                            await ReplaceDatesAsync(
                                ownerId,
                                seed.Visits[index],
                                new(start.AddDays(index * 3), start.AddDays((index + 1) * 3)),
                                cancellationToken
                            );
                        }
                    }
                    if (seed.IncludeActivities)
                    {
                        var cityIds =
                            seed.Visits.Count == 0
                                ? seed.Cities.Select(city => city.Id)
                                : seed.Visits.Select(visit => visit.CityId);
                        addedActivities = await SeedActivitiesAsync(
                            ownerId,
                            trip.Id,
                            cityIds.ToHashSet(StringComparer.Ordinal),
                            cancellationToken
                        );
                    }
                    transaction.Complete();
                }
                if (seed.Existing is null)
                {
                    created++;
                }
                else if (needsDates || addedActivities)
                {
                    updated++;
                }
                else
                {
                    skipped++;
                }
            }
            progress?.Invoke(created + updated + skipped);
        }
        return new(created, updated, skipped);
    }

    private async Task<bool> SeedActivitiesAsync(
        Guid ownerId,
        Guid tripId,
        HashSet<string> visitedCities,
        CancellationToken cancellationToken
    )
    {
        bool addedActivities = false;
        var now = DateTimeOffset.UtcNow;
        var places = await database.GetDestinationPlacesAsync(ownerId, tripId, cancellationToken);
        foreach (var place in places.Where(place => visitedCities.Contains(place.CityId)))
        {
            var examples = SeedActivityCatalog.ForCity(place.CityId);
            if (examples.Count == 0)
            {
                continue;
            }

            var existing = await database.GetActivitiesAsync(
                ownerId,
                tripId,
                place.CityId,
                cancellationToken
            );
            var existingIds = existing.Select(activity => activity.Id).ToHashSet();
            var existingNames = existing
                .Select(activity => activity.Properties.Name.Trim())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var example in examples)
            {
                // Stable IDs let reruns recognize sample activities even after they're renamed.
                var hash = SHA256.HashData(
                    Encoding.UTF8.GetBytes(
                        $"TripPlanner seed activity:{tripId:D}:{place.CityId}:{example.Name}"
                    )
                );
                var id = new Guid(hash.AsSpan(0, 16));
                if (existingIds.Contains(id) || existingNames.Contains(example.Name))
                {
                    continue;
                }

                var activity = new Activity(
                    id,
                    tripId,
                    place.CityId,
                    new("Point", GeographyPoint.Create(example.Latitude, example.Longitude)),
                    new(
                        example.Name,
                        TimeSpan.FromMinutes(example.DurationMinutes),
                        example.Description,
                        null,
                        ActivityState.Maybe,
                        [example.Kind],
                        example.Name
                    ),
                    now,
                    now
                );
                var saved = await database.SaveActivityAsync(
                    ownerId,
                    activity,
                    place.ContextVersion,
                    null,
                    cancellationToken
                );
                if (saved is not null)
                {
                    addedActivities = true;
                }
                else if (
                    await database.GetActivityAsync(
                        ownerId,
                        tripId,
                        place.CityId,
                        id,
                        cancellationToken
                    )
                    is null
                )
                {
                    throw new InvalidOperationException(
                        $"Could not add {example.Name} to {place.Name}."
                    );
                }
            }
        }

        return addedActivities;
    }

    private async Task ReplaceDatesAsync(
        Guid ownerId,
        DestinationVisit visit,
        DestinationStayInput dates,
        CancellationToken cancellationToken
    )
    {
        _ =
            await database.ReplaceDestinationVisitAsync(
                ownerId,
                visit.TripId,
                visit.CityId,
                visit.StayId,
                dates,
                cancellationToken
            ) ?? throw new InvalidOperationException($"Could not date visit {visit.StayId}.");
    }
}
