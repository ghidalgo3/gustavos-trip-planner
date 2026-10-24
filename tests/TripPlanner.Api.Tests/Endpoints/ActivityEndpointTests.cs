using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Activities;
using TripPlanner.Api.Services.Destinations;
using TripPlanner.Api.Tests.Services.Activities;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public class ActivityEndpointTests
{
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
        var resolver = new TimeZoneResolver(resolvedZone);
        await using var factory = new TestApplicationFactory { TimeZoneResolver = resolver };
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
                Properties = request.Properties with { TimeZone = "Asia/Tokyo" },
            }
        );
        Assert.AreEqual(HttpStatusCode.Created, repeated.StatusCode);
        var repeat = (
            await repeated.Content.ReadFromJsonAsync<GeoJsonFeature<DestinationProperties>>()
        )!;
        Assert.AreEqual(expectedZone, repeat.Properties.TimeZone);
        Assert.HasCount(2, repeat.Properties.Stays);
        Assert.AreEqual(expectedLookups, resolver.Calls);
        if (expectedLookups > 0)
        {
            Assert.AreEqual(request.Geometry!.Position, resolver.Point);
        }
    }

    private sealed class TimeZoneResolver(string? zone) : IDestinationTimeZoneResolver
    {
        public int Calls { get; private set; }
        public GeographyPoint? Point { get; private set; }

        public Task<string?> ResolveAsync(GeographyPoint point, CancellationToken cancellationToken)
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
        var request = new StayLocationRequest(
            "Feature",
            new("Point", GeographyPoint.Create(latitude: 48.86, longitude: 2.34)),
            new("Paris Hotel")
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            (await client.PutAsJsonAsync($"{destinationUrl}/stay", request)).StatusCode
        );
        var destination = (
            await client.GetFromJsonAsync<GeoJsonFeature<DestinationProperties>>(destinationUrl)
        )!;
        Assert.AreEqual("Paris Hotel", destination.Properties.StayLocation!.Properties.Name);
        Assert.AreEqual("stay", destination.Properties.StayLocation.Id);
        Assert.IsEmpty(
            (
                await client.GetFromJsonAsync<GeoJsonCollection<ActivityProperties>>(
                    $"{destinationUrl}/activities"
                )
            )!.Features
        );
        await client.PutAsJsonAsync(
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
        Assert.AreEqual("Paris Hotel", destination.Properties.StayLocation!.Properties.Name);
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PutAsJsonAsync(
                    $"{destinationUrl}/stay",
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
            (await client.DeleteAsync($"{destinationUrl}/stay")).StatusCode
        );
        Assert.IsNull(
            (await client.GetFromJsonAsync<GeoJsonFeature<DestinationProperties>>(destinationUrl))!
                .Properties
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
            new("Museum", TimeSpan.FromHours(1), "Art", null, ActivityState.Planned),
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
        var updated = await client.PutAsJsonAsync(url, replacement);
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
            (await client.PutAsJsonAsync(url, replacement with { Id = "another-city" })).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (
                await client.PutAsJsonAsync(
                    $"{collectionUrl}/missing",
                    replacement with
                    {
                        Id = "missing",
                    }
                )
            ).StatusCode
        );
        Assert.AreEqual(HttpStatusCode.NoContent, (await client.DeleteAsync(url)).StatusCode);
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
        var updated = await client.PutAsJsonAsync(
            $"{url}/paris-fr/stays/{stay.Id}",
            new DestinationStayInput(new DateOnly(2027, 6, 11), new DateOnly(2027, 6, 15))
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

        await client.DeleteAsync(
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

    [TestMethod]
    [DataRow(true)]
    [DataRow(false)]
    public async Task SuggestionJob_ImmediatelyCreatesProposedActivitiesOnlyOnce(bool withPlaceName)
    {
        var assistant = new StubAssistant(withPlaceName ? "Museum" : null);
        await using var factory = new TestApplicationFactory { ActivityAssistant = assistant };
        using var client = factory.CreateClient();
        (Trip trip, Guid owner, Guid party) = await CreateTrip(client, factory);
        await factory.Database.SetUserFeatureFlagsAsync(owner, "LLM");
        await AddDestinations(client, trip, false);
        var destination = (
            await client.GetFromJsonAsync<GeoJsonCollection<DestinationProperties>>(
                $"/trips/{trip.Id}/destinations"
            )
        )!.Features.Single();
        Guid requestId = Guid.NewGuid();
        string url = $"/trips/{trip.Id}/destinations/{destination.Id}:suggest";
        var request = new ActivitySuggestionRequest(
            requestId,
            "Find a museum",
            destination.Properties.ContextVersion
        );
        var started = await client.PostAsJsonAsync(url, request);
        Assert.AreEqual(HttpStatusCode.Accepted, started.StatusCode);
        Assert.AreEqual(
            HttpStatusCode.Accepted,
            (await client.PostAsJsonAsync(url, request)).StatusCode
        );
        var processor = factory.Services.GetRequiredService<ActivityJobProcessor>();
        Assert.IsTrue(await processor.ProcessNextAsync());
        var result = (
            await client.GetFromJsonAsync<ActivitySuggestionResult>(
                $"/trips/{trip.Id}/destinations/{destination.Id}/suggestions/{requestId}"
            )
        )!;
        Assert.HasCount(1, result.Activities.Features);
        Assert.AreEqual(ActivityState.Proposed, result.Activities.Features[0].Properties.State);
        Assert.IsNotNull(result.Activities.Features[0].Geometry);
        Assert.AreEqual(1, assistant.Calls);
        Assert.IsFalse(await processor.ProcessNextAsync());
        var list = (
            await client.GetFromJsonAsync<GeoJsonCollection<ActivityProperties>>(
                $"/trips/{trip.Id}/destinations/{destination.Id}/activities"
            )
        )!;
        Assert.HasCount(1, list.Features);
    }

    [TestMethod]
    [DataRow(1, 24)]
    [DataRow(2, 24)]
    [DataRow(10, 24)]
    [DataRow(2, 6_000_000)]
    public async Task ImageImport_RejectsUnknownFilesAndCreatesProposedActivity(
        int imageCount,
        int imageBytes
    )
    {
        var assistant = new StubAssistant();
        await using var factory = new TestApplicationFactory { ActivityAssistant = assistant };
        using var client = factory.CreateClient();
        (Trip trip, Guid owner, Guid party) = await CreateTrip(client, factory);
        await factory.Database.SetUserFeatureFlagsAsync(owner, "LLM");
        await AddDestinations(client, trip, false);
        var destination = (
            await client.GetFromJsonAsync<GeoJsonCollection<DestinationProperties>>(
                $"/trips/{trip.Id}/destinations"
            )
        )!.Features.Single();
        string url = $"/trips/{trip.Id}/destinations/{destination.Id}:import";
        using (
            var invalid = ImageForm(
                Guid.NewGuid(),
                destination.Properties.ContextVersion,
                [1, 2, 3]
            )
        )
        {
            Assert.AreEqual(
                HttpStatusCode.UnsupportedMediaType,
                (await client.PostAsync(url, invalid)).StatusCode
            );
        }

        byte[] image =
        [
            137,
            80,
            78,
            71,
            13,
            10,
            26,
            10,
            0,
            0,
            0,
            13,
            73,
            72,
            68,
            82,
            0,
            0,
            0,
            10,
            0,
            0,
            0,
            10,
        ];
        Guid requestId = Guid.NewGuid();
        using (
            var invalidBatch = ImageForm(
                Guid.NewGuid(),
                destination.Properties.ContextVersion,
                image
            )
        )
        {
            invalidBatch.Add(new ByteArrayContent([1, 2, 3]), "images", "invalid.png");
            Assert.AreEqual(
                HttpStatusCode.UnsupportedMediaType,
                (await client.PostAsync(url, invalidBatch)).StatusCode
            );
        }
        using (
            var tooMany = ImageForm(
                Guid.NewGuid(),
                destination.Properties.ContextVersion,
                image,
                11
            )
        )
        {
            Assert.AreEqual(
                HttpStatusCode.BadRequest,
                (await client.PostAsync(url, tooMany)).StatusCode
            );
        }

        Array.Resize(ref image, imageBytes);
        using (
            var form = ImageForm(
                requestId,
                destination.Properties.ContextVersion,
                image,
                imageCount
            )
        )
        {
            Assert.AreEqual(
                HttpStatusCode.Accepted,
                (await client.PostAsync(url, form)).StatusCode
            );
        }

        using (
            var retry = ImageForm(
                requestId,
                destination.Properties.ContextVersion,
                image,
                imageCount
            )
        )
        {
            Assert.AreEqual(
                HttpStatusCode.Accepted,
                (await client.PostAsync(url, retry)).StatusCode
            );
        }

        Assert.IsTrue(
            await factory.Services.GetRequiredService<ActivityJobProcessor>().ProcessNextAsync()
        );
        Assert.HasCount(imageCount, assistant.Images);
        CollectionAssert.AreEqual(image, assistant.Images[0].Data);
        Assert.IsTrue(assistant.Images.All(item => item.MimeType == "image/png"));
        byte[] changedImage = [.. image];
        changedImage[^1]++;
        using (
            var changed = ImageForm(
                requestId,
                destination.Properties.ContextVersion,
                changedImage,
                imageCount
            )
        )
        {
            Assert.AreEqual(
                HttpStatusCode.Conflict,
                (await client.PostAsync(url, changed)).StatusCode
            );
        }

        using (
            var retry = ImageForm(
                requestId,
                destination.Properties.ContextVersion,
                image,
                imageCount
            )
        )
        {
            Assert.AreEqual(
                HttpStatusCode.Accepted,
                (await client.PostAsync(url, retry)).StatusCode
            );
        }

        Assert.HasCount(
            1,
            (
                await client.GetFromJsonAsync<ActivitySuggestionResult>(
                    $"/trips/{trip.Id}/destinations/{destination.Id}/suggestions/{requestId}"
                )
            )!
                .Activities
                .Features
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
        await client.PutAsJsonAsync(
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
    public async Task SuggestionApi_UsesOpenAiResponseAndSavesProposedGeoJsonActivities()
    {
        using var handler = new OpenAiActivityAssistantTests.ResponseHandler(
            OpenAiActivityAssistantTests.CompletedResponse()
        );
        await using var factory = new TestApplicationFactory
        {
            ActivityAssistant = OpenAiActivityAssistantTests.Create(handler),
        };
        using var client = factory.CreateClient();
        var (trip, owner, _) = await CreateTrip(client, factory);
        await factory.Database.SetUserFeatureFlagsAsync(owner, "LLM");
        await AddDestinations(client, trip, false);
        var destination = (
            await client.GetFromJsonAsync<GeoJsonCollection<DestinationProperties>>(
                $"/trips/{trip.Id}/destinations"
            )
        )!.Features.Single();
        Guid requestId = Guid.NewGuid();
        var started = await client.PostAsJsonAsync(
            $"/trips/{trip.Id}/destinations/{destination.Id}:suggest",
            new ActivitySuggestionRequest(
                requestId,
                "Find art museums",
                destination.Properties.ContextVersion
            )
        );
        Assert.AreEqual(HttpStatusCode.Accepted, started.StatusCode);
        Assert.IsTrue(
            await factory.Services.GetRequiredService<ActivityJobProcessor>().ProcessNextAsync()
        );
        var result = (
            await client.GetFromJsonAsync<ActivitySuggestionResult>(
                $"/trips/{trip.Id}/destinations/{destination.Id}/suggestions/{requestId}"
            )
        )!;
        var feature = result.Activities.Features.Single();
        Assert.AreEqual("Feature", feature.Type);
        Assert.AreEqual("Louvre", feature.Properties.Name);
        Assert.AreEqual(ActivityState.Proposed, feature.Properties.State);
        Assert.AreEqual("Point", feature.Geometry!.Type);
        Assert.IsNotNull(handler.Request);
        StringAssert.Contains(handler.Request, "Find art museums");
        var saved = (
            await client.GetFromJsonAsync<GeoJsonCollection<ActivityProperties>>(
                $"/trips/{trip.Id}/destinations/{destination.Id}/activities"
            )
        )!.Features.Single();
        Assert.AreEqual(feature.Id, saved.Id);
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
            new("Museum", null, "", null, ActivityState.Proposed)
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
                    new("Museum", null, "", null, ActivityState.Proposed) { Links = [new(url)] }
                )
            ),
        };
        create.Headers.Add("Destination-Context", destination.Properties.ContextVersion);
        Assert.AreEqual(HttpStatusCode.BadRequest, (await client.SendAsync(create)).StatusCode);
    }

    [TestMethod]
    [DataRow(true, false, false, false, true)]
    [DataRow(false, true, false, true, true)]
    [DataRow(false, false, false, true, true)]
    [DataRow(false, false, true, true, true)]
    [DataRow(true, false, false, false, false)]
    [DataRow(false, true, false, true, false)]
    [DataRow(false, false, false, true, false)]
    [DataRow(false, false, true, true, false)]
    public async Task ActivityJobs_ResearchOnlyUnresolvedActivitiesAndRequireMapVerification(
        bool initiallyResolved,
        bool verifiesVenue,
        bool researchFails,
        bool expectedResearch,
        bool imageImport
    )
    {
        var research = new StubVenueResearch(researchFails);
        var resolver = new ResearchPlaceResolver(initiallyResolved, verifiesVenue);
        var coordinates = new StubCoordinateResearch();
        await using var factory = new TestApplicationFactory
        {
            ActivityAssistant = new StubAssistant(),
            ActivityPlaceResolver = resolver,
            ActivityVenueResearch = research,
            ActivityCoordinateResearch = coordinates,
        };
        using var client = factory.CreateClient();
        (Trip trip, Guid owner, Guid party) = await CreateTrip(client, factory);
        await factory.Database.SetUserFeatureFlagsAsync(owner, "LLM");
        await AddDestinations(client, trip, false);
        var destination = (
            await client.GetFromJsonAsync<GeoJsonCollection<DestinationProperties>>(
                $"/trips/{trip.Id}/destinations"
            )
        )!.Features.Single();
        byte[] image =
        [
            137,
            80,
            78,
            71,
            13,
            10,
            26,
            10,
            0,
            0,
            0,
            13,
            73,
            72,
            68,
            82,
            0,
            0,
            0,
            10,
            0,
            0,
            0,
            10,
        ];
        Guid requestId = Guid.NewGuid();
        using var form = ImageForm(requestId, destination.Properties.ContextVersion, image);
        using var started = imageImport
            ? await client.PostAsync($"/trips/{trip.Id}/destinations/{destination.Id}:import", form)
            : await client.PostAsJsonAsync(
                $"/trips/{trip.Id}/destinations/{destination.Id}:suggest",
                new ActivitySuggestionRequest(
                    requestId,
                    "Museum",
                    destination.Properties.ContextVersion
                )
            );
        Assert.AreEqual(HttpStatusCode.Accepted, started.StatusCode);
        await factory.Services.GetRequiredService<ActivityJobProcessor>().ProcessNextAsync();
        var result = (
            await client.GetFromJsonAsync<ActivitySuggestionResult>(
                $"/trips/{trip.Id}/destinations/{destination.Id}/suggestions/{requestId}"
            )
        )!;
        Assert.HasCount(1, result.Activities.Features);
        var activity = result.Activities.Features.Single();
        Assert.AreEqual(expectedResearch ? 1 : 0, research.Calls);
        if (expectedResearch && !imageImport)
        {
            Assert.AreEqual("Museum", research.Prompt);
        }

        Assert.AreEqual(initiallyResolved || verifiesVenue, activity.Geometry is not null);
        Assert.AreEqual(initiallyResolved || verifiesVenue ? 0 : 1, coordinates.Calls);
        Assert.AreEqual("Museum visit", activity.Properties.Name);
        Assert.AreEqual("Explore the galleries", activity.Properties.Description);
        Assert.AreEqual(TimeSpan.FromHours(2), activity.Properties.Duration);
        Assert.AreEqual(ActivityState.Proposed, activity.Properties.State);
        Assert.HasCount(expectedResearch && !researchFails ? 1 : 0, activity.Properties.Links);
        if (expectedResearch && !researchFails)
        {
            Assert.AreEqual("https://museum.test/event", activity.Properties.Links[0].Url);
            Assert.AreEqual("1 Main Street", resolver.LastAddress);
            Assert.AreEqual("Grand Museum, 1 Main Street", activity.Properties.PlaceName);
            Assert.AreEqual("Museum", resolver.LastPlace);
        }
        if (!initiallyResolved && !verifiesVenue)
        {
            Assert.AreEqual(1, coordinates.Calls);
            Assert.IsNotNull(activity.Properties.LocationSuggestion);
            Assert.IsTrue(result.Warnings.Any(w => w.Contains("Review the suggested location")));
        }
    }

    [TestMethod]
    [DataRow(true, false, false, 200)]
    [DataRow(false, false, false, 403)]
    [DataRow(true, true, false, 412)]
    [DataRow(true, false, true, 502)]
    public async Task LocationResearch_IsPreviewOnlyAndRequiresCurrentVersionAndLlm(
        bool llm,
        bool stale,
        bool providerFails,
        int expectedStatus
    )
    {
        var research = new StubCoordinateResearch(providerFails);
        await using var factory = new TestApplicationFactory
        {
            ActivityCoordinateResearch = research,
        };
        using var client = factory.CreateClient();
        var (trip, owner, _) = await CreateTrip(client, factory);
        if (llm)
        {
            await factory.Database.SetUserFeatureFlagsAsync(owner, "LLM");
        }
        await AddDestinations(client, trip, false);
        var destination = (
            await client.GetFromJsonAsync<GeoJsonCollection<DestinationProperties>>(
                $"/trips/{trip.Id}/destinations"
            )
        )!.Features.Single();
        var now = DateTimeOffset.UtcNow;
        var activity = new Activity(
            Guid.NewGuid(),
            trip.Id,
            destination.Id,
            null,
            new("Museum", TimeSpan.FromHours(2), "Art", null, ActivityState.Proposed),
            now,
            now
        );
        await factory.Database.SaveActivityAsync(
            owner,
            activity,
            destination.Properties.ContextVersion,
            null
        );
        string resource =
            $"/trips/{trip.Id}/destinations/{destination.Id}/activities/{activity.Id}";
        using var detail = await client.GetAsync(resource);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            resource + "/location-proposals"
        );
        request.Headers.Add("Destination-Context", destination.Properties.ContextVersion);
        request.Headers.TryAddWithoutValidation(
            "If-Match",
            stale ? "\"1\"" : detail.Headers.ETag!.Tag
        );
        using var result = await client.SendAsync(request);
        Assert.AreEqual(expectedStatus, (int)result.StatusCode);
        Assert.AreEqual(llm && !stale ? 1 : 0, research.Calls);
        var unchanged = (
            await client.GetFromJsonAsync<GeoJsonFeature<ActivityProperties>>(resource)
        )!;
        Assert.IsNull(unchanged.Geometry);
        Assert.IsNull(unchanged.Properties.LocationSuggestion);
        if (expectedStatus == 200)
        {
            var response = await result.Content.ReadFromJsonAsync<JsonElement>();
            var suggestion = response
                .GetProperty("suggestion")
                .Deserialize<ActivityLocationSuggestion>(
                    new JsonSerializerOptions(JsonSerializerDefaults.Web)
                )!;
            Assert.AreEqual(research.Suggestion.Geometry.Position, suggestion.Geometry.Position);
            using var accept = new HttpRequestMessage(HttpMethod.Put, resource)
            {
                Content = JsonContent.Create(
                    new ActivityInput(
                        "Feature",
                        unchanged.Id,
                        suggestion.Geometry,
                        unchanged.Properties with
                        {
                            Links = [suggestion.Source],
                        }
                    )
                ),
            };
            accept.Headers.Add("Destination-Context", destination.Properties.ContextVersion);
            accept.Headers.TryAddWithoutValidation("If-Match", result.Headers.ETag!.Tag);
            Assert.AreEqual(HttpStatusCode.OK, (await client.SendAsync(accept)).StatusCode);
            var saved = (
                await client.GetFromJsonAsync<GeoJsonFeature<ActivityProperties>>(resource)
            )!;
            Assert.AreEqual(suggestion.Geometry.Position, saved.Geometry!.Position);
            Assert.AreEqual("Museum", saved.Properties.Name);
        }
    }

    [TestMethod]
    [DataRow(true, false, false, 200)]
    [DataRow(false, false, false, 403)]
    [DataRow(true, true, false, 412)]
    [DataRow(true, false, true, 502)]
    public async Task DetailsResearch_IsPreviewOnlyAndRequiresCurrentVersionAndLlm(
        bool llm,
        bool stale,
        bool providerFails,
        int expectedStatus
    )
    {
        var research = new TestActivityDetailsResearch(providerFails);
        await using var factory = new TestApplicationFactory { ActivityDetailsResearch = research };
        using var client = factory.CreateClient();
        var (trip, owner, _) = await CreateTrip(client, factory);
        if (llm)
        {
            await factory.Database.SetUserFeatureFlagsAsync(owner, "LLM");
        }
        await AddDestinations(client, trip, false);
        var destination = (
            await client.GetFromJsonAsync<GeoJsonCollection<DestinationProperties>>(
                $"/trips/{trip.Id}/destinations"
            )
        )!.Features.Single();
        var now = DateTimeOffset.UtcNow;
        var activity = new Activity(
            Guid.NewGuid(),
            trip.Id,
            destination.Id,
            null,
            new("Museum", TimeSpan.FromHours(2), "Art", null, ActivityState.Proposed),
            now,
            now
        );
        await factory.Database.SaveActivityAsync(
            owner,
            activity,
            destination.Properties.ContextVersion,
            null
        );
        string resource =
            $"/trips/{trip.Id}/destinations/{destination.Id}/activities/{activity.Id}";
        using var detail = await client.GetAsync(resource);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            resource + "/details-proposals"
        );
        request.Headers.Add("Destination-Context", destination.Properties.ContextVersion);
        request.Headers.TryAddWithoutValidation(
            "If-Match",
            stale ? "\"1\"" : detail.Headers.ETag!.Tag
        );
        using var result = await client.SendAsync(request);
        Assert.AreEqual(expectedStatus, (int)result.StatusCode);
        Assert.AreEqual(llm && !stale ? 1 : 0, research.Calls);
        var unchanged = (
            await client.GetFromJsonAsync<GeoJsonFeature<ActivityProperties>>(resource)
        )!;
        Assert.AreEqual(TimeSpan.FromHours(2), unchanged.Properties.Duration);
        Assert.IsNull(unchanged.Properties.Cost);
        if (expectedStatus == 200)
        {
            var response = await result.Content.ReadFromJsonAsync<JsonElement>();
            var suggestion = response
                .GetProperty("suggestion")
                .Deserialize<ActivityDetailsSuggestion>(
                    new JsonSerializerOptions(JsonSerializerDefaults.Web)
                )!;
            Assert.AreEqual(TimeSpan.FromMinutes(90), suggestion.Duration!.Value);
            using var accept = new HttpRequestMessage(HttpMethod.Put, resource)
            {
                Content = JsonContent.Create(
                    new ActivityInput(
                        "Feature",
                        unchanged.Id,
                        unchanged.Geometry,
                        unchanged.Properties with
                        {
                            Cost = suggestion.Cost!.Value,
                            CostEvidence = suggestion.Cost.Evidence,
                        }
                    )
                ),
            };
            accept.Headers.Add("Destination-Context", destination.Properties.ContextVersion);
            accept.Headers.TryAddWithoutValidation("If-Match", result.Headers.ETag!.Tag);
            Assert.AreEqual(HttpStatusCode.OK, (await client.SendAsync(accept)).StatusCode);
            var saved = (
                await client.GetFromJsonAsync<GeoJsonFeature<ActivityProperties>>(resource)
            )!;
            Assert.AreEqual(
                TimeSpan.FromHours(2),
                saved.Properties.Duration,
                "Accepting cost must not also accept duration."
            );
            Assert.AreEqual(suggestion.Cost.Value, saved.Properties.Cost);
            Assert.AreEqual(suggestion.Cost.Evidence, saved.Properties.CostEvidence);
            Assert.AreEqual("Art", saved.Properties.Description);
        }
    }

    private sealed class StubCoordinateResearch(bool fails = false) : IActivityCoordinateResearch
    {
        public int Calls { get; private set; }
        public ActivityLocationSuggestion Suggestion { get; } =
            new(
                "Museum",
                new("Point", GeographyPoint.Create(48.86, 2.34)),
                new("https://www.wikidata.org/wiki/Q19675", "Published coordinates"),
                DateTimeOffset.UtcNow
            );

        public Task<ActivityLocationSuggestion?> FindAsync(
            ActivityCandidate activity,
            string city,
            GeoJsonPoint center,
            CancellationToken cancellationToken
        )
        {
            Calls++;
            if (fails)
            {
                throw new HttpRequestException("Source unavailable");
            }
            return Task.FromResult<ActivityLocationSuggestion?>(Suggestion);
        }
    }

    private sealed class StubVenueResearch(bool fails) : IActivityVenueResearch
    {
        public int Calls { get; private set; }
        public string? Prompt { get; private set; }

        public Task<ActivityVenue?> FindAsync(
            ActivityCandidate activity,
            string city,
            string countryCode,
            IReadOnlyList<DestinationStay> stays,
            CancellationToken cancellationToken,
            string userPrompt = ""
        )
        {
            Calls++;
            Prompt = userPrompt;
            if (fails)
            {
                throw new HttpRequestException("Search unavailable");
            }

            return Task.FromResult<ActivityVenue?>(
                new(
                    "Grand Museum",
                    "1 Main Street",
                    new("https://museum.test/event", "Venue source")
                )
            );
        }
    }

    private sealed class ResearchPlaceResolver(bool initiallyResolved, bool verifiesVenue)
        : IActivityPlaceResolver
    {
        public string? LastPlace { get; private set; }
        public string? LastAddress { get; private set; }

        public Task<GeoJsonPoint?> ResolveAddressAsync(
            string address,
            string city,
            string countryCode,
            CancellationToken cancellationToken,
            GeoJsonPoint? center = null
        )
        {
            LastAddress = address;
            return Task.FromResult<GeoJsonPoint?>(
                verifiesVenue
                    ? new("Point", GeographyPoint.Create(latitude: 48.86, longitude: 2.33))
                    : null
            );
        }

        public Task<GeoJsonPoint?> ResolveAsync(
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

    private sealed class StubAssistant(string? placeName = "Museum") : IActivityAssistant
    {
        public int Calls { get; private set; }
        public IReadOnlyList<ActivityImage> Images { get; private set; } = [];

        public Task<IReadOnlyList<ActivityCandidate>> SuggestAsync(
            string city,
            string countryCode,
            IReadOnlyList<DestinationStay> stays,
            string input,
            IReadOnlyList<ActivityImage> images,
            CancellationToken cancellationToken
        )
        {
            Calls++;
            Images = images;
            return Task.FromResult<IReadOnlyList<ActivityCandidate>>([
                new(
                    "Museum visit",
                    placeName,
                    TimeSpan.FromHours(2),
                    "Explore the galleries",
                    null,
                    null,
                    null,
                    null,
                    null
                ),
            ]);
        }
    }
}
