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
    public async Task Mcp_SchedulesExistingProposedActivityByCityName_AndPreservesOtherEntries()
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = McpEndpointTests.CreateClient(factory);
        var user = await McpEndpointTests.SeedAndSetCookie(factory, browser);
        var (trip, _, otherPlace, otherActivity) = await ActivityPlanningFixture.SeedDatabase(
            factory.Database,
            user
        );
        var date = new DateOnly(2026, 12, 28);
        var place = await factory.Database.SaveDestinationPlaceAsync(
            user.Id,
            new(trip.Id, "tokyo-jp", "Tokyo", "JP", "Asia/Tokyo", 139.69, 35.69, "context")
        );
        var visit = new DestinationVisit(trip.Id, place.CityId, Guid.NewGuid(), 1, date, date);
        await factory.Database.AddDestinationVisitAsync(user.Id, visit);
        place = (await factory.Database.GetDestinationPlaceAsync(user.Id, trip.Id, place.CityId))!;
        var activity = otherActivity with
        {
            Id = Guid.Parse("2fd3a579-0fb1-4610-9b35-fbb32a0e6e3d"),
            CityId = place.CityId,
            Geometry = null,
            Properties = otherActivity.Properties with
            {
                Name = "Submit South Korea e-Arrival Card",
                Duration = TimeSpan.FromMinutes(15),
                State = ActivityState.Proposed,
            },
        };
        var existing = activity with
        {
            Id = Guid.NewGuid(),
            Properties = activity.Properties with
            {
                Name = "Existing itinerary entry",
                State = ActivityState.Planned,
            },
        };
        await factory.Database.SaveActivityAsync(user.Id, existing, place.ContextVersion, null);
        await factory.Database.SaveActivityAsync(user.Id, activity, place.ContextVersion, null);
        var token = await McpEndpointTests.Tokens(browser, "tripplanner.read tripplanner.write");
        using var agent = McpEndpointTests.CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        var read = await Call(
            agent,
            "get_activity_plan",
            new { tripId = trip.Id, destinationCity = "Tokyo" }
        );
        var data = read.GetProperty("data")
            .Deserialize<ActivityPlanResponse>(JsonSerializerOptions.Web)!;
        Assert.AreEqual(0L, data.Version);
        Assert.AreEqual("\"0\"", read.GetProperty("etag").GetString());
        var existingPlan = data.Plan with
        {
            Days = [data.Plan.Days[0] with { Name = "Tokyo day", ActivityIds = [existing.Id] }],
            Rules =
            [
                new(existing.Id)
                {
                    FixedDate = date,
                    FixedStart = new(11, 0),
                    AlwaysAvailable = true,
                },
            ],
        };
        await Call(
            agent,
            "replace_activity_plan",
            new
            {
                tripId = trip.Id,
                destinationCity = "Tokyo",
                etag = read.GetProperty("etag").GetString(),
                request = new ReplaceActivityPlanRequest(existingPlan, data.ContextVersion),
            }
        );
        read = await Call(
            agent,
            "get_activity_plan",
            new { tripId = trip.Id, destinationCity = "tokyo" }
        );
        data = read.GetProperty("data")
            .Deserialize<ActivityPlanResponse>(JsonSerializerOptions.Web)!;
        var plan = data.Plan with
        {
            SelectedActivityIds = [.. data.Plan.SelectedActivityIds, activity.Id],
            Days =
            [
                data.Plan.Days[0] with
                {
                    ActivityIds = [activity.Id, .. data.Plan.Days[0].ActivityIds],
                },
            ],
            Rules =
            [
                .. data.Plan.Rules,
                new(activity.Id)
                {
                    FixedDate = date,
                    FixedStart = new(9, 0),
                    Duration = TimeSpan.FromMinutes(15),
                    AlwaysAvailable = true,
                },
            ],
        };
        var saved = await Call(
            agent,
            "replace_activity_plan",
            new
            {
                tripId = trip.Id,
                destinationCity = "Tokyo",
                etag = read.GetProperty("etag").GetString(),
                request = new ReplaceActivityPlanRequest(plan, data.ContextVersion),
            }
        );
        Assert.AreEqual(200, saved.GetProperty("status").GetInt32());
        var reread = await Call(
            agent,
            "get_activity_plan",
            new { tripId = trip.Id, destinationCity = place.CityId }
        );
        var current = reread
            .GetProperty("data")
            .Deserialize<ActivityPlanResponse>(JsonSerializerOptions.Web)!;
        Assert.AreEqual(
            saved.GetProperty("etag").GetString(),
            reread.GetProperty("etag").GetString()
        );
        Assert.IsFalse(string.IsNullOrEmpty(reread.GetProperty("contextVersion").GetString()));
        var entries = current.SavedAssessment!.Days.Single().Entries;
        Assert.HasCount(2, entries);
        var entry = entries.Single(e => e.ActivityId == activity.Id);
        Assert.AreEqual(DateTimeOffset.Parse("2026-12-28T09:00:00+09:00"), entry.Start);
        Assert.AreEqual(DateTimeOffset.Parse("2026-12-28T09:15:00+09:00"), entry.End);
        Assert.AreEqual(
            DateTimeOffset.Parse("2026-12-28T11:00:00+09:00"),
            entries.Single(e => e.ActivityId == existing.Id).Start
        );
        Assert.AreEqual("Tokyo day", current.Plan.Days[0].Name);
        Assert.AreEqual(
            JsonSerializer.Serialize(existingPlan.Rules[0]),
            JsonSerializer.Serialize(current.Plan.Rules.Single(r => r.ActivityId == existing.Id))
        );
        Assert.IsNull(
            await factory.Database.GetActivityPlanAsync(user.Id, trip.Id, otherPlace.CityId)
        );
        Assert.AreEqual(
            otherActivity,
            await factory.Database.GetActivityAsync(
                user.Id,
                trip.Id,
                otherPlace.CityId,
                otherActivity.Id
            )
        );
        var document = await Call(agent, "get_trip_document", new { tripId = trip.Id });
        var calendar = document
            .GetProperty("data")
            .GetProperty("itinerary")
            .GetProperty("items")
            .EnumerateArray()
            .Single(i => i.GetProperty("id").GetString() == activity.Id.ToString());
        Assert.AreEqual("event", calendar.GetProperty("type").GetString());
        Assert.AreEqual(
            DateTimeOffset.Parse("2026-12-28T09:00:00+09:00"),
            calendar.GetProperty("start").GetDateTimeOffset()
        );
        Assert.AreEqual("Asia/Tokyo", calendar.GetProperty("timeZone").GetString());
        Assert.AreEqual("PT15M", calendar.GetProperty("duration").GetString());
    }

    [TestMethod]
    public async Task Mcp_DiscoveryExplainsUndatedIdeasAndSeparateScheduling()
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = McpEndpointTests.CreateClient(factory);
        await McpEndpointTests.SeedAndSetCookie(factory, browser);
        var token = await McpEndpointTests.Tokens(browser, "tripplanner.read");
        using var agent = McpEndpointTests.CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        var initialized = await McpEndpointTests.Result(
            await McpEndpointTests.Rpc(
                agent,
                "initialize",
                new
                {
                    protocolVersion = "2025-06-18",
                    capabilities = new { },
                    clientInfo = new { name = "Planning guidance test", version = "1.0" },
                }
            )
        );
        string instructions = initialized.GetProperty("instructions").GetString()!;
        StringAssert.Contains(instructions, "undated idea");
        StringAssert.Contains(instructions, "Insadong crafts, tea, and Jogyesa");
        StringAssert.Contains(instructions, "fixedDate/fixedStart");

        var listed = await McpEndpointTests.Result(await McpEndpointTests.Rpc(agent, "tools/list"));
        var tools = listed
            .GetProperty("tools")
            .EnumerateArray()
            .ToDictionary(t => t.GetProperty("name").GetString()!);
        foreach (string name in new[] { "create_activity", "update_activity" })
        {
            StringAssert.Contains(
                tools[name].GetProperty("description").GetString()!,
                "replace_activity_plan"
            );
            var properties = tools[name]
                .GetProperty("inputSchema")
                .GetProperty("properties")
                .GetProperty("request")
                .GetProperty("properties")
                .GetProperty("properties")
                .GetProperty("properties");
            StringAssert.Contains(
                properties.GetProperty("name").GetProperty("description").GetString()!,
                "undated activity idea"
            );
            StringAssert.Contains(
                properties.GetProperty("state").GetProperty("description").GetString()!,
                "does not assign a day or time"
            );
            StringAssert.Contains(
                properties.GetProperty("description").GetProperty("description").GetString()!,
                "activity itself"
            );
            var notes = properties.GetProperty("notes");
            Assert.AreEqual(10000, notes.GetProperty("maxLength").GetInt32());
            StringAssert.Contains(
                notes.GetProperty("description").GetString()!,
                "scheduling details"
            );
        }

        foreach (string name in new[] { "get_activity_plan", "replace_activity_plan" })
        {
            StringAssert.Contains(
                tools[name]
                    .GetProperty("inputSchema")
                    .GetProperty("properties")
                    .GetProperty("destinationCity")
                    .GetProperty("description")
                    .GetString()!,
                "Destination ID from list_destinations"
            );
        }
        var planTool = tools["replace_activity_plan"];
        StringAssert.Contains(planTool.GetProperty("description").GetString()!, "create_activity");
        var plan = planTool
            .GetProperty("inputSchema")
            .GetProperty("properties")
            .GetProperty("request")
            .GetProperty("properties")
            .GetProperty("plan")
            .GetProperty("properties");
        StringAssert.Contains(
            plan.GetProperty("days").GetProperty("description").GetString()!,
            "destination visit ID"
        );
        StringAssert.Contains(
            plan.GetProperty("rules").GetProperty("description").GetString()!,
            "fixedDate and fixedStart"
        );
        var dayName = plan.GetProperty("days")
            .GetProperty("items")
            .GetProperty("properties")
            .GetProperty("name");
        Assert.AreEqual(200, dayName.GetProperty("maxLength").GetInt32());
        StringAssert.Contains(
            dayName.GetProperty("description").GetString()!,
            "not a scheduling constraint"
        );
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
