using System.Text.Json;
using System.Text.Json.Nodes;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Flights;

namespace TripPlanner.Api.Tests.Support;

internal static class OperationFixture
{
    internal static JsonElement Response =>
        JsonSerializer.SerializeToElement(new { itineraries = Array.Empty<object>() });

    internal static JsonElement SampleItineraryResponse
    {
        get
        {
            var response = JsonNode.Parse(
                """
                {"itineraries":[{"ignav_id":"fare-1","price":{"amount":350,"currency":"USD"},
                "outbound":{"duration_minutes":600,"segments":[{"departure_airport":"BOS","arrival_airport":"CDG","departure_time_local":"2030-01-05T08:00:00","arrival_time_local":"2030-01-06T01:00:00"}]},
                "inbound":{"duration_minutes":420,"segments":[{"departure_airport":"CDG","arrival_airport":"BOS","departure_time_local":"2030-01-15T09:00:00","arrival_time_local":"2030-01-15T12:00:00"}]}}]}
                """
            )!;
            var alternative = response["itineraries"]![0]!.DeepClone();
            alternative["ignav_id"] = "fare-2";
            alternative["price"]!["amount"] = 450;
            response["itineraries"]!.AsArray().Add(alternative);
            return JsonSerializer.SerializeToElement(response);
        }
    }

    internal static IgnavFareRequest Query =>
        new("BOS", "CDG", new(2030, 1, 5), new(2030, 1, 14), 1, "economy", "US", null);

    internal static SearchPlanPreview Preview(Guid partyId, params IgnavFareRequest[] requests) =>
        new(
            true,
            20,
            [],
            [
                new(
                    partyId,
                    requests.Length,
                    requests
                        .Select(request => new PreparedSearch(
                            request,
                            SearchPlanBuilder.CacheKey(request),
                            0
                        ))
                        .ToArray(),
                    [],
                    []
                ),
            ]
        );

    internal static async Task<(User User, Trip Trip, Party Party)> Seed(IPlannerDb db)
    {
        var user = await db.GetOrCreateUserAsync(
            new("google", $"{Guid.NewGuid()}@example.com", "Ada")
        );
        var trip = await db.CreateTripAsync(user.Id, "Paris", "");
        return (user, trip, (await db.GetPartiesAsync(user.Id, trip.Id)).Single());
    }

    internal sealed class FakeIgnav(JsonElement? response = null, int transientFailures = 0)
        : IIgnavClient
    {
        public int Calls { get; private set; }

        public Task<JsonElement> SearchAsync(
            IgnavFareRequest request,
            CancellationToken cancellationToken
        )
        {
            Calls++;
            if (Calls <= transientFailures)
            {
                return Task.FromException<JsonElement>(
                    new HttpRequestException("Temporary provider failure")
                );
            }

            return Task.FromResult(response ?? Response);
        }

        public Task<JsonElement> GetBookingLinksAsync(
            string ignavId,
            CancellationToken cancellationToken
        ) => Task.FromResult(Response);
    }

    internal sealed class TestClock : TimeProvider
    {
        private DateTimeOffset _now = DateTimeOffset.UtcNow;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan time) => _now += time;
    }
}
