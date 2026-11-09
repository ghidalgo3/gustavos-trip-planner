using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Destinations;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public class ActivityEndpointTests
{
    [TestMethod]
    [DataRow("empty", "Unknown", false)]
    [DataRow("invalid", "Unknown", false)]
    [DataRow("duplicate", "Unknown", false)]
    [DataRow("valid", "Maybe", false)]
    [DataRow("valid", "Unknown", true)]
    [DataRow("valid", "Required", true)]
    [DataRow("valid", "NotRequired", true)]
    public async Task ActivityClassification_IsValidatedAndRoundTrips(
        string kindCase,
        string tickets,
        bool valid
    )
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, owner, _) = await CreateTrip(client, factory);
        await AddDestinations(client, trip, false);
        var place = (await factory.Database.GetDestinationPlaceAsync(owner, trip.Id, "paris-fr"))!;
        var kinds = kindCase switch
        {
            "empty" => Array.Empty<ActivityKind>(),
            "invalid" => new[] { ActivityKind.Culture },
            "duplicate" => new[] { ActivityKind.Art, ActivityKind.Art },
            _ => [ActivityKind.Art, ActivityKind.Culture],
        };
        var input = new ActivityInput(
            "Feature",
            null,
            null,
            new("Museum", null, "Paintings", null, ActivityState.Proposed, kinds)
            {
                Address = "1 museum street",
                TicketRequirement = tickets,
                Links = [new("https://example.com/museum", "Official website")],
            }
        );
        var payload = System.Text.Json.Nodes.JsonNode.Parse(
            JsonSerializer.Serialize(input, JsonSerializerOptions.Web)
        )!;
        if (kindCase == "invalid")
        {
            payload["properties"]!["kinds"] = new System.Text.Json.Nodes.JsonArray("Other");
        }
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/trips/{trip.Id}/destinations/paris-fr/activities"
        )
        {
            Content = JsonContent.Create(payload),
        };
        request.Headers.Add("Destination-Context", place.ContextVersion);
        var response = await client.SendAsync(request);
        Assert.AreEqual(
            valid ? HttpStatusCode.Created : HttpStatusCode.BadRequest,
            response.StatusCode,
            await response.Content.ReadAsStringAsync()
        );
        if (valid)
        {
            var saved = (
                await response.Content.ReadFromJsonAsync<GeoJsonFeature<ActivityProperties>>()
            )!;
            CollectionAssert.AreEqual(kinds, saved.Properties.Kinds.ToArray());
            Assert.AreEqual(tickets, saved.Properties.TicketRequirement);
            Assert.AreEqual("1 museum street", saved.Properties.Address);
            var document = await client.GetStringAsync($"/trips/{trip.Id}/document");
            StringAssert.Contains(document, "1 museum street");
            StringAssert.Contains(document, "ticketRequirement");
            StringAssert.Contains(document, "Culture");
        }
        else
        {
            Assert.IsEmpty(await factory.Database.GetActivitiesAsync(owner, trip.Id, "paris-fr"));
        }
    }

    [TestMethod]
    public async Task RepeatVisits_SaveIndependentStayResourcesAndInvalidatePlanningContext()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, owner, _) = await CreateTrip(client, factory);
        await AddDestinations(client, trip, false);
        const string city = "paris-fr";
        string destinationUrl = $"/trips/{trip.Id}/destinations/{city}";
        var first = (await factory.Database.GetDestinationVisitsAsync(owner, trip.Id)).Single();
        var second = (
            await factory.Database.AddDestinationVisitAsync(
                owner,
                new(trip.Id, city, Guid.NewGuid(), 1, null, null)
            )
        )!;
        string firstUrl = $"{destinationUrl}/stays/{first.StayId}/location";
        string secondUrl = $"{destinationUrl}/stays/{second.StayId}/location";
        var before = (
            await client.GetFromJsonAsync<ActivityPlanResponse>($"{destinationUrl}/activity-plan")
        )!;
        var hotel = new StayLocationRequest(
            "Feature",
            new("Point", GeographyPoint.Create(48.86, 2.35)),
            new("First hotel")
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            (await client.PutResourceAsJsonAsync(firstUrl, hotel)).StatusCode
        );
        Assert.AreEqual(HttpStatusCode.NotFound, (await client.GetAsync(secondUrl)).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.OK,
            (
                await client.PutResourceAsJsonAsync(
                    secondUrl,
                    hotel with
                    {
                        Properties = new("Second hotel"),
                    }
                )
            ).StatusCode
        );
        var destination = (
            await client.GetFromJsonAsync<GeoJsonFeature<DestinationProperties>>(destinationUrl)
        )!;
        Assert.AreEqual(
            "First hotel",
            destination
                .Properties.Stays.Single(v => v.Id == first.StayId)
                .StayLocation!.Properties.Name
        );
        Assert.AreEqual(
            "Second hotel",
            destination
                .Properties.Stays.Single(v => v.Id == second.StayId)
                .StayLocation!.Properties.Name
        );
        var after = (
            await client.GetFromJsonAsync<ActivityPlanResponse>($"{destinationUrl}/activity-plan")
        )!;
        Assert.AreNotEqual(before.ContextVersion, after.ContextVersion);
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (
                await client.PutResourceAsJsonAsync(
                    $"{destinationUrl}/stays/{Guid.NewGuid()}/location",
                    hotel
                )
            ).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (
                await client.PutResourceAsJsonAsync(
                    $"/trips/{trip.Id}/destinations/rome-it/stays/{second.StayId}/location",
                    hotel
                )
            ).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (
                await client.GetAsync(
                    $"/trips/{trip.Id}/destinations/rome-it/stays/{second.StayId}/location"
                )
            ).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await client.DeleteResourceAsync(firstUrl)).StatusCode
        );
        Assert.AreEqual(
            "Second hotel",
            (await client.GetFromJsonAsync<GeoJsonFeature<StayLocationProperties>>(secondUrl))!
                .Properties
                .Name
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await client.DeleteResourceAsync($"{destinationUrl}/stays/{second.StayId}")).StatusCode
        );
        Assert.AreEqual(HttpStatusCode.NotFound, (await client.GetAsync(secondUrl)).StatusCode);
        Assert.IsEmpty(await factory.Database.GetStayLocationsAsync(owner, trip.Id));
    }

    [TestMethod]
    [DataRow(null, "Europe/Paris", "Europe/Paris", 1)]
    [DataRow("Europe/London", "Europe/Paris", "Europe/London", 0)]
    [DataRow(null, null, null, 1)]
    public async Task NewDestination_ResolvesTimezoneForThePlan_AndRepeatVisitsReuseIt(
        string? suppliedZone,
        string? resolvedZone,
        string? expectedZone,
        int expectedLookups
    )
    {
        var resolver = new TimeZoneMaps(resolvedZone);
        await using var factory = new TestApplicationFactory { MapsClient = resolver };
        using var client = factory.CreateClient();
        var (trip, _, _) = await CreateTrip(client, factory);
        var request = DestinationFeature("Paris", "FR", new(2027, 6, 10), new(2027, 6, 11));
        request = request with { Properties = request.Properties with { TimeZone = suppliedZone } };
        string path = $"/trips/{trip.Id}/destinations";
        var created = await client.PostAsJsonAsync(path, request);
        Assert.AreEqual(HttpStatusCode.Created, created.StatusCode);
        var destination = (
            await created.Content.ReadFromJsonAsync<GeoJsonFeature<DestinationProperties>>()
        )!;
        Assert.AreEqual(expectedZone, destination.Properties.TimeZone);
        var plan = (
            await client.GetFromJsonAsync<ActivityPlanResponse>(
                $"{path}/{destination.Id}/activity-plan"
            )
        )!;
        Assert.AreEqual(expectedZone, plan.Plan.TimeZone);
        var repeated = await client.PostAsJsonAsync(
            path,
            request with
            {
                Properties = request.Properties with
                {
                    TimeZone = "Asia/Tokyo",
                    ArrivalDate = new(2027, 6, 11),
                    DepartureDate = new(2027, 6, 12),
                },
            }
        );
        Assert.AreEqual(HttpStatusCode.Created, repeated.StatusCode);
        var repeat = (
            await repeated.Content.ReadFromJsonAsync<GeoJsonFeature<DestinationProperties>>()
        )!;
        Assert.AreEqual(expectedZone, repeat.Properties.TimeZone);
        Assert.HasCount(2, repeat.Properties.Stays);
        if (resolvedZone is null)
        {
            Assert.IsGreaterThan(
                1,
                resolver.Calls,
                "An older missing zone is retried automatically when read."
            );
        }
        else
        {
            Assert.AreEqual(expectedLookups, resolver.Calls);
        }
        if (expectedLookups > 0)
        {
            Assert.AreEqual(request.Geometry!.Position, resolver.Point);
        }
    }

    [TestMethod]
    [DataRow("Seoul", "KR", 37.5665, 126.9780, "Asia/Seoul")]
    [DataRow("Tokyo", "JP", 35.6762, 139.6503, "Asia/Tokyo")]
    [DataRow("New York", "US", 40.7128, -74.0060, "America/New_York")]
    public async Task DestinationAndPlanUseCityZoneWithoutUserInputAndOlderMissingZonesStillWork(
        string city,
        string country,
        double latitude,
        double longitude,
        string expected
    )
    {
        await using var factory = new TestApplicationFactory { MapsClient = new CoordinateZones() };
        using var client = factory.CreateClient();
        var (trip, owner, _) = await CreateTrip(client, factory);
        string path = $"/trips/{trip.Id}/destinations";
        using var created = await client.PostAsJsonAsync(
            path,
            DestinationFeature(
                city,
                country,
                new(2027, 6, 10),
                new(2027, 6, 11),
                longitude,
                latitude
            )
        );
        Assert.AreEqual(HttpStatusCode.Created, created.StatusCode);
        var destination = (
            await created.Content.ReadFromJsonAsync<GeoJsonFeature<DestinationProperties>>()
        )!;
        Assert.AreEqual(expected, destination.Properties.TimeZone);
        var stored = (
            await factory.Database.GetDestinationPlaceAsync(owner, trip.Id, destination.Id)
        )!;
        Assert.AreEqual(expected, stored.TimeZone);
        // Simulate a destination created before automatic lookup was available.
        await factory.Database.ReplaceDestinationPlaceAsync(owner, stored with { TimeZone = "" });
        var older = (
            await client.GetFromJsonAsync<GeoJsonFeature<DestinationProperties>>(
                $"{path}/{destination.Id}"
            )
        )!;
        Assert.AreEqual(expected, older.Properties.TimeZone);
        var plan = (
            await client.GetFromJsonAsync<ActivityPlanResponse>(
                $"{path}/{destination.Id}/activity-plan"
            )
        )!;
        Assert.AreEqual(expected, plan.Plan.TimeZone);
        Assert.IsFalse(plan.Assessment.Issues.Any(issue => issue.Code == "timezone_unknown"));
        Assert.AreEqual(
            "",
            (
                await factory.Database.GetDestinationPlaceAsync(owner, trip.Id, destination.Id)
            )!.TimeZone,
            "A read-only REST or MCP read must not mutate the destination."
        );
        // A replacement that omits timezone must derive it, never clear it.
        using var replacement = await client.PutResourceAsJsonAsync(
            $"{path}/{destination.Id}",
            new ReplaceDestinationRequest(
                "Feature",
                destination.Id,
                destination.Geometry,
                new(city, country)
            )
        );
        Assert.AreEqual(HttpStatusCode.OK, replacement.StatusCode);
        Assert.AreEqual(
            expected,
            (
                await factory.Database.GetDestinationPlaceAsync(owner, trip.Id, destination.Id)
            )!.TimeZone
        );
    }

    private sealed class CoordinateZones : AzureMapsStub
    {
        public override Task<string?> ResolveTimeZoneAsync(
            GeographyPoint point,
            CancellationToken cancellationToken
        ) =>
            Task.FromResult<string?>(
                GeoTimeZone.TimeZoneLookup.GetTimeZone(point.Latitude, point.Longitude).Result
            );
    }

    private sealed class TimeZoneMaps(string? zone) : AzureMapsStub
    {
        public int Calls { get; private set; }
        public GeographyPoint? Point { get; private set; }

        public override Task<string?> ResolveTimeZoneAsync(
            GeographyPoint point,
            CancellationToken cancellationToken
        )
        {
            Calls++;
            Point = point;
            return Task.FromResult(zone);
        }
    }

    [TestMethod]
    public async Task StayLocation_IsSeparateFromActivitiesAndSurvivesDestinationEdits()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, owner, _) = await CreateTrip(client, factory);
        await AddDestinations(client, trip, false);
        string destinationUrl = $"/trips/{trip.Id}/destinations/paris-fr";
        var visitId = (await factory.Database.GetDestinationVisitsAsync(owner, trip.Id))
            .Single()
            .StayId;
        string locationUrl = $"{destinationUrl}/stays/{visitId}/location";
        var request = new StayLocationRequest(
            "Feature",
            new("Point", GeographyPoint.Create(latitude: 48.86, longitude: 2.34)),
            new("Paris Hotel")
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            (await client.PutResourceAsJsonAsync(locationUrl, request)).StatusCode
        );
        var destination = (
            await client.GetFromJsonAsync<GeoJsonFeature<DestinationProperties>>(destinationUrl)
        )!;
        Assert.AreEqual(
            "Paris Hotel",
            destination.Properties.Stays.Single().StayLocation!.Properties.Name
        );
        Assert.AreEqual(
            visitId.ToString("D"),
            destination.Properties.Stays.Single().StayLocation!.Id
        );
        Assert.IsEmpty(
            (
                await client.GetFromJsonAsync<GeoJsonCollection<ActivityProperties>>(
                    $"{destinationUrl}/activities"
                )
            )!.Features
        );
        await client.PutResourceAsJsonAsync(
            destinationUrl,
            new ReplaceDestinationRequest(
                "Feature",
                destination.Id,
                destination.Geometry,
                new(
                    "Paris",
                    "FR",
                    Constraints: JsonSerializer.SerializeToElement(new { budget = 100 })
                )
            )
        );
        destination = (
            await client.GetFromJsonAsync<GeoJsonFeature<DestinationProperties>>(destinationUrl)
        )!;
        Assert.AreEqual(
            "Paris Hotel",
            destination.Properties.Stays.Single().StayLocation!.Properties.Name
        );
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PutResourceAsJsonAsync(
                    locationUrl,
                    request with
                    {
                        Geometry = new(
                            "Point",
                            GeographyPoint.Create(latitude: 48, longitude: 181)
                        ),
                    }
                )
            ).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await client.DeleteResourceAsync(locationUrl)).StatusCode
        );
        Assert.IsNull(
            (await client.GetFromJsonAsync<GeoJsonFeature<DestinationProperties>>(destinationUrl))!
                .Properties.Stays.Single()
                .StayLocation
        );
    }

    [TestMethod]
    public async Task DestinationFeatureCrud_PreservesStaysAndActivitiesWhileReplacingPlaceConstraints()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, owner, _) = await CreateTrip(client, factory);
        string collectionUrl = $"/trips/{trip.Id}/destinations";
        var request = DestinationFeature("Paris", "FR", null, null) with
        {
            Properties = new(
                "Paris",
                "FR",
                Constraints: JsonSerializer.SerializeToElement(new { budget = 400 })
            ),
        };
        var created = await client.PostAsJsonAsync(collectionUrl, request);
        Assert.AreEqual(HttpStatusCode.Created, created.StatusCode);
        var original = (
            await created.Content.ReadFromJsonAsync<GeoJsonFeature<DestinationProperties>>()
        )!;
        Assert.AreEqual(400, original.Properties.Constraints.GetProperty("budget").GetInt32());
        string url = $"{collectionUrl}/{original.Id}";
        await client.PostAsJsonAsync(collectionUrl, request);
        var now = DateTimeOffset.UtcNow;
        var place = (await factory.Database.GetDestinationPlaceAsync(owner, trip.Id, original.Id))!;
        var activity = new Activity(
            Guid.NewGuid(),
            trip.Id,
            original.Id,
            new("Point", GeographyPoint.Create(latitude: 48.85, longitude: 2.35)),
            new(
                "Museum",
                TimeSpan.FromHours(1),
                "Art",
                null,
                ActivityState.Planned,
                [ActivityKind.Culture]
            ),
            now,
            now
        );
        await factory.Database.SaveActivityAsync(owner, activity, place.ContextVersion, null);
        var replacement = new ReplaceDestinationRequest(
            "Feature",
            original.Id,
            new("Point", GeographyPoint.Create(latitude: 48.8, longitude: 2.3)),
            new(
                "Paris city",
                "FR",
                "Europe/Paris",
                JsonSerializer.SerializeToElement(new { accessible = true })
            )
        );
        var updated = await client.PutResourceAsJsonAsync(url, replacement);
        Assert.AreEqual(HttpStatusCode.OK, updated.StatusCode);
        Assert.AreEqual("application/geo+json", updated.Content.Headers.ContentType?.MediaType);
        var feature = (
            await updated.Content.ReadFromJsonAsync<GeoJsonFeature<DestinationProperties>>()
        )!;
        Assert.AreEqual(original.Id, feature.Id);
        Assert.HasCount(2, feature.Properties.Stays);
        Assert.AreEqual(original.Properties.Stays[0].Id, feature.Properties.Stays[0].Id);
        Assert.AreEqual("Paris city", feature.Properties.Name);
        Assert.IsTrue(feature.Properties.Constraints.GetProperty("accessible").GetBoolean());
        Assert.IsFalse(feature.Properties.Constraints.TryGetProperty("budget", out _));
        Assert.AreNotEqual(place.ContextVersion, feature.Properties.ContextVersion);
        Assert.AreEqual(
            HttpStatusCode.OK,
            (await client.GetAsync($"{url}/activities/{activity.Id}")).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PutResourceAsJsonAsync(url, replacement with { Id = "another-city" })
            ).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (
                await client.PutResourceAsJsonAsync(
                    $"{collectionUrl}/missing",
                    replacement with
                    {
                        Id = "missing",
                    }
                )
            ).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await client.DeleteResourceAsync(url)).StatusCode
        );
        Assert.AreEqual(HttpStatusCode.NotFound, (await client.GetAsync(url)).StatusCode);
        Assert.IsEmpty(
            (
                await client.GetFromJsonAsync<GeoJsonCollection<DestinationProperties>>(
                    collectionUrl
                )
            )!.Features
        );
        Assert.IsNull(
            await factory.Database.GetActivityAsync(owner, trip.Id, original.Id, activity.Id)
        );
    }

    [TestMethod]
    [DataRow("Polygon", "{}")]
    [DataRow("Point", "[]")]
    [DataRow("Point", "42")]
    public async Task DestinationFeatures_RejectInvalidGeometryAndConstraints(
        string geometryType,
        string constraints
    )
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, _, _) = await CreateTrip(client, factory);
        var request = new CreateDestinationRequest(
            "Feature",
            new(geometryType, GeographyPoint.Create(latitude: 48.8, longitude: 2.3)),
            new("Paris", "FR", Constraints: JsonSerializer.Deserialize<JsonElement>(constraints))
        );
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync($"/trips/{trip.Id}/destinations", request)).StatusCode
        );
    }

    [TestMethod]
    public async Task Destinations_CanBePlannedBeforeFlightsAndShowRepeatedCityStaysInRouteOrder()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        (Trip trip, Guid owner, Guid party) = await CreateTrip(client, factory);
        string url = $"/trips/{trip.Id}/destinations";
        Assert.HasCount(
            0,
            (await client.GetFromJsonAsync<GeoJsonCollection<DestinationProperties>>(url))!.Features
        );
        await AddDestinations(client, trip, true);
        var response = await client.GetAsync(url);
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual("application/geo+json", response.Content.Headers.ContentType?.MediaType);
        var collection = (
            await response.Content.ReadFromJsonAsync<GeoJsonCollection<DestinationProperties>>()
        )!;
        Assert.HasCount(2, collection.Features);
        Assert.AreEqual("paris-fr", collection.Features[0].Id);
        Assert.AreEqual("rome-it", collection.Features[1].Id);
        Assert.HasCount(2, collection.Features[0].Properties.Stays);
        Assert.IsNull(collection.Features[0].Properties.ArrivalDate);
        CollectionAssert.AreEqual(
            new[] { "paris-fr", "rome-it", "paris-fr" },
            collection.Route!.Select(item => item.DestinationId).ToArray()
        );
        CollectionAssert.AreEqual(
            new[] { 0, 2 },
            collection.Features[0].Properties.Stays.Select(stay => stay.Order).ToArray()
        );
        Assert.AreEqual(2.3522, collection.Features[0].Geometry!.Position.Longitude);
        var stay = collection.Features[0].Properties.Stays[0];
        var updated = await client.PutResourceAsJsonAsync(
            $"{url}/paris-fr/stays/{stay.Id}",
            new DestinationStayInput(new DateOnly(2027, 6, 11), new DateOnly(2027, 6, 14))
        );
        Assert.AreEqual(HttpStatusCode.OK, updated.StatusCode);
        var changed = (
            await updated.Content.ReadFromJsonAsync<GeoJsonFeature<DestinationProperties>>()
        )!;
        Assert.AreEqual(new DateOnly(2027, 6, 11), changed.Properties.Stays[0].ArrivalDate);
        Assert.AreNotEqual(
            collection.Features[0].Properties.ContextVersion,
            changed.Properties.ContextVersion
        );
    }

    [TestMethod]
    public async Task Destination_UsesSelectedCityCoordinatesAndRejectsInvalidCoordinates()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, _, _) = await CreateTrip(client, factory);
        string url = $"/trips/{trip.Id}/destinations";
        var invalid = await client.PostAsJsonAsync(
            url,
            DestinationFeature("Paris", "FR", null, null, 181, 48.86)
        );
        Assert.AreEqual(HttpStatusCode.BadRequest, invalid.StatusCode);

        var response = await client.PostAsJsonAsync(
            url,
            DestinationFeature("Paris", "FR", null, null, 2.3, 48.8)
        );
        Assert.AreEqual(HttpStatusCode.Created, response.StatusCode);
        var destination = (
            await response.Content.ReadFromJsonAsync<GeoJsonFeature<DestinationProperties>>()
        )!;
        Assert.AreEqual(
            GeographyPoint.Create(latitude: 48.8, longitude: 2.3),
            destination.Geometry!.Position
        );
        Assert.AreEqual("Paris", destination.Properties.Name);
        Assert.AreEqual("FR", destination.Properties.CountryCode);
    }

    [TestMethod]
    public async Task Destination_KeepsSameNamedCitiesSeparateAndRepeatsTheSelectedCity()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, _, _) = await CreateTrip(client, factory);
        string url = $"/trips/{trip.Id}/destinations";
        var illinois = DestinationFeature("Springfield", "US", null, null, -89.6501, 39.7817);
        var massachusetts = DestinationFeature("Springfield", "US", null, null, -72.5898, 42.1015);

        var first = (
            await (await client.PostAsJsonAsync(url, illinois)).Content.ReadFromJsonAsync<
                GeoJsonFeature<DestinationProperties>
            >()
        )!;
        var second = (
            await (await client.PostAsJsonAsync(url, massachusetts)).Content.ReadFromJsonAsync<
                GeoJsonFeature<DestinationProperties>
            >()
        )!;
        var repeat = (
            await (await client.PostAsJsonAsync(url, massachusetts)).Content.ReadFromJsonAsync<
                GeoJsonFeature<DestinationProperties>
            >()
        )!;

        Assert.AreNotEqual(first.Id, second.Id);
        Assert.AreEqual(second.Id, repeat.Id);
        var destinations = (
            await client.GetFromJsonAsync<GeoJsonCollection<DestinationProperties>>(url)
        )!;
        Assert.HasCount(2, destinations.Features);
        Assert.HasCount(
            1,
            destinations.Features.Single(feature => feature.Id == first.Id).Properties.Stays
        );
        Assert.HasCount(
            2,
            destinations.Features.Single(feature => feature.Id == second.Id).Properties.Stays
        );
    }

    [TestMethod]
    public async Task Activities_SaveWholeFeature_RequireActiveDestinationAndPreserveValidState()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        (Trip trip, Guid owner, Guid party) = await CreateTrip(client, factory);
        await AddDestinations(client, trip, false);
        var destination = (
            await client.GetFromJsonAsync<GeoJsonCollection<DestinationProperties>>(
                $"/trips/{trip.Id}/destinations"
            )
        )!.Features.Single();
        string url = $"/trips/{trip.Id}/destinations/{destination.Id}/activities";
        ActivityInput input = new(
            "Feature",
            null,
            new("Point", GeographyPoint.Create(latitude: 48.8606, longitude: 2.3364)),
            new(
                "Museum visit",
                TimeSpan.FromHours(2),
                "Sculpture galleries",
                new(0, "EUR", "perPerson"),
                ActivityState.Proposed,
                [ActivityKind.Culture],
                "Museum"
            )
        );
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (await client.PostAsJsonAsync(url, input)).StatusCode
        );
        using var create = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = JsonContent.Create(input),
        };
        create.Headers.Add("Destination-Context", destination.Properties.ContextVersion);
        var createdResponse = await client.SendAsync(create);
        Assert.AreEqual(HttpStatusCode.Created, createdResponse.StatusCode);
        Assert.AreEqual(
            "application/geo+json",
            createdResponse.Content.Headers.ContentType?.MediaType
        );
        var created = (
            await createdResponse.Content.ReadFromJsonAsync<GeoJsonFeature<ActivityProperties>>()
        )!;
        Assert.AreEqual(ActivityState.Proposed, created.Properties.State);
        Assert.AreEqual(0m, created.Properties.Cost!.Amount);
        string resource = $"{url}/{created.Id}";
        var detail = await client.GetAsync(resource);
        string etag = detail.Headers.ETag!.Tag;
        var updatedInput = input with
        {
            Id = created.Id,
            Properties = input.Properties with
            {
                Description = "Updated",
                State = ActivityState.Planned,
            },
        };
        using var replace = new HttpRequestMessage(HttpMethod.Put, resource)
        {
            Content = JsonContent.Create(updatedInput),
        };
        replace.Headers.Add("Destination-Context", destination.Properties.ContextVersion);
        replace.Headers.TryAddWithoutValidation("If-Match", etag);
        var replaced = await client.SendAsync(replace);
        Assert.AreEqual(HttpStatusCode.OK, replaced.StatusCode);
        Assert.AreEqual(
            ActivityState.Planned,
            (await replaced.Content.ReadFromJsonAsync<GeoJsonFeature<ActivityProperties>>())!
                .Properties
                .State
        );
        using var stale = new HttpRequestMessage(HttpMethod.Put, resource)
        {
            Content = JsonContent.Create(updatedInput),
        };
        stale.Headers.Add("Destination-Context", destination.Properties.ContextVersion);
        stale.Headers.TryAddWithoutValidation("If-Match", etag);
        Assert.AreEqual(
            HttpStatusCode.PreconditionFailed,
            (await client.SendAsync(stale)).StatusCode
        );

        await client.DeleteResourceAsync(
            $"/trips/{trip.Id}/destinations/{destination.Id}/stays/{destination.Properties.Stays[0].Id}"
        );
        Assert.AreEqual(HttpStatusCode.OK, (await client.GetAsync(url)).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await client.PostAsJsonAsync(url, input)).StatusCode
        );
        var inactive = (
            await client.GetFromJsonAsync<GeoJsonCollection<DestinationProperties>>(
                $"/trips/{trip.Id}/destinations?includeInactive=true"
            )
        )!;
        Assert.IsFalse(inactive.Features.Single().Properties.IsActive);
        Assert.IsFalse(
            (
                await client.GetFromJsonAsync<GeoJsonFeature<DestinationProperties>>(
                    $"/trips/{trip.Id}/destinations/{destination.Id}"
                )
            )!
                .Properties
                .IsActive
        );
    }

    private static MultipartFormDataContent ImageForm(
        Guid requestId,
        string context,
        byte[] bytes,
        int count = 1
    )
    {
        var form = new MultipartFormDataContent();
        form.Add(new StringContent(requestId.ToString("D")), "requestId");
        form.Add(new StringContent(context), "destinationContext");
        for (int index = 0; index < count; index++)
        {
            var image = bytes.ToArray();
            image[^1] += (byte)index;
            form.Add(
                new ByteArrayContent(image),
                count == 1 ? "image" : "images",
                $"flyer-{index}.png"
            );
        }
        return form;
    }

    private static async Task<(Trip, Guid, Guid)> CreateTrip(
        HttpClient client,
        TestApplicationFactory factory
    )
    {
        client.DefaultRequestHeaders.Add("X-Test-Subject", "activity-subject");
        client.DefaultRequestHeaders.Add("X-Test-Provider", "google");
        client.DefaultRequestHeaders.Add("X-Test-Name", "Ada");
        client.DefaultRequestHeaders.Add("X-Test-Email", "activities@example.com");
        var user = (await client.GetFromJsonAsync<CurrentUserResponse>("/user"))!;
        await client.PutResourceAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Boston", -71.0589, 42.3601), [])
        );
        Trip trip = (
            await (
                await client.PostAsJsonAsync(
                    $"/user/{user.Id}/trips",
                    new CreateTripRequest("Europe", "")
                )
            ).Content.ReadFromJsonAsync<Trip>()
        )!;
        return (trip, user.Id!.Value, factory.Database.Parties.Single().Id);
    }

    private static CreateDestinationRequest DestinationFeature(
        string name,
        string countryCode,
        DateOnly? arrivalDate,
        DateOnly? departureDate,
        double? longitude = null,
        double? latitude = null
    ) =>
        new(
            "Feature",
            new(
                "Point",
                GeographyPoint.Create(
                    latitude: latitude ?? (countryCode == "FR" ? 48.8566 : 41.9028),
                    longitude: longitude ?? (countryCode == "FR" ? 2.3522 : 12.4964)
                )
            ),
            new(name, countryCode, arrivalDate, departureDate)
        );

    private static async Task AddDestinations(HttpClient client, Trip trip, bool repeat)
    {
        string url = $"/trips/{trip.Id}/destinations";
        Assert.AreEqual(
            HttpStatusCode.Created,
            (
                await client.PostAsJsonAsync(
                    url,
                    DestinationFeature(
                        "Paris",
                        "FR",
                        new DateOnly(2027, 6, 10),
                        new DateOnly(2027, 6, 14)
                    )
                )
            ).StatusCode
        );
        if (repeat)
        {
            Assert.AreEqual(
                HttpStatusCode.Created,
                (
                    await client.PostAsJsonAsync(
                        url,
                        DestinationFeature(
                            "Rome",
                            "IT",
                            new DateOnly(2027, 6, 14),
                            new DateOnly(2027, 6, 18)
                        )
                    )
                ).StatusCode
            );
            Assert.AreEqual(
                HttpStatusCode.Created,
                (
                    await client.PostAsJsonAsync(
                        url,
                        DestinationFeature(
                            "Paris",
                            "FR",
                            new DateOnly(2027, 6, 18),
                            new DateOnly(2027, 6, 20)
                        )
                    )
                ).StatusCode
            );
        }
    }

    [TestMethod]
    public async Task ActivityLinks_AreSavedReplacedAndCanBeCleared()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, _, _) = await CreateTrip(client, factory);
        await AddDestinations(client, trip, false);
        var destination = (
            await client.GetFromJsonAsync<GeoJsonCollection<DestinationProperties>>(
                $"/trips/{trip.Id}/destinations"
            )
        )!.Features.Single();
        string url = $"/trips/{trip.Id}/destinations/{destination.Id}/activities";
        var input = new ActivityInput(
            "Feature",
            null,
            null,
            new("Museum", null, "", null, ActivityState.Proposed, [ActivityKind.Culture])
            {
                Links =
                [
                    new("https://museum.example/info", "About the museum"),
                    new("https://tickets.example/booking", "Tickets"),
                ],
            }
        );
        using var create = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = JsonContent.Create(input),
        };
        create.Headers.Add("Destination-Context", destination.Properties.ContextVersion);
        var response = await client.SendAsync(create);
        Assert.AreEqual(HttpStatusCode.Created, response.StatusCode);
        var created = (
            await response.Content.ReadFromJsonAsync<GeoJsonFeature<ActivityProperties>>()
        )!;
        Assert.HasCount(2, created.Properties.Links);
        string resource = $"{url}/{created.Id}";
        var fetched = await client.GetAsync(resource);
        var stored = (
            await fetched.Content.ReadFromJsonAsync<GeoJsonFeature<ActivityProperties>>()
        )!;
        Assert.AreEqual("Tickets", stored.Properties.Links[1].Label);
        using var replace = new HttpRequestMessage(HttpMethod.Put, resource)
        {
            Content = JsonContent.Create(
                input with
                {
                    Id = created.Id,
                    Properties = input.Properties with { Links = [] },
                }
            ),
        };
        replace.Headers.Add("Destination-Context", destination.Properties.ContextVersion);
        replace.Headers.TryAddWithoutValidation("If-Match", fetched.Headers.ETag!.Tag);
        var replaced = await client.SendAsync(replace);
        Assert.AreEqual(HttpStatusCode.OK, replaced.StatusCode);
        Assert.IsEmpty(
            (await replaced.Content.ReadFromJsonAsync<GeoJsonFeature<ActivityProperties>>())!
                .Properties
                .Links
        );
    }

    [TestMethod]
    [DataRow("javascript:alert(1)")]
    [DataRow("data:text/html,example")]
    [DataRow("file:///tmp/tickets")]
    [DataRow("https://user:password@tickets.example/")]
    [DataRow("relative/path")]
    public async Task ActivityLinks_RejectInvalidUrls(string url)
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, _, _) = await CreateTrip(client, factory);
        await AddDestinations(client, trip, false);
        var destination = (
            await client.GetFromJsonAsync<GeoJsonCollection<DestinationProperties>>(
                $"/trips/{trip.Id}/destinations"
            )
        )!.Features.Single();
        using var create = new HttpRequestMessage(
            HttpMethod.Post,
            $"/trips/{trip.Id}/destinations/{destination.Id}/activities"
        )
        {
            Content = JsonContent.Create(
                new ActivityInput(
                    "Feature",
                    null,
                    null,
                    new("Museum", null, "", null, ActivityState.Proposed, [ActivityKind.Culture])
                    {
                        Links = [new(url)],
                    }
                )
            ),
        };
        create.Headers.Add("Destination-Context", destination.Properties.ContextVersion);
        Assert.AreEqual(HttpStatusCode.BadRequest, (await client.SendAsync(create)).StatusCode);
    }

    private sealed class ResearchMaps(bool initiallyResolved, bool verifiesVenue) : AzureMapsStub
    {
        public string? LastPlace { get; private set; }
        public string? LastAddress { get; private set; }
        public IReadOnlyList<AddressLocationCandidate>? AddressCandidates { get; init; }

        public override Task<IReadOnlyList<AddressLocationCandidate>> GeocodeAddressAsync(
            string address,
            string city,
            string countryCode,
            CancellationToken cancellationToken,
            GeoJsonPoint? center = null,
            StructuredAddress? structuredAddress = null
        )
        {
            LastAddress = address;
            IReadOnlyList<AddressLocationCandidate> candidates =
                AddressCandidates
                ?? (
                    verifiesVenue
                        ?
                        [
                            new(
                                new("Point", GeographyPoint.Create(48.86, 2.33)),
                                address,
                                AddressMatchConfidence.High,
                                false
                            ),
                        ]
                        : []
                );
            return Task.FromResult(candidates);
        }

        public override Task<GeoJsonPoint?> GeocodePlaceAsync(
            string placeName,
            string city,
            string countryCode,
            CancellationToken cancellationToken,
            GeoJsonPoint? center = null
        )
        {
            LastPlace = placeName;
            bool resolves = initiallyResolved;
            return Task.FromResult<GeoJsonPoint?>(
                resolves
                    ? new("Point", GeographyPoint.Create(latitude: 48.86, longitude: 2.33))
                    : null
            );
        }
    }
}
