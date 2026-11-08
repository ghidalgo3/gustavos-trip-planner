using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Documents;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class TripDocumentResourceTests
{
    [TestMethod]
    public async Task DocumentContainsRepeatVisitsIndependentStaysAndTasksWithoutPrivateProfiles()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await TripDocumentFixture.Seed(factory, client);
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
        using var response = await client.GetAsync($"/trips/{trip.Id}/document");
        Assert.AreEqual(
            HttpStatusCode.OK,
            response.StatusCode,
            await response.Content.ReadAsStringAsync()
        );
        Assert.AreEqual("application/json", response.Content.Headers.ContentType!.MediaType);
        Assert.IsTrue(response.Headers.CacheControl!.Private);
        var text = await response.Content.ReadAsStringAsync();
        await File.WriteAllTextAsync(
            Path.Combine(Path.GetTempPath(), "tripplanner-document-v1-test.json"),
            text
        );
        Assert.DoesNotContain("PRIVATE-INSTRUCTIONS-DO-NOT-EXPORT", text);
        Assert.DoesNotContain(user.Email, text);
        Assert.DoesNotContain("/trips/", text);
        Assert.DoesNotContain("\"sync\":", text);
        var document = JsonSerializer.Deserialize<TripDocument>(
            text,
            TripResourceProjection.JsonOptions
        )!;
        Assert.AreEqual(trip.Id, document.Id);
        var items = document.Itinerary["items"]!.AsArray().OfType<JsonObject>().ToArray();
        var visits = items.Where(item => item["kind"]!.GetValue<string>() == "visit").ToArray();
        var lodging = items.Where(item => item["kind"]!.GetValue<string>() == "lodging").ToArray();
        Assert.HasCount(2, visits);
        Assert.HasCount(2, lodging);
        Assert.AreEqual(
            visits[0]["destinationId"]!.GetValue<string>(),
            visits[1]["destinationId"]!.GetValue<string>()
        );
        Assert.AreNotEqual(
            lodging[0]["placeId"]!.GetValue<string>(),
            lodging[1]["placeId"]!.GetValue<string>()
        );
        foreach (var visit in visits)
        {
            var stay = lodging.Single(item =>
                item["visitId"]!.GetValue<string>() == visit["id"]!.GetValue<string>()
            );
            Assert.IsTrue(JsonNode.DeepEquals(visit["start"], stay["start"]));
            Assert.IsTrue(JsonNode.DeepEquals(visit["end"], stay["end"]));
            Assert.IsFalse(stay["busy"]!.GetValue<bool>());
            var path =
                $"/trips/{trip.Id}/destinations/{place.CityId}/stays/{visit["id"]!.GetValue<string>()}";
            using var details = await client.GetAsync(path);
            using var accommodation = await client.GetAsync(path + "/location");
            Assert.AreEqual(
                details.Headers.ETag!.ToString().Trim('"'),
                visit["etag"]!.GetValue<string>()
            );
            Assert.AreEqual(
                accommodation.Headers.ETag!.ToString().Trim('"'),
                stay["etag"]!.GetValue<string>()
            );
        }
        using var travel = await client.GetAsync($"/trips/{trip.Id}/travel");
        Assert.AreEqual(
            travel.Headers.ETag!.ToString().Trim('"'),
            document.Itinerary["connectionsEtag"]!.GetValue<string>()
        );
        var idea = items.Single(item => item["id"]!.GetValue<string>() == activity.Id.ToString());
        Assert.AreEqual("Proposed", idea["state"]!.GetValue<string>());
        Assert.AreEqual("task", idea["type"]!.GetValue<string>());
        Assert.IsFalse(idea.ContainsKey("start"));
        using var individual = await client.GetAsync(
            $"/trips/{trip.Id}/destinations/{place.CityId}/activities/{activity.Id}"
        );
        Assert.AreEqual(
            idea["etag"]!.GetValue<string>(),
            individual.Headers.ETag!.ToString().Trim('"')
        );
        var feature = await individual.Content.ReadFromJsonAsync<JsonElement>();
        Assert.AreEqual(
            idea["name"]!.GetValue<string>(),
            feature.GetProperty("properties").GetProperty("name").GetString()
        );
    }

    [TestMethod]
    public async Task DocumentSupportsGzipAndStableConditionalReadsWithoutOriginHeader()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await TripDocumentFixture.Seed(factory, client);
        var trip = await factory.Database.CreateTripAsync(user.Id, "Trip", "");
        var url = $"/trips/{trip.Id}/document";
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
    public async Task DocumentHonorsExcludedEncodings(
        string acceptEncoding,
        HttpStatusCode expected,
        bool compressed
    )
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await TripDocumentFixture.Seed(factory, client);
        var trip = await factory.Database.CreateTripAsync(user.Id, "Encoding", "");
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/trips/{trip.Id}/document");
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
        var user = await TripDocumentFixture.Seed(factory, client);
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
    public async Task DocumentsHideForeignTripsAndRequireAuthentication()
    {
        await using var factory = new TestApplicationFactory();
        using var ownerClient = factory.CreateClient();
        var owner = await TripDocumentFixture.Seed(factory, ownerClient);
        var trip = await factory.Database.CreateTripAsync(owner.Id, "Private", "");
        using var anonymous = factory.CreateClient();
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await anonymous.GetAsync($"/trips/{trip.Id}/document")).StatusCode
        );
        using var stranger = factory.CreateClient();
        await TripDocumentFixture.Seed(factory, stranger, "stranger@example.com");
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await stranger.GetAsync($"/trips/{trip.Id}/document")).StatusCode
        );
    }

    [TestMethod]
    public async Task CanonicalTravellersUseActorIdentityAndConditionalMembershipWrites()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await TripDocumentFixture.Seed(factory, client);
        using var memberClient = factory.CreateClient();
        var member = await TripDocumentFixture.Seed(factory, memberClient, "member@example.com");
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
            (await memberClient.GetAsync($"/trips/{trip.Id}/document")).StatusCode
        );
    }

    [TestMethod]
    public async Task SelectedFlightExportTracksPurchasesAndRetainsReferencedServices()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await TripDocumentFixture.Seed(factory, client);
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
        async Task<JsonElement> Document() =>
            await client.GetFromJsonAsync<JsonElement>($"/trips/{trip.Id}/document");
        var first = await Document();
        var flight = first
            .GetProperty("itinerary")
            .GetProperty("items")
            .EnumerateArray()
            .Single(item => item.GetProperty("kind").GetString() == "flight");
        Assert.AreEqual(
            visit.StayId.ToString(),
            flight.GetProperty("destinationVisitId").GetString()
        );
        Assert.IsFalse(flight.GetProperty("purchased").GetBoolean());
        Assert.AreEqual("flight", flight.GetProperty("kind").GetString());
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
        var purchased = await Document();
        var purchasedLeg = purchased
            .GetProperty("itinerary")
            .GetProperty("items")
            .EnumerateArray()
            .Single(item => item.GetProperty("kind").GetString() == "flight");
        Assert.IsTrue(purchasedLeg.GetProperty("purchased").GetBoolean());
        Assert.AreEqual(
            flight.GetProperty("id").GetString(),
            purchasedLeg.GetProperty("id").GetString()
        );
        Assert.AreEqual("event", purchasedLeg.GetProperty("type").GetString());
        Assert.IsTrue(purchasedLeg.TryGetProperty("start", out _));
        var serviceId = flight.GetProperty("serviceId").GetString()!;
        var connection = new TravelConnectionRequest(
            Guid.NewGuid(),
            "Flight journey",
            new(PlaceId: TripResourceProjection.LocalId(trip.Id, "place", "home")),
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
        var afterDeselect = await Document();
        var retainedConnection = afterDeselect
            .GetProperty("itinerary")
            .GetProperty("items")
            .EnumerateArray()
            .Single(item => item.GetProperty("kind").GetString() == "connection");
        Assert.AreEqual("connection", retainedConnection.GetProperty("kind").GetString());
        Assert.AreEqual(serviceId, retainedConnection.GetProperty("serviceId").GetString());
        var definition = retainedConnection.GetProperty("serviceDefinition");
        foreach (var direction in new[] { "departureAirport", "arrivalAirport" })
        {
            var airport = definition.GetProperty(direction).GetProperty("@id").GetString();
            Assert.IsTrue(
                afterDeselect
                    .GetProperty("places")
                    .EnumerateArray()
                    .Any(p => p.GetProperty("id").GetString() == airport)
            );
        }
    }
}
