using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Documents;
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
}
