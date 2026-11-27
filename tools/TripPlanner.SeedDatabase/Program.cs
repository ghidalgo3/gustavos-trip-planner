using System.Globalization;
using Microsoft.AspNetCore.Http;
using Npgsql;
using TripPlanner.Api.Database;

namespace TripPlanner.SeedDatabase;

internal static class Program
{
    public static async Task<int> Main(string[] args)
    {
        try
        {
            int count = 3;
            string? email = null;
            string? auditName = null;
            for (int index = 0; index < args.Length; index++)
            {
                if (args[index] == "--planning-audit")
                {
                    if (++index >= args.Length || string.IsNullOrWhiteSpace(args[index]))
                    {
                        throw new ArgumentException(
                            "--planning-audit requires a unique trip name."
                        );
                    }
                    auditName = args[index].Trim();
                }
                else if (args[index] == "--count")
                {
                    if (
                        ++index >= args.Length
                        || !int.TryParse(
                            args[index],
                            NumberStyles.None,
                            CultureInfo.InvariantCulture,
                            out count
                        )
                        || count < 3
                    )
                    {
                        throw new ArgumentException("--count must be an integer of at least 3.");
                    }
                }
                else if (
                    args[index].StartsWith('-')
                    || email is not null
                    || string.IsNullOrWhiteSpace(args[index])
                )
                {
                    throw new ArgumentException(
                        "Usage: scripts/seed_database [--count COUNT] [USER_EMAIL]"
                    );
                }
                else
                {
                    email = args[index];
                }
            }

            // Always target the local database exposed by compose.yaml.
            await using var source = NpgsqlDataSource.Create(
                "Host=localhost;Port=5432;Database=tripplanner;Username=tripplanner;Password=tripplanner;Search Path=gustavo_planner,public"
            );
            IPlannerDb database = AuditedPlannerDb.Create(
                new PostgresPlannerDb(source),
                new PostgresActivityLogStore(source),
                new HttpContextAccessor(),
                TimeProvider.System
            );
            var seeder = new DatabaseSeeder(database);
            var owner = await seeder.FindOwnerAsync(email);
            var today = DateOnly.FromDateTime(TimeProvider.System.GetLocalNow().DateTime);
            if (auditName is not null)
            {
                var auditTrip = await seeder.SeedPlanningAuditAsync(owner, auditName, today);
                Console.WriteLine(
                    $"Created planning audit trip {auditTrip.Name} ({auditTrip.Id:D})."
                );
                return 0;
            }
            Console.WriteLine($"Seeding {count:N0} trips in the local database...");
            var result = await seeder.SeedAsync(
                owner.Id,
                count,
                today,
                processed =>
                {
                    if (processed % 100 == 0)
                    {
                        Console.WriteLine($"Processed {processed:N0}/{count:N0} trips.");
                    }
                }
            );
            var trips = await database.GetTripsAsync(owner.Id);
            Console.WriteLine(
                $"Created {result.Created:N0} trips, updated {result.Updated:N0}, and skipped {result.Skipped:N0} unchanged trips. "
                    + $"Owner now has {trips.Count(trip => trip.OwnerUserId == owner.Id):N0} trips."
            );
            return 0;
        }
        catch (Exception exception)
            when (exception is ArgumentException or InvalidOperationException or NpgsqlException)
        {
            Console.Error.WriteLine($"error: {exception.Message}");
            return 1;
        }
    }
}
