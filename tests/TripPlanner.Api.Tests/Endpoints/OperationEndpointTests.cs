using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.Jobs;
using TripPlanner.Api.Tests.Support;
using static TripPlanner.Api.Tests.Support.OperationFixture;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class OperationEndpointTests
{
    [TestMethod]
    public async Task FlightSearchAndGenericOperationRoutes_AreAuthorizedAndUseSavedConstraints()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Subject", "ada");
        client.DefaultRequestHeaders.Add("X-Test-Email", "ada@example.com");
        var user = (
            await (
                await client.PutResourceAsJsonAsync(
                    "/user/profile",
                    new UserProfile(new("Boston", -71, 42), [])
                )
            ).Content.ReadFromJsonAsync<CurrentUserResponse>()
        )!;
        var trip = (
            await (
                await client.PostAsJsonAsync(
                    $"/user/{user.Id}/trips",
                    new CreateTripRequest("Paris", "")
                )
            ).Content.ReadFromJsonAsync<Trip>()
        )!;
        var party = factory.Database.Parties.Single();
        var document = new PlanningDocument
        {
            Destination = new("CDG", "Europe/Paris"),
            TravelDates = new(new(2030, 1, 5), new(2030, 1, 15)),
            Parties = [new() { PartyId = party.Id, Origin = new("BOS", "America/New_York") }],
        };
        Assert.AreEqual(
            HttpStatusCode.OK,
            (
                await client.PutResourceAsJsonAsync(
                    $"/trips/{trip.Id}/flights/constraints",
                    document
                )
            ).StatusCode
        );
        var path = $"/trips/{trip.Id}/flights/search";
        Assert.AreEqual(HttpStatusCode.NotFound, (await client.GetAsync(path)).StatusCode);
        var request = new StartFlightSearchRequest(Guid.NewGuid());
        var response = await client.PostAsJsonAsync($"/trips/{trip.Id}/flights:search", request);
        Assert.AreEqual(HttpStatusCode.Accepted, response.StatusCode);
        var operation = (await response.Content.ReadFromJsonAsync<TrackedOperation>())!;
        Assert.AreEqual("/operations/" + operation.Id, operation.PollingUrl);
        Assert.AreEqual(operation.PollingUrl, response.Headers.Location!.ToString());
        Assert.AreEqual(OperationState.FlightSearch, operation.Type);

        var listed = (
            await client.GetFromJsonAsync<TrackedOperation[]>(
                "/operations?top=1&skip=0&type=flightSearch"
            )
        )!;
        Assert.HasCount(1, listed);
        Assert.AreEqual(operation.Id, listed[0].Id);
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (await client.GetAsync("/operations?top=0")).StatusCode
        );
        Assert.AreEqual(
            operation.Id,
            (await client.GetFromJsonAsync<TrackedOperation>(operation.PollingUrl))!.Id
        );

        var worker = new PlanningWorker(
            factory.Database,
            new FakeIgnav(SampleItineraryResponse),
            Microsoft.Extensions.Options.Options.Create(new IgnavOptions()),
            Microsoft.Extensions.Options.Options.Create(new PlanningOptions()),
            TimeProvider.System,
            NullLogger<PlanningWorker>.Instance,
            null
        );
        while (await worker.ProcessNextAsync()) { }
        using (var fareResponse = await client.GetAsync(path))
        using (var json = JsonDocument.Parse(await fareResponse.Content.ReadAsStringAsync()))
        {
            Assert.AreEqual(HttpStatusCode.OK, fareResponse.StatusCode);
            Assert.AreEqual(
                "Eligible",
                json.RootElement[0].GetProperty("evaluations")[0].GetProperty("status").GetString()
            );
        }
        var evaluated = await client.GetFromJsonAsync<EvaluatedFareSearchResultDto[]>(path);
        Assert.HasCount(1, evaluated!);
        Assert.AreEqual("Eligible", evaluated![0].Evaluations[0].Status);

        var selectionPath = $"/trips/{trip.Id}/flights";
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await client.GetAsync(selectionPath)).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PutResourceAsJsonAsync(
                    $"{selectionPath}/{party.Id}",
                    new SelectFlightRequest(null, null)
                )
            ).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (
                await client.PutResourceAsJsonAsync(
                    $"{selectionPath}/{party.Id}",
                    new SelectFlightRequest(evaluated[0].CacheKey, 99)
                )
            ).StatusCode
        );
        var firstSelection = await client.PutResourceAsJsonAsync(
            $"{selectionPath}/{party.Id}",
            new SelectFlightRequest(evaluated[0].CacheKey, 0)
        );
        Assert.AreEqual(HttpStatusCode.OK, firstSelection.StatusCode);
        Assert.AreEqual(
            "fare-1",
            (await firstSelection.Content.ReadFromJsonAsync<SelectedFlight>())!
                .Itinerary.GetProperty("ignav_id")
                .GetString()
        );
        var replacement = await client.PutResourceAsJsonAsync(
            $"{selectionPath}/{party.Id}",
            new SelectFlightRequest(evaluated[0].CacheKey, 1)
        );
        Assert.AreEqual(HttpStatusCode.OK, replacement.StatusCode);
        var saved = (await client.GetFromJsonAsync<SelectedFlight[]>(selectionPath))!;
        Assert.HasCount(1, saved);
        Assert.AreEqual(1, saved[0].ItineraryIndex);
        Assert.AreEqual("fare-2", saved[0].Itinerary.GetProperty("ignav_id").GetString());
        CollectionAssert.AreEqual(new[] { false, false }, saved[0].PurchasedLegs);
        var purchasesPath = $"{selectionPath}/{party.Id}/purchases";
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PutResourceAsJsonAsync(
                    purchasesPath,
                    new SetFlightPurchasesRequest(evaluated[0].CacheKey, 1, [true])
                )
            ).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (
                await client.PutResourceAsJsonAsync(
                    purchasesPath,
                    new SetFlightPurchasesRequest(evaluated[0].CacheKey, 0, [true, false])
                )
            ).StatusCode
        );
        var purchaseResponse = await client.PutResourceAsJsonAsync(
            purchasesPath,
            new SetFlightPurchasesRequest(evaluated[0].CacheKey, 1, [true, false])
        );
        Assert.AreEqual(HttpStatusCode.OK, purchaseResponse.StatusCode);
        CollectionAssert.AreEqual(
            new[] { true, false },
            (await client.GetFromJsonAsync<SelectedFlight[]>(selectionPath))![0].PurchasedLegs
        );

        var stay = new PlanningConstraint
        {
            Id = Guid.NewGuid(),
            UserId = user.Id!.Value,
            Type = "presence",
            StartDate = new(2030, 1, 5),
            EndDate = new(2030, 1, 10),
        };
        Assert.AreEqual(
            HttpStatusCode.OK,
            (
                await client.PutResourceAsJsonAsync(
                    $"/trips/{trip.Id}/flights/constraints",
                    document with
                    {
                        Constraints = [stay],
                    }
                )
            ).StatusCode
        );
        evaluated = await client.GetFromJsonAsync<EvaluatedFareSearchResultDto[]>(path);
        Assert.HasCount(1, evaluated!);
        Assert.AreEqual("Rejected", evaluated![0].Evaluations[0].Status);
        Assert.AreEqual("presence", evaluated[0].Evaluations[0].Issues.Single().Code);
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (
                await client.PutResourceAsJsonAsync(
                    $"{selectionPath}/{party.Id}",
                    new SelectFlightRequest(evaluated[0].CacheKey, 0)
                )
            ).StatusCode
        );
        Assert.AreEqual(
            1,
            (await client.GetFromJsonAsync<SelectedFlight[]>(selectionPath))![0].ItineraryIndex
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await client.DeleteResourceAsync($"{selectionPath}/{party.Id}")).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await client.DeleteResourceAsync($"{selectionPath}/{party.Id}")).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await client.GetAsync(selectionPath)).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (
                await client.PostAsJsonAsync(
                    $"/trips/{trip.Id}/flights/search/{evaluated[0].CacheKey}/bookingLinks",
                    new BookingLinksRequest("fare-1")
                )
            ).StatusCode
        );

        using var anonymous = factory.CreateClient();
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(path)).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await anonymous.GetAsync(operation.PollingUrl)).StatusCode
        );
        using var other = factory.CreateClient();
        other.DefaultRequestHeaders.Add("X-Test-Subject", "other");
        other.DefaultRequestHeaders.Add("X-Test-Email", "other@example.com");
        await other.PutResourceAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Seattle", -122, 47), [], "SEA")
        );
        Assert.AreEqual(HttpStatusCode.NotFound, (await other.GetAsync(path)).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await other.GetAsync(selectionPath)).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await other.GetAsync(operation.PollingUrl)).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PostAsJsonAsync(
                    $"/trips/{trip.Id}/flights:search",
                    new StartFlightSearchRequest(Guid.Empty)
                )
            ).StatusCode
        );
    }
}
