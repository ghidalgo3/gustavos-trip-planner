using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Tests.Database;
using TripPlanner.Api.Tests.Mcp;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class ActivityKindEndpointTests
{
    [TestMethod]
    public async Task RestListsOnlyOwnedTripKindsWithSearchAndPagination()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await client.GetAsync("/user/activity-kinds")).StatusCode
        );
        var owner = await factory.Database.GetOrCreateUserAsync(
            new("google", "kind-owner@example.com", "Owner")
        );
        await ActivityKindDbTests.Seed(factory.Database, owner);
        McpEndpointTests.SetTestPrincipal(client, owner.Email);
        using var response = await client.GetAsync("/user/activity-kinds");
        response.EnsureSuccessStatusCode();
        Assert.IsTrue(response.Headers.CacheControl!.Private);
        Assert.IsTrue(response.Headers.CacheControl.NoStore);
        var all = (await response.Content.ReadFromJsonAsync<ActivityKindPage>())!;
        CollectionAssert.AreEqual(ActivityKindDbTests.Labels, all.Kinds.ToArray());
        Assert.IsFalse(all.HasMore);
        var page = (
            await client.GetFromJsonAsync<ActivityKindPage>(
                "/user/activity-kinds?search=a&top=2&skip=1"
            )
        )!;
        CollectionAssert.AreEqual(new[] { "Architecture", "Art" }, page.Kinds.ToArray());
        Assert.IsFalse(page.HasMore);
        var first = (
            await client.GetFromJsonAsync<ActivityKindPage>("/user/activity-kinds?top=2")
        )!;
        Assert.IsTrue(first.HasMore);
        using var newcomer = factory.CreateClient();
        McpEndpointTests.SetTestPrincipal(newcomer, "no-activities@example.com");
        int usersBefore = factory.Database.Users.Count;
        var empty = (await newcomer.GetFromJsonAsync<ActivityKindPage>("/user/activity-kinds"))!;
        Assert.IsEmpty(empty.Kinds);
        Assert.IsFalse(empty.HasMore);
        Assert.HasCount(usersBefore, factory.Database.Users);
    }

    [TestMethod]
    [DataRow("top=0")]
    [DataRow("top=101")]
    [DataRow("skip=-1")]
    [DataRow("skip=100001")]
    [DataRow("search=too-long")]
    public async Task RestAndMcpValidateTheSameKindQuery(string query)
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = McpEndpointTests.CreateClient(factory);
        var user = await McpEndpointTests.SeedAndSetCookie(factory, browser);
        McpEndpointTests.SetTestPrincipal(browser, user.Email);
        var (field, value) = (query.Split('=')[0], query.Split('=')[1]);
        object invalid = field == "search" ? new string('a', 201) : int.Parse(value);
        using var response = await browser.GetAsync($"/user/activity-kinds?{field}={invalid}");
        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        var token = await McpEndpointTests.Tokens(browser, "tripplanner.read");
        using var agent = McpEndpointTests.CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        var result = await McpEndpointTests.Result(
            await McpEndpointTests.Rpc(
                agent,
                "tools/call",
                new
                {
                    name = "list_activity_kinds",
                    arguments = new
                    {
                        query = new Dictionary<string, object> { [field] = invalid },
                    },
                }
            )
        );
        Assert.IsTrue(result.GetProperty("isError").GetBoolean(), result.ToString());
    }

    [TestMethod]
    [DataRow("tripplanner.read")]
    [DataRow("tripplanner.read tripplanner.write")]
    public async Task McpListsTheSameOwnedKindsAndPublishesQueryConstraints(string scopes)
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = McpEndpointTests.CreateClient(factory);
        var user = await McpEndpointTests.SeedAndSetCookie(factory, browser);
        await ActivityKindDbTests.Seed(factory.Database, user);
        var token = await McpEndpointTests.Tokens(browser, scopes);
        using var agent = McpEndpointTests.CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        foreach (
            var query in new[]
            {
                new ActivityKindQuery(),
                new ActivityKindQuery(Search: "a", Top: 2, Skip: 1),
            }
        )
        {
            var result = await McpEndpointTests.Result(
                await McpEndpointTests.Rpc(
                    agent,
                    "tools/call",
                    new { name = "list_activity_kinds", arguments = new { query } }
                )
            );
            Assert.IsFalse(result.GetProperty("isError").GetBoolean(), result.ToString());
            var page = result
                .GetProperty("structuredContent")
                .GetProperty("data")
                .Deserialize<ActivityKindPage>(JsonSerializerOptions.Web)!;
            var expected = await factory.Database.GetActivityKindPageAsync(user.Id, query);
            CollectionAssert.AreEqual(expected.Kinds.ToArray(), page.Kinds.ToArray());
            Assert.AreEqual(expected.HasMore, page.HasMore);
        }
        var tools = await McpEndpointTests.Result(await McpEndpointTests.Rpc(agent, "tools/list"));
        var tool = tools
            .GetProperty("tools")
            .EnumerateArray()
            .Single(tool => tool.GetProperty("name").GetString() == "list_activity_kinds");
        var fields = tool.GetProperty("inputSchema")
            .GetProperty("properties")
            .GetProperty("query")
            .GetProperty("properties");
        Assert.AreEqual(200, fields.GetProperty("search").GetProperty("maxLength").GetInt32());
        Assert.AreEqual(100, fields.GetProperty("top").GetProperty("maximum").GetInt32());
        Assert.IsTrue(tool.GetProperty("annotations").GetProperty("readOnlyHint").GetBoolean());
    }
}
