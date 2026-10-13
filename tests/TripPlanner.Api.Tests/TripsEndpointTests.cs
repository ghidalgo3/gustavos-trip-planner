using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Tests;

[TestClass]
public class TripsEndpointTests
{
    [TestMethod]
    public async Task CanonicalCrud_ReplacesTripConstraintsIndependentlyOfFlightPlanning()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        AddPrincipal(client, "ada@example.com");
        var user = await CompleteOnboardingAsync(client);
        var created = await client.PostAsJsonAsync(
            "/trips",
            new CreateTripRequest(
                "Europe",
                "Museums",
                JsonSerializer.SerializeToElement(new { budget = 5000 })
            )
        );
        Assert.AreEqual(HttpStatusCode.Created, created.StatusCode);
        var trip = (await created.Content.ReadFromJsonAsync<Trip>())!;
        string url = $"/trips/{trip.Id}";
        Assert.AreEqual(url, created.Headers.Location?.ToString());
        Assert.AreEqual(5000, trip.Constraints.GetProperty("budget").GetInt32());
        Assert.HasCount(1, (await client.GetFromJsonAsync<Trip[]>("/trips"))!);
        var flightDocument = new PlanningDocument { AiPrompt = "Prefer morning flights" };
        Assert.AreEqual(
            HttpStatusCode.OK,
            (await client.PutAsJsonAsync($"{url}/flights/constraints", flightDocument)).StatusCode
        );
        Assert.AreEqual(
            5000,
            (await client.GetFromJsonAsync<Trip>(url))!.Constraints.GetProperty("budget").GetInt32()
        );
        var updated = await client.PutAsJsonAsync(
            url,
            new UpdateTripRequest(
                "France",
                "Art",
                JsonSerializer.SerializeToElement(new { accessible = true })
            )
        );
        Assert.AreEqual(HttpStatusCode.OK, updated.StatusCode);
        var response = (await updated.Content.ReadFromJsonAsync<JsonElement>());
        Assert.IsFalse(response.TryGetProperty("flightConstraints", out _));
        Assert.IsTrue(response.GetProperty("constraints").GetProperty("accessible").GetBoolean());
        Assert.IsFalse(response.GetProperty("constraints").TryGetProperty("budget", out _));
        Assert.AreEqual(
            "Prefer morning flights",
            (
                await client.GetFromJsonAsync<PlanningDocument>($"{url}/flights/constraints")
            )!.AiPrompt
        );
        await client.PutAsJsonAsync(url, new UpdateTripRequest("France", ""));
        Assert.IsEmpty((await client.GetFromJsonAsync<Trip>(url))!.Constraints.EnumerateObject());
        Assert.AreEqual(HttpStatusCode.NoContent, (await client.DeleteAsync(url)).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await client.GetAsync(url)).StatusCode);
    }

    [TestMethod]
    [DataRow("[]")]
    [DataRow("42")]
    [DataRow("\"text\"")]
    public async Task TripConstraints_RequireAnObject(string json)
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        AddPrincipal(client, "ada@example.com");
        await CompleteOnboardingAsync(client);
        var constraints = JsonSerializer.Deserialize<JsonElement>(json);
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PostAsJsonAsync(
                    "/trips",
                    new CreateTripRequest("Trip", "", constraints)
                )
            ).StatusCode
        );
        var created = (
            await (
                await client.PostAsJsonAsync("/trips", new CreateTripRequest("Trip", ""))
            ).Content.ReadFromJsonAsync<Trip>()
        )!;
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PutAsJsonAsync(
                    $"/trips/{created.Id}",
                    new UpdateTripRequest("Trip", "", constraints)
                )
            ).StatusCode
        );
    }

    [TestMethod]
    public async Task CanonicalRoutes_RequireAnAuthorizedTripMemberAndOwnerForWrites()
    {
        await using var factory = new TestApplicationFactory();
        using var ownerClient = factory.CreateClient();
        AddPrincipal(ownerClient, "ada@example.com");
        await CompleteOnboardingAsync(ownerClient);
        var trip = (
            await (
                await ownerClient.PostAsJsonAsync("/trips", new CreateTripRequest("Trip", ""))
            ).Content.ReadFromJsonAsync<Trip>()
        )!;
        using var stranger = factory.CreateClient();
        AddPrincipal(stranger, "other@example.com");
        await CompleteOnboardingAsync(stranger);
        string url = $"/trips/{trip.Id}";
        Assert.IsEmpty((await stranger.GetFromJsonAsync<Trip[]>("/trips"))!);
        Assert.AreEqual(HttpStatusCode.NotFound, (await stranger.GetAsync(url)).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await stranger.PutAsJsonAsync(url, new UpdateTripRequest("Changed", ""))).StatusCode
        );
        Assert.AreEqual(HttpStatusCode.NotFound, (await stranger.DeleteAsync(url)).StatusCode);
        using var anonymous = factory.CreateClient();
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await anonymous.GetAsync("/trips")).StatusCode
        );
    }

    [TestMethod]
    public async Task Crud_ManagesOwnedTripAndInitialParty()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        AddPrincipal(client, "ada@example.com");
        CurrentUserResponse user = await CompleteOnboardingAsync(client);
        string collectionUrl = $"/user/{user.Id}/trips";

        HttpResponseMessage createdResponse = await client.PostAsJsonAsync(
            collectionUrl,
            new CreateTripRequest("  Summer in Lisbon  ", "  Food and museums  ")
        );
        Trip? created = await createdResponse.Content.ReadFromJsonAsync<Trip>();

        Assert.AreEqual(HttpStatusCode.Created, createdResponse.StatusCode);
        Assert.IsNotNull(created);
        Assert.AreEqual("Summer in Lisbon", created.Name);
        Assert.AreEqual("Food and museums", created.Description);
        Assert.AreEqual(user.Id, created.OwnerUserId);
        Assert.AreEqual(0, created.Constraints.EnumerateObject().Count());
        Assert.AreEqual(
            $"/user/{user.Id}/trips/{created.Id}",
            createdResponse.Headers.Location?.ToString()
        );
        Party party = factory.Database.Parties.Single();
        Assert.AreEqual(created.Id, party.TripId);
        CollectionAssert.AreEqual(new[] { user.Id!.Value }, party.UserIds.ToArray());

        Trip[]? listed = await client.GetFromJsonAsync<Trip[]>(collectionUrl);
        Assert.IsNotNull(listed);
        Assert.HasCount(1, listed);
        Assert.AreEqual(created.Id, listed[0].Id);

        Trip? fetched = await client.GetFromJsonAsync<Trip>($"{collectionUrl}/{created.Id}");
        Assert.AreEqual(created.Id, fetched?.Id);

        HttpResponseMessage updatedResponse = await client.PutAsJsonAsync(
            $"{collectionUrl}/{created.Id}",
            new UpdateTripRequest("Lisbon and Porto", "Train between the cities")
        );
        Trip? updated = await updatedResponse.Content.ReadFromJsonAsync<Trip>();
        Assert.AreEqual(HttpStatusCode.OK, updatedResponse.StatusCode);
        Assert.AreEqual("Lisbon and Porto", updated?.Name);
        Assert.AreEqual("Train between the cities", updated?.Description);

        HttpResponseMessage deleted = await client.DeleteAsync($"{collectionUrl}/{created.Id}");
        Assert.AreEqual(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.IsEmpty(factory.Database.Trips);
        Assert.IsEmpty(factory.Database.Parties);
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await client.GetAsync($"{collectionUrl}/{created.Id}")).StatusCode
        );
    }

    [TestMethod]
    public async Task Trips_RequireAuthenticationAndCompletedOnboarding()
    {
        await using var factory = new TestApplicationFactory();
        using var anonymousClient = factory.CreateClient();
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await anonymousClient.GetAsync($"/user/{Guid.NewGuid()}/trips")).StatusCode
        );

        using var authenticatedClient = factory.CreateClient();
        AddPrincipal(authenticatedClient, "new@example.com");
        HttpResponseMessage unprovisionedResponse = await authenticatedClient.GetAsync(
            $"/user/{Guid.NewGuid()}/trips"
        );
        Assert.AreEqual(HttpStatusCode.Forbidden, unprovisionedResponse.StatusCode);
        Assert.IsEmpty(factory.Database.Users);

        CurrentUserResponse? user = await authenticatedClient.GetFromJsonAsync<CurrentUserResponse>(
            "/user"
        );
        Assert.IsNotNull(user?.Id);
        HttpResponseMessage response = await authenticatedClient.GetAsync($"/user/{user.Id}/trips");
        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
        StringAssert.Contains(await response.Content.ReadAsStringAsync(), "Complete onboarding");
    }

    [TestMethod]
    public async Task Trips_RejectAnotherUsersRouteAndHideAnotherUsersTrip()
    {
        await using var factory = new TestApplicationFactory();
        using var ownerClient = factory.CreateClient();
        AddPrincipal(ownerClient, "owner@example.com");
        CurrentUserResponse owner = await CompleteOnboardingAsync(ownerClient);
        Trip? trip = await (
            await ownerClient.PostAsJsonAsync(
                $"/user/{owner.Id}/trips",
                new CreateTripRequest("Owner trip", null)
            )
        ).Content.ReadFromJsonAsync<Trip>();
        Assert.IsNotNull(trip);

        using var otherClient = factory.CreateClient();
        AddPrincipal(otherClient, "other@example.com");
        CurrentUserResponse other = await CompleteOnboardingAsync(otherClient);

        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await otherClient.GetAsync($"/user/{owner.Id}/trips")).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await otherClient.GetAsync($"/user/{other.Id}/trips/{trip.Id}")).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (
                await otherClient.PutAsJsonAsync(
                    $"/user/{other.Id}/trips/{trip.Id}",
                    new UpdateTripRequest("Stolen", "")
                )
            ).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await otherClient.DeleteAsync($"/user/{other.Id}/trips/{trip.Id}")).StatusCode
        );
        Assert.HasCount(1, factory.Database.Trips);
    }

    [TestMethod]
    public async Task CreateAndUpdate_ValidateTripFields()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        AddPrincipal(client, "validation@example.com");
        CurrentUserResponse user = await CompleteOnboardingAsync(client);
        string collectionUrl = $"/user/{user.Id}/trips";

        HttpResponseMessage blankName = await client.PostAsJsonAsync(
            collectionUrl,
            new CreateTripRequest("   ", "Description")
        );
        Assert.AreEqual(HttpStatusCode.BadRequest, blankName.StatusCode);
        StringAssert.Contains(await blankName.Content.ReadAsStringAsync(), "Name");

        HttpResponseMessage longDescription = await client.PostAsJsonAsync(
            collectionUrl,
            new CreateTripRequest("Trip", new string('x', 4001))
        );
        Assert.AreEqual(HttpStatusCode.BadRequest, longDescription.StatusCode);
        StringAssert.Contains(await longDescription.Content.ReadAsStringAsync(), "Description");
    }

    [TestMethod]
    public async Task PartyMembership_IsOwnerManagedAndIdempotent()
    {
        await using var factory = new TestApplicationFactory();
        using var ownerClient = factory.CreateClient();
        AddPrincipal(ownerClient, "owner@example.com");
        CurrentUserResponse owner = await CompleteOnboardingAsync(ownerClient);
        Trip? trip = await (
            await ownerClient.PostAsJsonAsync(
                $"/user/{owner.Id}/trips",
                new CreateTripRequest("Paris", "")
            )
        ).Content.ReadFromJsonAsync<Trip>();
        Assert.IsNotNull(trip);
        Guid partyId = factory.Database.Parties.Single().Id;

        using var travelerClient = factory.CreateClient();
        AddPrincipal(travelerClient, "traveler@example.com");
        CurrentUserResponse traveler = (
            await (
                await travelerClient.PutAsJsonAsync(
                    "/user/profile",
                    new UserProfile(new("Seattle", -122.33, 47.61), [], "SEA")
                )
            ).Content.ReadFromJsonAsync<CurrentUserResponse>()
        )!;
        string memberUrl =
            $"/user/{owner.Id}/trips/{trip.Id}/parties/{partyId}/members/{traveler.Id}";

        UserSearchResult[]? found = await ownerClient.GetFromJsonAsync<UserSearchResult[]>(
            "/users?query=Test"
        );
        Assert.IsNotNull(found);
        Assert.HasCount(1, found);
        Assert.AreEqual(traveler.Id, found[0].Id);

        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await travelerClient.PutAsync(memberUrl, null)).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await ownerClient.PutAsync(memberUrl, null)).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await ownerClient.PutAsync(memberUrl, null)).StatusCode
        );
        CollectionAssert.AreEqual(
            new[] { owner.Id!.Value, traveler.Id!.Value },
            factory.Database.Parties.Single().UserIds.ToArray()
        );

        string sharedTripUrl = $"/trips/{trip.Id}";
        Trip[]? sharedTrips = await travelerClient.GetFromJsonAsync<Trip[]>("/trips");
        Assert.AreEqual(trip.Id, sharedTrips?.Single().Id);
        Assert.AreEqual(trip.Id, (await travelerClient.GetFromJsonAsync<Trip>(sharedTripUrl))?.Id);
        string destinationsUrl = $"/trips/{trip.Id}/destinations";
        var destinationInput = new CreateDestinationRequest(
            "Feature",
            new("Point", [2.35, 48.85]),
            new("Paris", "FR")
        );
        Assert.AreEqual(
            HttpStatusCode.Created,
            (await ownerClient.PostAsJsonAsync(destinationsUrl, destinationInput)).StatusCode
        );
        Assert.HasCount(
            1,
            (
                await travelerClient.GetFromJsonAsync<GeoJsonCollection<DestinationProperties>>(
                    destinationsUrl
                )
            )!.Features
        );
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await travelerClient.PostAsJsonAsync(destinationsUrl, destinationInput)).StatusCode
        );
        var replacement = new ReplaceDestinationRequest(
            "Feature",
            "paris-fr",
            destinationInput.Geometry,
            new("Paris", "FR")
        );
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (
                await travelerClient.PutAsJsonAsync($"{destinationsUrl}/paris-fr", replacement)
            ).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await travelerClient.DeleteAsync($"{destinationsUrl}/paris-fr")).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            (await travelerClient.GetAsync($"/trips/{trip.Id}/flights/constraints")).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await travelerClient.GetAsync($"/trips/{trip.Id}/flights")).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (
                await travelerClient.PutAsJsonAsync(
                    sharedTripUrl,
                    new UpdateTripRequest("Changed by member", "")
                )
            ).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await travelerClient.DeleteAsync(sharedTripUrl)).StatusCode
        );

        PlanningParty[]? parties = await ownerClient.GetFromJsonAsync<PlanningParty[]>(
            $"/trips/{trip.Id}/parties"
        );
        Assert.AreEqual("BOS", parties?.Single().SuggestedOrigin?.Code);

        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await ownerClient.DeleteAsync(memberUrl)).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await ownerClient.DeleteAsync(memberUrl)).StatusCode
        );
        CollectionAssert.AreEqual(
            new[] { owner.Id!.Value },
            factory.Database.Parties.Single().UserIds.ToArray()
        );
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await travelerClient.GetAsync(sharedTripUrl)).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await ownerClient.DeleteAsync(
                    $"/user/{owner.Id}/trips/{trip.Id}/parties/{partyId}/members/{owner.Id}"
                )
            ).StatusCode
        );
    }

    private static async Task<CurrentUserResponse> CompleteOnboardingAsync(HttpClient client)
    {
        HttpResponseMessage response = await client.PutAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Boston, Massachusetts, United States", -71.0589, 42.3601), [])
        );
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<CurrentUserResponse>()
            ?? throw new AssertFailedException("The onboarding response did not contain a user.");
    }

    private static void AddPrincipal(HttpClient client, string email)
    {
        client.DefaultRequestHeaders.Add("X-Test-Subject", $"subject-{email}");
        client.DefaultRequestHeaders.Add("X-Test-Provider", "google");
        client.DefaultRequestHeaders.Add("X-Test-Name", "Test Traveler");
        client.DefaultRequestHeaders.Add("X-Test-Email", email);
    }
}
