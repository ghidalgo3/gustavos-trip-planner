using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Snapshots;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class TripSnapshotEndpointTests
{
    [TestMethod]
    public async Task SnapshotContainsRepeatVisitsIndependentStaysAndTasksWithoutPrivateProfiles()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await Seed(factory, client);
        var trip = await factory.Database.CreateTripAsync(user.Id, "Japan", "Offline plan");
        var place = await factory.Database.SaveDestinationPlaceAsync(
            user.Id,
            new(trip.Id, "tokyo-jp", "Tokyo", "JP", "Asia/Tokyo", 139.76, 35.68)
        );
        var first = (
            await factory.Database.AddDestinationVisitAsync(
                user.Id,
                new(trip.Id, place.CityId, Guid.NewGuid(), 0, new(2030, 4, 1), new(2030, 4, 3))
            )
        )!;
        var second = (
            await factory.Database.AddDestinationVisitAsync(
                user.Id,
                new(trip.Id, place.CityId, Guid.NewGuid(), 1, new(2030, 4, 10), new(2030, 4, 12))
            )
        )!;
        await factory.Database.SaveStayLocationAsync(
            user.Id,
            trip.Id,
            place.CityId,
            first.StayId,
            new(
                "Feature",
                first.StayId.ToString(),
                new("Point", GeographyPoint.Create(35.68, 139.76)),
                new("First hotel")
            )
        );
        await factory.Database.SaveStayLocationAsync(
            user.Id,
            trip.Id,
            place.CityId,
            second.StayId,
            new(
                "Feature",
                second.StayId.ToString(),
                new("Point", GeographyPoint.Create(35.69, 139.77)),
                new("Second hotel")
            )
        );
        await factory.Database.SaveActivityPreferencesAsync(
            user.Id,
            null,
            "profile",
            "",
            new("PRIVATE-INSTRUCTIONS-DO-NOT-EXPORT"),
            0
        );
        var activity = new Activity(
            Guid.NewGuid(),
            trip.Id,
            place.CityId,
            null,
            new("Museum", TimeSpan.FromHours(2), "An idea", null, ActivityState.Proposed),
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow
        );
        var currentPlace = (
            await factory.Database.GetDestinationPlaceAsync(user.Id, trip.Id, place.CityId)
        )!;
        Assert.IsNotNull(
            await factory.Database.SaveActivityAsync(
                user.Id,
                activity,
                currentPlace.ContextVersion,
                null
            )
        );
        using var response = await client.GetAsync($"/trips/{trip.Id}/snapshot");
        Assert.AreEqual(
            HttpStatusCode.OK,
            response.StatusCode,
            await response.Content.ReadAsStringAsync()
        );
        Assert.AreEqual("application/ld+json", response.Content.Headers.ContentType!.MediaType);
        Assert.IsTrue(response.Headers.CacheControl!.Private);
        var text = await response.Content.ReadAsStringAsync();
        await File.WriteAllTextAsync(
            Path.Combine(Path.GetTempPath(), "tripplanner-snapshot-v1-test.json"),
            text
        );
        Assert.DoesNotContain("PRIVATE-INSTRUCTIONS-DO-NOT-EXPORT", text);
        Assert.DoesNotContain(user.Email, text);
        var snapshot = JsonSerializer.Deserialize<TripSnapshotResponse>(
            text,
            TripSnapshotProjection.JsonOptions
        )!;
        Assert.AreEqual("Trip", snapshot.Type);
        var visits = snapshot.Itinerary["itemListElement"]!.AsArray();
        Assert.AreEqual(2, visits.Count);
        Assert.AreEqual(
            visits[0]!["item"]!["@id"]!.GetValue<string>(),
            visits[1]!["item"]!["@id"]!.GetValue<string>()
        );
        Assert.AreNotEqual(
            visits[0]!["tp:accommodation"]!["@id"]!.GetValue<string>(),
            visits[1]!["tp:accommodation"]!["@id"]!.GetValue<string>()
        );
        var entries = snapshot.Plan["entries"]!.AsArray();
        var task = entries.Single(e => e!["uid"]!.GetValue<string>() == activity.Id.ToString());
        Assert.AreEqual("Task", task!["@type"]!.GetValue<string>());
        Assert.IsNull(task["start"]);
        var resource = snapshot.Resources[
            $"/trips/{trip.Id}/destinations/{place.CityId}/activities/{activity.Id}"
        ];
        using var individual = await client.GetAsync(resource.Href);
        Assert.AreEqual(resource.Etag, individual.Headers.ETag!.ToString());
        Assert.AreEqual(
            resource.Data.GetRawText(),
            JsonSerializer.Serialize(
                await individual.Content.ReadFromJsonAsync<JsonElement>(),
                TripSnapshotProjection.JsonOptions
            )
        );
    }

    [TestMethod]
    public async Task SnapshotSupportsGzipAndStableConditionalReadsWithoutOriginHeader()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await Seed(factory, client);
        var trip = await factory.Database.CreateTripAsync(user.Id, "Trip", "");
        var url = $"/trips/{trip.Id}/snapshot";
        using var first = await client.GetAsync(url);
        using var conditional = new HttpRequestMessage(HttpMethod.Get, url);
        conditional.Headers.IfNoneMatch.Add(first.Headers.ETag!);
        using var unchanged = await client.SendAsync(conditional);
        Assert.AreEqual(HttpStatusCode.NotModified, unchanged.StatusCode);
        using var gzip = new HttpRequestMessage(HttpMethod.Get, url);
        gzip.Headers.AcceptEncoding.ParseAdd("gzip");
        using var compressed = await client.SendAsync(gzip);
        Assert.AreEqual("gzip", compressed.Content.Headers.ContentEncoding.Single());
        Assert.AreNotEqual(first.Headers.ETag, compressed.Headers.ETag);
        using var stream = new GZipStream(
            await compressed.Content.ReadAsStreamAsync(),
            CompressionMode.Decompress
        );
        using var reader = new StreamReader(stream);
        Assert.AreEqual(await first.Content.ReadAsStringAsync(), await reader.ReadToEndAsync());
    }

    [TestMethod]
    [DataRow("gzip;q=0, identity;q=0", HttpStatusCode.NotAcceptable, false)]
    [DataRow("gzip;q=0, *;q=1", HttpStatusCode.OK, false)]
    [DataRow("identity;q=0, gzip;q=1", HttpStatusCode.OK, true)]
    public async Task SnapshotHonorsExcludedEncodings(
        string acceptEncoding,
        HttpStatusCode expected,
        bool compressed
    )
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await Seed(factory, client);
        var trip = await factory.Database.CreateTripAsync(user.Id, "Encoding", "");
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/trips/{trip.Id}/snapshot");
        request.Headers.TryAddWithoutValidation("Accept-Encoding", acceptEncoding);
        using var response = await client.SendAsync(request);
        Assert.AreEqual(expected, response.StatusCode);
        Assert.AreEqual(compressed, response.Content.Headers.ContentEncoding.Contains("gzip"));
    }

    [TestMethod]
    public async Task ConditionalWritesRejectStaleAndMissingVersionsButAllowIndependentResources()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await Seed(factory, client);
        var trip = await factory.Database.CreateTripAsync(user.Id, "Trip", "");
        var other = await factory.Database.CreateTripAsync(user.Id, "Other", "");
        string url = $"/trips/{trip.Id}";
        using var initial = await client.GetAsync(url);
        using var missing = await client.PutAsJsonAsync(url, new UpdateTripRequest("New", ""));
        Assert.AreEqual((HttpStatusCode)428, missing.StatusCode);
        using var independent = await client.PutResourceAsJsonAsync(
            $"/trips/{other.Id}",
            new UpdateTripRequest("Other updated", "")
        );
        independent.EnsureSuccessStatusCode();
        async Task<HttpResponseMessage> Put(string name)
        {
            using var request = new HttpRequestMessage(HttpMethod.Put, url)
            {
                Content = JsonContent.Create(new UpdateTripRequest(name, "")),
            };
            request.Headers.IfMatch.Add(initial.Headers.ETag!);
            return await client.SendAsync(request);
        }
        using var saved = await Put("First edit");
        Assert.AreEqual(HttpStatusCode.OK, saved.StatusCode);
        using var stale = await Put("Second edit");
        Assert.AreEqual(HttpStatusCode.PreconditionFailed, stale.StatusCode);
        Assert.AreEqual(
            "First edit",
            (await factory.Database.GetTripAsync(user.Id, trip.Id))!.Name
        );
    }

    [TestMethod]
    public async Task SnapshotsHideForeignTripsAndRequireAuthentication()
    {
        await using var factory = new TestApplicationFactory();
        using var ownerClient = factory.CreateClient();
        var owner = await Seed(factory, ownerClient);
        var trip = await factory.Database.CreateTripAsync(owner.Id, "Private", "");
        using var anonymous = factory.CreateClient();
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await anonymous.GetAsync($"/trips/{trip.Id}/snapshot")).StatusCode
        );
        using var stranger = factory.CreateClient();
        await Seed(factory, stranger, "stranger@example.com");
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await stranger.GetAsync($"/trips/{trip.Id}/snapshot")).StatusCode
        );
    }

    [TestMethod]
    public async Task CanonicalTravellersUseActorIdentityAndConditionalMembershipWrites()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await Seed(factory, client);
        using var memberClient = factory.CreateClient();
        var member = await Seed(factory, memberClient, "member@example.com");
        var trip = await factory.Database.CreateTripAsync(user.Id, "Travellers", "");
        var path = $"/trips/{trip.Id}/travellers/{member.Id}";
        using var add = new HttpRequestMessage(HttpMethod.Put, path)
        {
            Content = JsonContent.Create(new PartyMemberRequest(PartyRole.Planner)),
        };
        add.Headers.IfNoneMatch.ParseAdd("*");
        Assert.AreEqual(HttpStatusCode.NoContent, (await client.SendAsync(add)).StatusCode);
        using var current = await client.GetAsync(path);
        Assert.AreEqual(HttpStatusCode.OK, current.StatusCode);
        var person = await current.Content.ReadFromJsonAsync<JsonElement>();
        Assert.AreEqual("Planner", person.GetProperty("role").GetString());
        using var removeByMember = new HttpRequestMessage(HttpMethod.Delete, path);
        removeByMember.Headers.IfMatch.Add(current.Headers.ETag!);
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await memberClient.SendAsync(removeByMember)).StatusCode
        );
        using var remove = new HttpRequestMessage(HttpMethod.Delete, path);
        remove.Headers.IfMatch.Add(current.Headers.ETag!);
        Assert.AreEqual(HttpStatusCode.NoContent, (await client.SendAsync(remove)).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await memberClient.GetAsync($"/trips/{trip.Id}/snapshot")).StatusCode
        );
    }

    [TestMethod]
    public async Task SelectedFlightIsExportedWithoutAnOfferAndPurchaseAddsAReservation()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await Seed(factory, client);
        var trip = await factory.Database.CreateTripAsync(user.Id, "Flight", "");
        var place = await factory.Database.SaveDestinationPlaceAsync(
            user.Id,
            new(trip.Id, "paris-fr", "Paris", "FR", "Europe/Paris", 2.35, 48.86)
        );
        var visit = (
            await factory.Database.AddDestinationVisitAsync(
                user.Id,
                new(trip.Id, place.CityId, Guid.NewGuid(), 0, new(2030, 4, 2), new(2030, 4, 5))
            )
        )!;
        var party = (await factory.Database.GetPartiesAsync(user.Id, trip.Id)).Single();
        var itinerary = JsonSerializer.SerializeToElement(
            new
            {
                outbound = new
                {
                    segments = new[]
                    {
                        new
                        {
                            departure_airport = "BOS",
                            arrival_airport = "CDG",
                            departure_time_local = "2030-04-01T18:00:00",
                            arrival_time_local = "2030-04-02T07:00:00",
                            marketing_carrier_code = "AF",
                            flight_number = "AF333",
                        },
                    },
                },
            }
        );
        var selected = new SelectedFlight(
            trip.Id,
            party.Id,
            "selected",
            0,
            new("BOS", "CDG", new(2030, 4, 1), new(2030, 4, 5), 1, "ECONOMY", "US", 0),
            itinerary,
            DateTimeOffset.UtcNow
        );
        await factory.Database.SetSelectedFlightAsync(user.Id, selected);
        async Task<JsonElement> Snapshot() =>
            await client.GetFromJsonAsync<JsonElement>($"/trips/{trip.Id}/snapshot");
        var first = await Snapshot();
        var flight = first.GetProperty("flights").EnumerateArray().Single();
        Assert.AreEqual(
            TripSnapshotProjection.Id(visit.StayId),
            flight.GetProperty("destinationVisit").GetProperty("@id").GetString()
        );
        Assert.IsFalse(flight.TryGetProperty("reservation", out _));
        Assert.AreEqual(
            "Flight",
            first.GetProperty("services")[0].GetProperty("@type").GetString()
        );
        foreach (var (code, city) in new[] { ("BOS", "Boston"), ("CDG", "Paris") })
        {
            var airport = first
                .GetProperty("places")
                .EnumerateArray()
                .Single(place =>
                    place.TryGetProperty("iataCode", out var iata) && iata.GetString() == code
                );
            Assert.AreEqual(
                city,
                airport.GetProperty("address").GetProperty("addressLocality").GetString(),
                "Airport cities must be available without another network call."
            );
        }
        await factory.Database.SetSelectedFlightAsync(
            user.Id,
            selected with
            {
                PurchasedLegs = [true],
            }
        );
        var purchased = await Snapshot();
        var reservation = purchased.GetProperty("reservations").EnumerateArray().Single();
        Assert.AreEqual("FlightReservation", reservation.GetProperty("@type").GetString());
        Assert.AreEqual(
            flight.GetProperty("@id").GetString(),
            purchased.GetProperty("flights")[0].GetProperty("@id").GetString()
        );
        Assert.AreEqual(
            "Event",
            purchased.GetProperty("plan").GetProperty("entries")[0].GetProperty("@type").GetString()
        );
        var serviceId = flight.GetProperty("flight").GetProperty("@id").GetString()!;
        var connection = new TravelConnectionRequest(
            Guid.NewGuid(),
            "Flight journey",
            new(PlaceId: TripSnapshotProjection.LocalId(trip.Id, "place", "home")),
            new(VisitId: visit.StayId),
            "flight",
            ServiceId: serviceId
        );
        using var retained = await client.PutResourceAsJsonAsync(
            $"/trips/{trip.Id}/travel",
            new TripTravelRequest([connection])
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            retained.StatusCode,
            await retained.Content.ReadAsStringAsync()
        );
        await factory.Database.DeleteSelectedFlightAsync(user.Id, trip.Id, party.Id);
        var afterDeselect = await Snapshot();
        Assert.AreEqual(0, afterDeselect.GetProperty("flights").GetArrayLength());
        Assert.AreEqual(
            serviceId,
            afterDeselect.GetProperty("services")[0].GetProperty("@id").GetString()
        );
        var referencedAirports = afterDeselect
            .GetProperty("services")[0]
            .EnumerateObject()
            .Where(property => property.Name.EndsWith("Airport"))
            .Select(property => property.Value.GetProperty("@id").GetString())
            .ToArray();
        foreach (var airport in referencedAirports)
        {
            Assert.IsTrue(
                afterDeselect
                    .GetProperty("places")
                    .EnumerateArray()
                    .Any(p => p.GetProperty("@id").GetString() == airport)
            );
        }
    }

    internal static async Task<User> Seed(
        TestApplicationFactory factory,
        HttpClient client,
        string email = "owner@example.com"
    )
    {
        var user = await factory.Database.GetOrCreateUserAsync(new("google", email, "Owner"));
        user = await factory.Database.SetUserProfileAsync(user.Id, new(new("Boston", -71, 42), []));
        client.DefaultRequestHeaders.Add("X-Test-Subject", email);
        client.DefaultRequestHeaders.Add("X-Test-Email", email);
        return user;
    }
}
