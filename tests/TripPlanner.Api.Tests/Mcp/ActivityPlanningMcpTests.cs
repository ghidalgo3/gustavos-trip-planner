using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Mcp;

[TestClass]
public sealed class ActivityPlanningMcpTests
{
    private static async Task<JsonElement> Call(HttpClient client, string name, object arguments)
    {
        var result = await McpEndpointTests.Result(
            await McpEndpointTests.Rpc(client, "tools/call", new { name, arguments })
        );
        Assert.IsFalse(
            result.TryGetProperty("isError", out var error) && error.GetBoolean(),
            result.ToString()
        );
        return result.GetProperty("structuredContent");
    }

    [TestMethod]
    public async Task Mcp_ReadAssessProposePollInspectApply_UsesSharedVersionsAndAuditing()
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = McpEndpointTests.CreateClient(factory);
        var user = await McpEndpointTests.SeedAndSetCookie(factory, browser);
        var (trip, _, place, activity) = await ActivityPlanningFixture.SeedDatabase(
            factory.Database,
            user
        );
        var token = await McpEndpointTests.Tokens(browser, "tripplanner.read tripplanner.write");
        using var agent = McpEndpointTests.CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        var listed = await McpEndpointTests.Result(await McpEndpointTests.Rpc(agent, "tools/list"));
        var tools = listed
            .GetProperty("tools")
            .EnumerateArray()
            .ToDictionary(t => t.GetProperty("name").GetString()!);
        foreach (
            string name in new[]
            {
                "get_activity_plan",
                "preview_activity_plan",
                "replace_activity_plan",
                "get_activity_preferences",
                "replace_activity_preferences",
                "create_activity_plan_assessment",
                "get_activity_plan_assessment",
                "create_activity_plan_proposal",
                "get_activity_plan_proposal",
                "replace_activity_plan_proposal_review",
                "list_operations",
                "get_operation",
                "create_calendar_subscription",
                "list_calendar_subscriptions",
                "revoke_calendar_subscription",
            }
        )
        {
            Assert.IsTrue(tools.ContainsKey(name), name);
        }

        Assert.IsTrue(
            tools["get_activity_plan"]
                .GetProperty("annotations")
                .GetProperty("readOnlyHint")
                .GetBoolean()
        );
        Assert.IsTrue(
            tools["replace_activity_plan"]
                .GetProperty("annotations")
                .GetProperty("destructiveHint")
                .GetBoolean()
        );
        Assert.IsTrue(
            tools["create_activity_plan_proposal"]
                .GetProperty("annotations")
                .GetProperty("openWorldHint")
                .GetBoolean()
        );
        Assert.DoesNotContain("apiKey", listed.ToString());
        Assert.DoesNotContain("actingUser", listed.ToString());
        var prefs = await Call(agent, "get_activity_preferences", new { scope = "Profile" });
        await Call(
            agent,
            "replace_activity_preferences",
            new
            {
                scope = "Profile",
                etag = prefs.GetProperty("etag").GetString(),
                request = new ActivityPreferencesRequest("Private museum interest"),
            }
        );
        var context = await Call(
            agent,
            "get_activity_plan",
            new { tripId = trip.Id, destinationCity = place.CityId }
        );
        var data = context
            .GetProperty("data")
            .Deserialize<ActivityPlanResponse>(JsonSerializerOptions.Web)!;
        var preview = await Call(
            agent,
            "preview_activity_plan",
            new
            {
                tripId = trip.Id,
                destinationCity = place.CityId,
                request = new PreviewActivityPlanRequest(data.Plan, data.ContextVersion),
            }
        );
        Assert.AreEqual(
            "unscheduled",
            preview.GetProperty("data").GetProperty("issues")[0].GetProperty("code").GetString()
        );
        Assert.IsTrue(
            tools["preview_activity_plan"]
                .GetProperty("annotations")
                .GetProperty("readOnlyHint")
                .GetBoolean()
        );
        var assessed = await Call(
            agent,
            "create_activity_plan_assessment",
            new
            {
                tripId = trip.Id,
                destinationCity = place.CityId,
                request = new CreateActivityAssessmentRequest(Guid.NewGuid(), data.ContextVersion),
            }
        );
        var assessmentId = assessed.GetProperty("operationId").GetGuid();
        await Call(
            agent,
            "get_activity_plan_assessment",
            new
            {
                tripId = trip.Id,
                destinationCity = place.CityId,
                assessmentId,
            }
        );
        var proposalId = Guid.NewGuid();
        var proposal = await Call(
            agent,
            "create_activity_plan_proposal",
            new
            {
                tripId = trip.Id,
                destinationCity = place.CityId,
                request = new CreateActivityProposalRequest(
                    proposalId,
                    data.ContextVersion,
                    RefreshEvidence: false
                ),
            }
        );
        Assert.AreEqual(202, proposal.GetProperty("status").GetInt32());
        Assert.IsTrue(
            await factory
                .Services.GetRequiredService<ActivityPlanningJobProcessor>()
                .ProcessNextAsync()
        );
        var operation = await Call(agent, "get_operation", new { operationId = proposalId });
        Assert.AreEqual(
            "Completed",
            operation.GetProperty("data").GetProperty("status").GetString(),
            operation.ToString()
        );
        var result = await Call(
            agent,
            "get_activity_plan_proposal",
            new
            {
                tripId = trip.Id,
                destinationCity = place.CityId,
                proposalId,
            }
        );
        var choices = result
            .GetProperty("data")
            .GetProperty("result")
            .Deserialize<ActivityPlanningResult>(JsonSerializerOptions.Web)!;
        Assert.IsNotEmpty(choices.Alternatives, result.ToString());
        var choice = choices.Alternatives[0];
        var saved = await Call(
            agent,
            "replace_activity_plan",
            new
            {
                tripId = trip.Id,
                destinationCity = place.CityId,
                etag = context.GetProperty("etag").GetString(),
                request = new ReplaceActivityPlanRequest(
                    choice.Plan,
                    choices.ContextVersion,
                    proposalId,
                    choice.Id
                ),
            }
        );
        Assert.AreEqual(200, saved.GetProperty("status").GetInt32());
        Assert.AreEqual(
            activity.Id,
            saved
                .GetProperty("data")
                .GetProperty("plan")
                .GetProperty("days")[0]
                .GetProperty("activityIds")[0]
                .GetGuid()
        );
        McpEndpointTests.SetTestPrincipal(browser, user.Email);
        var log = (await browser.GetFromJsonAsync<ActivityLogPage>("/user/activity-log"))!;
        var mutation = log.Entries.Single(e => e.Action == "Updated activity plan");
        Assert.AreEqual(user.Id, mutation.ActorUserId);
        Assert.AreEqual("ChatGPT", mutation.Source);
        Assert.DoesNotContain("Private museum interest", saved.ToString());
    }

    [TestMethod]
    public async Task ReadScope_CanPreviewButCannotPersistAssessmentsOrCreateSubscriptions()
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = McpEndpointTests.CreateClient(factory);
        var user = await McpEndpointTests.SeedAndSetCookie(factory, browser);
        var (trip, _, place, _) = await ActivityPlanningFixture.SeedDatabase(
            factory.Database,
            user
        );
        var token = await McpEndpointTests.Tokens(browser, "tripplanner.read");
        using var agent = McpEndpointTests.CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        var read = await Call(
            agent,
            "get_activity_plan",
            new { tripId = trip.Id, destinationCity = place.CityId }
        );
        var data = read.GetProperty("data")
            .Deserialize<ActivityPlanResponse>(JsonSerializerOptions.Web)!;
        await Call(
            agent,
            "preview_activity_plan",
            new
            {
                tripId = trip.Id,
                destinationCity = place.CityId,
                request = new PreviewActivityPlanRequest(data.Plan, data.ContextVersion),
            }
        );
        foreach (
            var tool in new[]
            {
                new
                {
                    name = "create_calendar_subscription",
                    arguments = (object)new { tripId = trip.Id },
                },
                new
                {
                    name = "create_activity_plan_assessment",
                    arguments = (object)
                        new
                        {
                            tripId = trip.Id,
                            destinationCity = place.CityId,
                            request = new CreateActivityAssessmentRequest(Guid.NewGuid(), "1"),
                        },
                },
            }
        )
        {
            var response = await McpEndpointTests.Result(
                await McpEndpointTests.Rpc(agent, "tools/call", tool)
            );
            Assert.IsTrue(response.GetProperty("isError").GetBoolean());
            StringAssert.Contains(response.ToString(), "insufficient_scope");
        }
        Assert.IsEmpty(
            await factory.Database.GetActivityCalendarSubscriptionsAsync(user.Id, trip.Id)
        );
    }
}
