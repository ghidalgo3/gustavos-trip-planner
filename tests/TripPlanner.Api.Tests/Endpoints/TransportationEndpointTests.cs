using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Services.Documents;
using TripPlanner.Api.Services.Maps;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class TransportationEndpointTests
{
    [TestMethod]
    [DataRow(PartyRole.Planner, HttpStatusCode.Created)]
    [DataRow(PartyRole.Traveller, HttpStatusCode.Forbidden)]
    public async Task OnlyPlannersCanCreateTransportation(PartyRole role, HttpStatusCode expected)
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await TripDocumentFixture.Seed(factory, client);
        var owner = await factory.Database.GetOrCreateUserAsync(
            new("google", "trip-owner@example.com", "Owner")
        );
        var trip = await factory.Database.CreateTripAsync(owner.Id, "Shared journey", "");
        var party = (await factory.Database.GetPartiesAsync(owner.Id, trip.Id)).Single();
        await factory.Database.ChangePartyMemberAsync(
            owner.Id,
            trip.Id,
            party.Id,
            user.Id,
            true,
            role: role
        );
        using var result = await client.PostAsJsonAsync(
            $"/trips/{trip.Id}/transportation",
            TransportationFixture.Journey(),
            TripResourceProjection.JsonOptions
        );
        Assert.AreEqual(expected, result.StatusCode);
        Assert.AreEqual(
            HttpStatusCode.OK,
            (await client.GetAsync($"/trips/{trip.Id}/transportation")).StatusCode
        );
    }

    [TestMethod]
    public async Task JourneyIsAnIndividualVersionedFeatureCollectionAndCalendarItem()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await TripDocumentFixture.Seed(factory, client);
        var trip = await factory.Database.CreateTripAsync(user.Id, "Rail journey", "");
        var path = $"/trips/{trip.Id}/transportation";
        var request = TransportationFixture.Journey(
            TransportationFixture.Reference("from", "home", user.Id),
            route: true
        );
        using var created = await client.PostAsJsonAsync(
            path,
            request,
            TripResourceProjection.JsonOptions
        );
        Assert.AreEqual(
            HttpStatusCode.Created,
            created.StatusCode,
            await created.Content.ReadAsStringAsync()
        );
        var saved = (
            await created.Content.ReadFromJsonAsync<Transportation>(
                TripResourceProjection.JsonOptions
            )
        )!;
        Assert.AreEqual("FeatureCollection", saved.Type);
        Assert.AreEqual(request.Notes, saved.Notes);
        Assert.AreEqual("Boston", saved.Features.Single(f => f.Id == "from").Properties.Name);
        Assert.AreEqual("LineString", saved.Features.Single(f => f.Id == "step-1").Geometry!.Type);
        var itemPath = created.Headers.Location!.ToString();
        using var missing = await client.PutAsJsonAsync(
            itemPath,
            request,
            TripResourceProjection.JsonOptions
        );
        Assert.AreEqual((HttpStatusCode)428, missing.StatusCode);
        var timed = request with
        {
            DepartureDate = new(2030, 4, 1),
            DepartureTime = new(9, 0),
            TimeZone = "America/New_York",
        };
        using var update = new HttpRequestMessage(HttpMethod.Put, itemPath)
        {
            Content = JsonContent.Create(timed, options: TripResourceProjection.JsonOptions),
        };
        update.Headers.IfMatch.Add(created.Headers.ETag!);
        using var updated = await client.SendAsync(update);
        Assert.AreEqual(
            HttpStatusCode.OK,
            updated.StatusCode,
            await updated.Content.ReadAsStringAsync()
        );
        Assert.AreNotEqual(created.Headers.ETag, updated.Headers.ETag);
        using var stale = new HttpRequestMessage(HttpMethod.Delete, itemPath);
        stale.Headers.IfMatch.Add(created.Headers.ETag!);
        Assert.AreEqual(
            HttpStatusCode.PreconditionFailed,
            (await client.SendAsync(stale)).StatusCode
        );
        var document = await client.GetFromJsonAsync<JsonElement>($"/trips/{trip.Id}/document");
        var item = document
            .GetProperty("itinerary")
            .GetProperty("items")
            .EnumerateArray()
            .Single(i => i.GetProperty("id").GetString() == saved.Id.ToString());
        Assert.AreEqual("transportation", item.GetProperty("kind").GetString());
        Assert.AreEqual("event", item.GetProperty("type").GetString());
        Assert.AreEqual(
            "FeatureCollection",
            item.GetProperty("transportation").GetProperty("type").GetString()
        );
        Assert.AreEqual(
            request.Notes,
            item.GetProperty("transportation").GetProperty("notes").GetString()
        );
    }

    [TestMethod]
    [DataRow("activity")]
    [DataRow("hotel")]
    [DataRow("home")]
    [DataRow("airport")]
    public async Task UnknownReferencesAreRejectedWithoutWriting(string kind)
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await TripDocumentFixture.Seed(factory, client);
        var trip = await factory.Database.CreateTripAsync(user.Id, "Trip", "");
        var request = TransportationFixture.Journey(
            TransportationFixture.Reference("from", kind, Guid.NewGuid())
        );
        using var result = await client.PostAsJsonAsync(
            $"/trips/{trip.Id}/transportation",
            request,
            TripResourceProjection.JsonOptions
        );
        Assert.AreEqual(HttpStatusCode.BadRequest, result.StatusCode);
        Assert.IsEmpty(await factory.Database.GetTransportationAsync(user.Id, trip.Id));
    }

    [TestMethod]
    [DataRow("missing-to")]
    [DataRow("duplicate-id")]
    [DataRow("invalid-point")]
    [DataRow("duplicate-sequence")]
    public async Task EndpointAndRouteInvariantsAreValidated(string invalid)
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await TripDocumentFixture.Seed(factory, client);
        var trip = await factory.Database.CreateTripAsync(user.Id, "Trip", "");
        var request = TransportationFixture.Journey(route: true);
        request = invalid switch
        {
            "missing-to" => request with
            {
                Features = request.Features.Where(f => f.Id != "to").ToArray(),
            },
            "duplicate-id" => request with
            {
                Features = [.. request.Features, request.Features[0]],
            },
            "invalid-point" => request with
            {
                Features =
                [
                    TransportationFixture.Point("from") with
                    {
                        Geometry = new(
                            "Point",
                            JsonSerializer.SerializeToElement(new[] { 181, 0 })
                        ),
                    },
                    .. request.Features.Skip(1),
                ],
            },
            _ => request with
            {
                Features = [.. request.Features, request.Features[2] with { Id = "step-2" }],
            },
        };
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PostAsJsonAsync(
                    $"/trips/{trip.Id}/transportation",
                    request,
                    TripResourceProjection.JsonOptions
                )
            ).StatusCode
        );
    }

    [TestMethod]
    public async Task TrainConnectsAVisitAndKeepsOffsetTimesAndRichRouteWhenEdited()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, _, _) = await ActivityPlanningFixture.Seed(factory, client);
        var visit = (await factory.Database.GetDestinationVisitsAsync(user.Id, trip.Id)).First();
        var request = TransportationFixture.Journey(route: true) with
        {
            Mode = "train",
            DestinationStayId = visit.StayId,
            DepartureAt = DateTimeOffset.Parse("2030-04-01T09:00:00+02:00"),
            ArrivalAt = DateTimeOffset.Parse("2030-04-01T10:30:00+01:00"),
        };
        var path = $"/trips/{trip.Id}/transportation";
        using var response = await client.PostAsJsonAsync(
            path,
            request,
            TripResourceProjection.JsonOptions
        );
        Assert.AreEqual(
            HttpStatusCode.Created,
            response.StatusCode,
            await response.Content.ReadAsStringAsync()
        );
        var value = (
            await response.Content.ReadFromJsonAsync<Transportation>(
                TripResourceProjection.JsonOptions
            )
        )!;
        Assert.AreEqual(visit.StayId, value.DestinationStayId);
        Assert.AreEqual(TimeSpan.FromMinutes(150), value.Duration);
        Assert.AreEqual(request.DepartureAt, value.DepartureAt);
        using var update = new HttpRequestMessage(HttpMethod.Put, $"{path}/{value.Id}")
        {
            Content = JsonContent.Create(
                request with
                {
                    Notes = "Platform 4",
                },
                options: TripResourceProjection.JsonOptions
            ),
        };
        update.Headers.IfMatch.Add(response.Headers.ETag!);
        using var saved = await client.SendAsync(update);
        var edited = (
            await saved.Content.ReadFromJsonAsync<Transportation>(
                TripResourceProjection.JsonOptions
            )
        )!;
        Assert.AreEqual(
            "Airport express",
            edited.Features.Single(f => f.Id == "step-1").Properties.Line
        );
        Assert.AreEqual(request.ArrivalAt, edited.ArrivalAt);
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (
                await client.PostAsJsonAsync(path, request, TripResourceProjection.JsonOptions)
            ).StatusCode
        );
    }

    [TestMethod]
    [DataRow("unknown-visit")]
    [DataRow("arrival-before-departure")]
    [DataRow("arrival-without-departure")]
    public async Task InvalidVisitOrTrainTimesAreRejected(string invalid)
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await TripDocumentFixture.Seed(factory, client);
        var trip = await factory.Database.CreateTripAsync(user.Id, "Trip", "");
        var request = TransportationFixture.Journey() with
        {
            OriginStayId = invalid == "unknown-visit" ? Guid.NewGuid() : null,
            DepartureAt =
                invalid == "arrival-without-departure"
                    ? null
                    : DateTimeOffset.Parse("2030-04-01T12:00:00Z"),
            ArrivalAt = DateTimeOffset.Parse("2030-04-01T11:00:00Z"),
        };
        var response = await client.PostAsJsonAsync(
            $"/trips/{trip.Id}/transportation",
            request,
            TripResourceProjection.JsonOptions
        );
        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.IsEmpty(await factory.Database.GetTransportationAsync(user.Id, trip.Id));
    }

    [TestMethod]
    [DataRow("car", "driving", false)]
    [DataRow("walk", "walking", false)]
    [DataRow("car", "driving", true)]
    [DataRow("walk", "walking", true)]
    public async Task GroundTransportationUsesAzureMapsWithoutCreatingAResource(
        string mode,
        string providerMode,
        bool includeGeometry
    )
    {
        var maps = new TransportMaps();
        await using var factory = new TestApplicationFactory { MapsClient = maps };
        using var client = factory.CreateClient();
        var user = await TripDocumentFixture.Seed(factory, client);
        var trip = await factory.Database.CreateTripAsync(user.Id, "Trip", "");
        var response = await client.PostAsJsonAsync(
            $"/trips/{trip.Id}/transportation/estimate",
            new
            {
                from = new { type = "Point", coordinates = new[] { 2.3, 48.8 } },
                to = new { type = "Point", coordinates = new[] { 2.4, 48.9 } },
                mode,
                departureAt = "2030-04-01T12:00:00Z",
                includeGeometry,
            }
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            response.StatusCode,
            await response.Content.ReadAsStringAsync()
        );
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.AreEqual("PT46M", body.GetProperty("duration").GetString());
        Assert.AreEqual(providerMode, maps.Mode);
        Assert.AreEqual(includeGeometry ? providerMode : null, maps.RouteMode);
        if (includeGeometry)
        {
            Assert.AreEqual(
                "MultiLineString",
                body.GetProperty("geometry").GetProperty("type").GetString()
            );
            Assert.AreEqual(
                2.3,
                body.GetProperty("geometry").GetProperty("coordinates")[0][0][0].GetDouble()
            );
        }
        Assert.IsEmpty(await factory.Database.GetTransportationAsync(user.Id, trip.Id));
    }

    private sealed class TransportMaps : AzureMapsStub
    {
        public string? Mode { get; private set; }
        public string? RouteMode { get; private set; }

        public override Task<ActivityRoutePath?> RouteAsync(
            GeographyPoint from,
            GeographyPoint to,
            DateTimeOffset departure,
            string mode,
            CancellationToken cancellationToken
        )
        {
            RouteMode = mode;
            return Task.FromResult<ActivityRoutePath?>(
                new(
                    "MultiLineString",
                    [
                        [
                            [from.Longitude, from.Latitude],
                            [to.Longitude, to.Latitude],
                        ],
                    ]
                )
            );
        }

        public override Task<MapRouteEstimate?> EstimateRouteAsync(
            GeographyPoint from,
            GeographyPoint to,
            DateTimeOffset departure,
            string mode,
            PlanningProviderBudget budget,
            CancellationToken cancellationToken
        )
        {
            Mode = mode;
            return Task.FromResult<MapRouteEstimate?>(
                new(TimeSpan.FromSeconds(45 * 60 + 10), DateTimeOffset.UtcNow, null)
            );
        }
    }
}
