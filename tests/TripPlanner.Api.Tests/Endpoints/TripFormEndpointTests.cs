using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.TripForms;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public class TripFormEndpointTests
{
    [TestMethod]
    public async Task Proposal_RequiresFeatureFlagAndReturnsUnsavedDraft()
    {
        var assistant = new StubAssistant();
        await using var factory = new TestApplicationFactory { FormAssistant = assistant };
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Subject", "form-subject");
        client.DefaultRequestHeaders.Add("X-Test-Provider", "google");
        client.DefaultRequestHeaders.Add("X-Test-Name", "Ada");
        client.DefaultRequestHeaders.Add("X-Test-Email", "form@example.com");
        CurrentUserResponse user = (await client.GetFromJsonAsync<CurrentUserResponse>("/user"))!;
        await client.PutAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Boston", -71.0589, 42.3601), [])
        );
        Trip trip = (
            await (
                await client.PostAsJsonAsync(
                    $"/user/{user.Id}/trips",
                    new CreateTripRequest("Paris", "")
                )
            ).Content.ReadFromJsonAsync<Trip>()
        )!;
        string url = $"/trips/{trip.Id}/flights:prompt";
        var draft = new PlanningDocument();
        Guid requestId = Guid.NewGuid();
        string proposalUrl = $"/trips/{trip.Id}/flights/prompts/{requestId}";
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (
                await client.PostAsJsonAsync(
                    url,
                    new
                    {
                        requestId,
                        input = "Paris in June",
                        constraints = draft,
                    }
                )
            ).StatusCode
        );
        Assert.AreEqual(0, assistant.Calls);

        await factory.Database.SetUserFeatureFlagsAsync(user.Id!.Value, "LLM");
        CurrentUserResponse enabled = (
            await client.GetFromJsonAsync<CurrentUserResponse>("/user")
        )!;
        CollectionAssert.Contains(enabled.FeatureFlags!, "LLM");
        HttpResponseMessage response = await client.PostAsJsonAsync(
            url,
            new
            {
                requestId,
                input = "Paris in June",
                constraints = draft,
            }
        );
        Assert.AreEqual(HttpStatusCode.Accepted, response.StatusCode);
        TrackedOperation? operation = await response.Content.ReadFromJsonAsync<TrackedOperation>();
        Assert.AreEqual("tripFormFill", operation?.Type);
        Assert.AreEqual(0, assistant.Calls);
        Assert.AreEqual(HttpStatusCode.NotFound, (await client.GetAsync(proposalUrl)).StatusCode);
        var worker = factory.Services.GetRequiredService<TripFormJobProcessor>();
        Assert.IsTrue(await worker.ProcessNextAsync());
        TrackedOperation? finished = await client.GetFromJsonAsync<TrackedOperation>(
            operation!.PollingUrl
        );
        Assert.AreEqual("Completed", finished?.Status);
        TripFormProposal? proposal = await client.GetFromJsonAsync<TripFormProposal>(proposalUrl);
        Assert.AreEqual("CDG", proposal?.Document.Destination?.Code);
        Assert.AreEqual("Paris in June", proposal?.Document.AiPrompt);
        Assert.IsNotNull(proposal);
        Assert.IsTrue(proposal.Document.AiPromptLocked.GetValueOrDefault());
        Assert.AreEqual(requestId, proposal?.Document.AiFormOperationId);
        Assert.AreEqual(1, assistant.Calls);
        Trip unchanged = (await client.GetFromJsonAsync<Trip>($"/user/{user.Id}/trips/{trip.Id}"))!;
        Assert.AreEqual(0, unchanged.Constraints.EnumerateObject().Count());
    }

    private sealed class StubAssistant : ITripFormAssistant
    {
        public int Calls { get; private set; }

        public Task<TripFormProposal> ProposeAsync(
            string input,
            PlanningDocument draft,
            User owner,
            IReadOnlyList<PlanningParty> parties,
            CancellationToken cancellationToken = default
        )
        {
            Calls++;
            return Task.FromResult(
                new TripFormProposal(
                    draft with
                    {
                        Destination = new SearchLocation("CDG", "Europe/Paris"),
                    },
                    []
                )
            );
        }
    }
}
