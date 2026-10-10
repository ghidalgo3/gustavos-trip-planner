using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Tests;

[TestClass]
public class ActivityEndpointTests
{
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
        Assert.AreEqual(2.3522, collection.Features[0].Geometry!.Coordinates[0]);
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
            new DestinationVisitInput("Paris", "FR", null, null, 181, 48.86)
        );
        Assert.AreEqual(HttpStatusCode.BadRequest, invalid.StatusCode);

        var response = await client.PostAsJsonAsync(
            url,
            new DestinationVisitInput("Paris", "FR", null, null, 2.3, 48.8)
        );
        Assert.AreEqual(HttpStatusCode.Created, response.StatusCode);
        var destination = (
            await response.Content.ReadFromJsonAsync<GeoJsonFeature<DestinationProperties>>()
        )!;
        CollectionAssert.AreEqual(new[] { 2.3, 48.8 }, destination.Geometry!.Coordinates);
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
        var illinois = new DestinationVisitInput(
            "Springfield",
            "US",
            null,
            null,
            -89.6501,
            39.7817
        );
        var massachusetts = new DestinationVisitInput(
            "Springfield",
            "US",
            null,
            null,
            -72.5898,
            42.1015
        );

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
    public async Task Activities_SaveWholeFeature_RequireActiveDestinationAndPreserveCustomState()
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
            new("Point", [2.3364, 48.8606]),
            new(
                "Museum visit",
                120,
                "Sculpture galleries",
                new(0, "EUR", "perPerson"),
                "Maybe",
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
        Assert.AreEqual("Maybe", created.Properties.State);
        Assert.AreEqual(0m, created.Properties.Cost!.Amount);
        string resource = $"{url}/{created.Id}";
        var detail = await client.GetAsync(resource);
        string etag = detail.Headers.ETag!.Tag;
        var updatedInput = input with
        {
            Id = created.Id,
            Properties = input.Properties with { Description = "Updated", State = "Custom" },
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
            "Custom",
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
    public async Task SuggestionJob_ImmediatelyCreatesProposedActivitiesOnlyOnce()
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
        Assert.AreEqual("Proposed", result.Activities.Features[0].Properties.State);
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
    public async Task ImageImport_RejectsUnknownFilesAndCreatesProposedActivity()
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
            Assert.AreEqual(
                HttpStatusCode.UnsupportedMediaType,
                (await client.PostAsync(url, invalid)).StatusCode
            );

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
        using (var form = ImageForm(requestId, destination.Properties.ContextVersion, image))
            Assert.AreEqual(
                HttpStatusCode.Accepted,
                (await client.PostAsync(url, form)).StatusCode
            );
        using (var retry = ImageForm(requestId, destination.Properties.ContextVersion, image))
            Assert.AreEqual(
                HttpStatusCode.Accepted,
                (await client.PostAsync(url, retry)).StatusCode
            );
        Assert.IsTrue(
            await factory.Services.GetRequiredService<ActivityJobProcessor>().ProcessNextAsync()
        );
        using (var retry = ImageForm(requestId, destination.Properties.ContextVersion, image))
            Assert.AreEqual(
                HttpStatusCode.Accepted,
                (await client.PostAsync(url, retry)).StatusCode
            );
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

    private static MultipartFormDataContent ImageForm(Guid requestId, string context, byte[] bytes)
    {
        var form = new MultipartFormDataContent();
        form.Add(new StringContent(requestId.ToString("D")), "requestId");
        form.Add(new StringContent(context), "destinationContext");
        form.Add(new ByteArrayContent(bytes), "image", "flyer.png");
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

    private static async Task AddDestinations(HttpClient client, Trip trip, bool repeat)
    {
        string url = $"/trips/{trip.Id}/destinations";
        Assert.AreEqual(
            HttpStatusCode.Created,
            (
                await client.PostAsJsonAsync(
                    url,
                    new DestinationVisitInput(
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
                        new DestinationVisitInput(
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
                        new DestinationVisitInput(
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

    private sealed class StubAssistant : IActivityAssistant
    {
        public int Calls { get; private set; }

        public Task<IReadOnlyList<ActivityCandidate>> SuggestAsync(
            string city,
            string countryCode,
            IReadOnlyList<DestinationStay> stays,
            string input,
            byte[]? image,
            string? imageMimeType,
            CancellationToken cancellationToken
        )
        {
            Calls++;
            return Task.FromResult<IReadOnlyList<ActivityCandidate>>([
                new(
                    "Museum visit",
                    "Museum",
                    120,
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
