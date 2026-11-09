using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.Spatial;
using OpenIddict.Abstractions;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Mcp;

[TestClass]
public class McpEndpointTests
{
    [TestMethod]
    [DataRow("Owner", "tripplanner.read tripplanner.write", true)]
    [DataRow("Planner", "tripplanner.read tripplanner.write", true)]
    [DataRow("Traveller", "tripplanner.read tripplanner.write", false)]
    [DataRow("Owner", "tripplanner.read", false)]
    public async Task VisitAccommodationTools_RespectVisitIdentityAndPermissions(
        string role,
        string scope,
        bool canWrite
    )
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = CreateClient(factory);
        var user = await SeedAndSetCookie(factory, browser);
        var owner =
            role == "Owner"
                ? user
                : await factory.Database.GetOrCreateUserAsync(
                    new("google", "stay-owner@example.com", "Owner")
                );
        var trip = await factory.Database.CreateTripAsync(owner.Id, "Repeat visits", "");
        if (role != "Owner")
        {
            var party = (await factory.Database.GetPartiesAsync(owner.Id, trip.Id)).Single();
            await factory.Database.ChangePartyMemberAsync(
                owner.Id,
                trip.Id,
                party.Id,
                user.Id,
                true,
                role: Enum.Parse<PartyRole>(role)
            );
        }
        var place = await factory.Database.SaveDestinationPlaceAsync(
            owner.Id,
            new(trip.Id, "paris-fr", "Paris", "FR", "Europe/Paris", 2.35, 48.86)
        );
        var first = (
            await factory.Database.AddDestinationVisitAsync(
                owner.Id,
                new(trip.Id, place.CityId, Guid.NewGuid(), 0, null, null)
            )
        )!;
        var second = (
            await factory.Database.AddDestinationVisitAsync(
                owner.Id,
                new(trip.Id, place.CityId, Guid.NewGuid(), 1, null, null)
            )
        )!;
        var request = new StayLocationRequest(
            "Feature",
            new("Point", GeographyPoint.Create(48.86, 2.35)),
            new("First hotel")
        );
        SetTestPrincipal(browser, user.Email);
        var beforeLog = (await browser.GetFromJsonAsync<ActivityLogPage>("/user/activity-log"))!
            .Entries
            .Count;
        var token = await Tokens(browser, scope);
        using var agent = CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        async Task<JsonElement> Call(string name, Guid stayId, object? body = null) =>
            await Result(
                await Rpc(
                    agent,
                    "tools/call",
                    new
                    {
                        name,
                        arguments = new
                        {
                            tripId = trip.Id,
                            destinationId = place.CityId,
                            stayId,
                            request = body,
                        },
                    }
                )
            );
        var tools = (await Result(await Rpc(agent, "tools/list"))).GetProperty("tools");
        foreach (
            var name in new[]
            {
                "get_visit_stay_location",
                "replace_visit_stay_location",
                "delete_visit_stay_location",
            }
        )
        {
            var tool = tools
                .EnumerateArray()
                .Single(t => t.GetProperty("name").GetString() == name);
            Assert.IsFalse(
                tool.GetProperty("annotations").GetProperty("openWorldHint").GetBoolean()
            );
            Assert.AreEqual(
                name.StartsWith("get_", StringComparison.Ordinal),
                tool.GetProperty("annotations").GetProperty("readOnlyHint").GetBoolean()
            );
            Assert.IsTrue(
                tool.GetProperty("inputSchema")
                    .GetProperty("properties")
                    .TryGetProperty("stayId", out _)
            );
        }
        var saved = await Call("replace_visit_stay_location", first.StayId, request);
        Assert.AreEqual(!canWrite, saved.GetProperty("isError").GetBoolean(), saved.ToString());
        if (!canWrite)
        {
            Assert.IsEmpty(await factory.Database.GetStayLocationsAsync(owner.Id, trip.Id));
            Assert.HasCount(
                beforeLog,
                (await browser.GetFromJsonAsync<ActivityLogPage>("/user/activity-log"))!.Entries
            );
            return;
        }
        var read = await Call("get_visit_stay_location", first.StayId);
        Assert.AreEqual(
            "First hotel",
            read.GetProperty("structuredContent")
                .GetProperty("data")
                .GetProperty("properties")
                .GetProperty("name")
                .GetString()
        );
        Assert.IsTrue(
            (await Call("get_visit_stay_location", second.StayId))
                .GetProperty("isError")
                .GetBoolean()
        );
        var listed = (
            await browser.GetFromJsonAsync<GeoJsonCollection<DestinationProperties>>(
                $"/trips/{trip.Id}/destinations"
            )
        )!;
        Assert.AreEqual(
            "First hotel",
            listed
                .Features.Single()
                .Properties.Stays.Single(v => v.Id == first.StayId)
                .StayLocation!.Properties.Name
        );
        Assert.IsNull(
            listed
                .Features.Single()
                .Properties.Stays.Single(v => v.Id == second.StayId)
                .StayLocation
        );
        Assert.IsFalse(
            (
                await Call(
                    "replace_visit_stay_location",
                    second.StayId,
                    request with
                    {
                        Properties = new("Second hotel"),
                    }
                )
            )
                .GetProperty("isError")
                .GetBoolean()
        );
        Assert.IsTrue(
            (await Call("replace_visit_stay_location", Guid.NewGuid(), request))
                .GetProperty("isError")
                .GetBoolean()
        );
        Assert.IsFalse(
            (await Call("delete_visit_stay_location", first.StayId))
                .GetProperty("isError")
                .GetBoolean()
        );
        Assert.AreEqual(
            "Second hotel",
            (await factory.Database.GetStayLocationsAsync(owner.Id, trip.Id))
                .Single()
                .Value.Properties.Name
        );
        var entries = (
            await browser.GetFromJsonAsync<ActivityLogPage>("/user/activity-log")
        )!.Entries;
        Assert.HasCount(beforeLog + 3, entries);
        Assert.IsTrue(entries.Take(3).All(e => e.ActorUserId == user.Id && e.Source == "ChatGPT"));
    }

    private const string Resource = "https://localhost/mcp";
    private const string Redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
    private const string Verifier =
        "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-._~";

    [TestMethod]
    public async Task Discovery_AdvertisesPkceResourceAndScopes_AndMcpRequiresBearer()
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var client = CreateClient(factory);
        var metadata = await client.GetFromJsonAsync<JsonElement>(
            "/.well-known/oauth-protected-resource/mcp"
        );
        Assert.AreEqual(Resource, metadata.GetProperty("resource").GetString());
        var oauth = await client.GetFromJsonAsync<JsonElement>("/.well-known/openid-configuration");
        Assert.IsTrue(
            oauth
                .GetProperty("code_challenge_methods_supported")
                .EnumerateArray()
                .Any(value => value.GetString() == "S256")
        );
        var unauthorized = await Rpc(client, "tools/list");
        Assert.AreEqual(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        StringAssert.Contains(
            unauthorized.Headers.WwwAuthenticate.ToString(),
            "resource_metadata="
        );
        client.DefaultRequestHeaders.Authorization = new("Bearer", "forged-token");
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await Rpc(client, "tools/list")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        await SeedAndSetCookie(factory, client);
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await Rpc(client, "tools/list")).StatusCode,
            "Browser cookies must not grant MCP access."
        );
    }

    [TestMethod]
    public async Task OAuthConsent_RequiresCsrfAndPkce_AndRejectsUnregisteredRedirectsAndResources()
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var client = CreateClient(factory);
        await SeedAndSetCookie(factory, client);
        var query = AuthorizationParameters("tripplanner.read");
        var missingCsrf = await client.PostAsync(
            "/oauth/authorize",
            new FormUrlEncodedContent(query.Append(new("decision", "allow")))
        );
        Assert.AreEqual(HttpStatusCode.BadRequest, missingCsrf.StatusCode);
        StringAssert.Contains(
            await missingCsrf.Content.ReadAsStringAsync(),
            "No new access was granted"
        );
        Assert.IsNull(missingCsrf.Headers.Location);
        query["redirect_uri"] = "https://attacker.example/callback";
        var invalidRedirect = await client.GetAsync(
            QueryHelpers.AddQueryString("/oauth/authorize", query!)
        );
        Assert.AreEqual(HttpStatusCode.BadRequest, invalidRedirect.StatusCode);
        Assert.IsNull(invalidRedirect.Headers.Location);
        query = AuthorizationParameters("tripplanner.read");
        query.Remove("code_challenge");
        Assert.IsTrue(
            (
                await client.GetAsync(QueryHelpers.AddQueryString("/oauth/authorize", query!))
            ).StatusCode
                is HttpStatusCode.Redirect
                    or HttpStatusCode.BadRequest
        );
        query = AuthorizationParameters("tripplanner.read");
        query["resource"] = "https://another-service.example/mcp";
        var invalidResource = await client.GetAsync(
            QueryHelpers.AddQueryString("/oauth/authorize", query!)
        );
        StringAssert.Contains(
            invalidResource.Headers.Location?.ToString()
                ?? await invalidResource.Content.ReadAsStringAsync(),
            "invalid_target"
        );
    }

    [TestMethod]
    [DataRow("allow", "tripplanner.read", "query")]
    [DataRow("allow", "tripplanner.read tripplanner.write", "query")]
    [DataRow("deny", "tripplanner.read", "query")]
    [DataRow("deny", "tripplanner.read tripplanner.write", "query")]
    [DataRow("allow", "tripplanner.read", "form_post")]
    [DataRow("deny", "tripplanner.read", "form_post")]
    [DataRow("allow", "tripplanner.read", "fragment")]
    [DataRow("deny", "tripplanner.read", "fragment")]
    public async Task OAuthConsent_ShowsOutcomeBeforeReturningValidatedResponseToChatGpt(
        string decision,
        string scopes,
        string responseMode
    )
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = CreateClient(factory);
        await SeedAndSetCookie(factory, browser);
        var query = AuthorizationParameters(scopes);
        query["response_mode"] = responseMode;
        query["state"] = "state-with-<&\"-characters";
        using var response = await SubmitConsent(browser, query, decision);
        string html = await response.Content.ReadAsStringAsync();

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode, html);
        Assert.AreEqual("text/html", response.Content.Headers.ContentType?.MediaType);
        Assert.IsNull(
            response.Headers.Location,
            "Keep the outcome visible until the user continues."
        );
        Assert.AreEqual("no-store", response.Headers.CacheControl?.ToString());
        Assert.AreEqual("no-referrer", response.Headers.GetValues("Referrer-Policy").Single());
        StringAssert.Contains(html, "role=\"status\"");
        StringAssert.Contains(html, decision == "allow" ? "Access approved" : "Access not granted");
        StringAssert.Contains(html, "Return to ChatGPT");
        Assert.DoesNotContain("<script", html);

        var callback = ConsentCallback(html, responseMode);
        Assert.AreEqual(Redirect, callback.GetLeftPart(UriPartial.Path));
        var returned = QueryHelpers.ParseQuery(
            responseMode == "fragment" ? callback.Fragment.TrimStart('#') : callback.Query
        );
        Assert.AreEqual(query["state"], returned["state"].ToString());
        Assert.AreEqual("https://localhost/", returned["iss"].ToString());
        if (decision == "allow")
        {
            StringAssert.Contains(html, "finish connecting");
            StringAssert.Contains(html, "Activity Log");
            Assert.IsFalse(returned.ContainsKey("error"));
            using var exchange = await Exchange(browser, returned["code"].ToString());
            Assert.AreEqual(
                HttpStatusCode.OK,
                exchange.StatusCode,
                await exchange.Content.ReadAsStringAsync()
            );
        }
        else
        {
            StringAssert.Contains(html, "No new access was granted");
            Assert.AreEqual("access_denied", returned["error"].ToString());
            Assert.IsFalse(returned.ContainsKey("code"));
            using var scope = factory.Services.CreateScope();
            Assert.AreEqual(
                0L,
                await scope
                    .ServiceProvider.GetRequiredService<IOpenIddictTokenManager>()
                    .CountAsync()
            );
        }
        if (responseMode == "form_post")
        {
            StringAssert.Contains(
                response.Headers.GetValues("Content-Security-Policy").Single(),
                "form-action https://chatgpt.com;"
            );
        }
    }

    [TestMethod]
    public async Task AuthorizationCode_IsBoundToPkceClientAndResource_AndCannotBeReplayed()
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = CreateClient(factory);
        await SeedAndSetCookie(factory, browser);
        string code = await Authorize(browser, "tripplanner.read offline_access");
        using var client = CreateClient(factory);
        var wrongVerifier = await Exchange(client, code, verifier: new string('z', 43));
        Assert.AreEqual(HttpStatusCode.BadRequest, wrongVerifier.StatusCode);
        code = await Authorize(browser, "tripplanner.read offline_access");
        var wrongResource = await Exchange(client, code, resource: "https://wrong.example/mcp");
        Assert.AreEqual(HttpStatusCode.BadRequest, wrongResource.StatusCode);
        code = await Authorize(browser, "tripplanner.read offline_access");
        var token = await Exchange(client, code);
        Assert.AreEqual(
            HttpStatusCode.OK,
            token.StatusCode,
            await token.Content.ReadAsStringAsync()
        );
        Assert.AreEqual(HttpStatusCode.BadRequest, (await Exchange(client, code)).StatusCode);
    }

    [TestMethod]
    [DataRow("Owner", true)]
    [DataRow("Planner", true)]
    [DataRow("Traveller", false)]
    public async Task TripPermissions_AreConsistentAcrossListDetailsAndAgentMutations(
        string role,
        bool canPlan
    )
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = CreateClient(factory);
        var user = await SeedAndSetCookie(factory, browser);
        var owner =
            role == "Owner"
                ? user
                : await factory.Database.GetOrCreateUserAsync(
                    new("google", "owner@example.com", "Owner")
                );
        var trip = await factory.Database.CreateTripAsync(owner.Id, "Original trip", "");
        if (role != "Owner")
        {
            var party = (await factory.Database.GetPartiesAsync(owner.Id, trip.Id)).Single();
            await factory.Database.ChangePartyMemberAsync(
                owner.Id,
                trip.Id,
                party.Id,
                user.Id,
                true,
                role: Enum.Parse<PartyRole>(role)
            );
        }
        SetTestPrincipal(browser, user.Email);
        var restList = await browser.GetFromJsonAsync<TripListPage>("/trips");
        Assert.AreEqual(canPlan, restList!.Trips.Single().CanPlan);
        Assert.AreEqual(
            canPlan,
            (await browser.GetFromJsonAsync<TripResponse>($"/trips/{trip.Id}"))!.CanPlan
        );

        var token = await Tokens(browser, "tripplanner.read tripplanner.write");
        using var agent = CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        var listed = await Result(
            await Rpc(agent, "tools/call", new { name = "list_trips", arguments = new { } })
        );
        Assert.IsFalse(listed.GetProperty("isError").GetBoolean(), listed.ToString());
        Assert.AreEqual(
            canPlan,
            listed
                .GetProperty("structuredContent")
                .GetProperty("data")
                .GetProperty("trips")[0]
                .GetProperty("canPlan")
                .GetBoolean()
        );
        var details = await Result(
            await Rpc(
                agent,
                "tools/call",
                new { name = "get_trip", arguments = new { tripId = trip.Id } }
            )
        );
        Assert.IsFalse(details.GetProperty("isError").GetBoolean(), details.ToString());
        Assert.AreEqual(
            canPlan,
            details
                .GetProperty("structuredContent")
                .GetProperty("data")
                .GetProperty("canPlan")
                .GetBoolean()
        );
        var updated = await Result(
            await Rpc(
                agent,
                "tools/call",
                new
                {
                    name = "update_trip",
                    arguments = new
                    {
                        tripId = trip.Id,
                        request = new { name = "Changed by ChatGPT", description = "" },
                    },
                }
            )
        );
        Assert.AreEqual(!canPlan, updated.GetProperty("isError").GetBoolean(), updated.ToString());
        Assert.AreEqual(
            canPlan ? "Changed by ChatGPT" : "Original trip",
            factory.Database.Trips.Single().Name
        );
        var log = await browser.GetFromJsonAsync<ActivityLogPage>("/user/activity-log");
        Assert.HasCount(canPlan ? 1 : 0, log!.Entries);
        if (canPlan)
        {
            Assert.AreEqual("ChatGPT", log.Entries[0].Source);
            Assert.AreEqual(user.Id, log.Entries[0].ActorUserId);
        }
    }

    [TestMethod]
    public async Task ChatGptCanCreateTrip_WithActorAttribution_AndCannotReadOtherUsersTrips()
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = CreateClient(factory);
        var user = await SeedAndSetCookie(factory, browser);
        var token = await Tokens(browser, "tripplanner.read tripplanner.write offline_access");
        using var agent = CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        using var createdResponse = await Rpc(
            agent,
            "tools/call",
            new
            {
                name = "create_trip",
                arguments = new
                {
                    request = new { name = "Agent planned trip", description = "Museums" },
                },
            }
        );
        var created = await Result(createdResponse);
        Assert.IsFalse(created.GetProperty("isError").GetBoolean(), created.ToString());
        var trip = created.GetProperty("structuredContent").GetProperty("data");
        Assert.IsTrue(trip.GetProperty("canPlan").GetBoolean());
        Guid tripId = trip.GetProperty("id").GetGuid();
        Assert.AreEqual(user.Id, trip.GetProperty("ownerUserId").GetGuid());
        SetTestPrincipal(browser, user.Email);
        var log = await browser.GetFromJsonAsync<ActivityLogPage>("/user/activity-log");
        Assert.HasCount(1, log!.Entries);
        Assert.AreEqual("ChatGPT", log.Entries[0].Source);
        Assert.AreEqual(user.Id, log.Entries[0].ActorUserId);
        Assert.AreEqual("Created trip", log.Entries[0].Action);
        var stranger = await factory.Database.GetOrCreateUserAsync(
            new("google", "stranger@example.com", "Stranger")
        );
        var privateTrip = await factory.Database.CreateTripAsync(stranger.Id, "Private", "");
        var unauthorized = await Result(
            await Rpc(
                agent,
                "tools/call",
                new { name = "get_trip", arguments = new { tripId = privateTrip.Id } }
            )
        );
        Assert.IsTrue(unauthorized.GetProperty("isError").GetBoolean());
        Assert.AreEqual(
            404,
            unauthorized.GetProperty("structuredContent").GetProperty("status").GetInt32()
        );
        var updated = await Result(
            await Rpc(
                agent,
                "tools/call",
                new
                {
                    name = "update_trip",
                    arguments = new
                    {
                        tripId,
                        request = new { name = "Updated by agent", description = "Museums" },
                    },
                }
            )
        );
        Assert.IsFalse(updated.GetProperty("isError").GetBoolean(), updated.ToString());
        var party = (await factory.Database.GetPartiesAsync(stranger.Id, privateTrip.Id)).Single();
        await factory.Database.ChangePartyMemberAsync(
            stranger.Id,
            privateTrip.Id,
            party.Id,
            user.Id,
            true
        );
        var forbidden = await Result(
            await Rpc(
                agent,
                "tools/call",
                new
                {
                    name = "add_destination",
                    arguments = new
                    {
                        tripId = privateTrip.Id,
                        request = new CreateDestinationRequest(
                            "Feature",
                            new("Point", GeographyPoint.Create(latitude: 48.86, longitude: 2.35)),
                            new("Paris", "FR")
                        ),
                    },
                }
            )
        );
        Assert.IsTrue(forbidden.GetProperty("isError").GetBoolean());
        Assert.AreEqual(
            403,
            forbidden.GetProperty("structuredContent").GetProperty("status").GetInt32(),
            "A traveller must not receive a cookie-login redirect or be allowed to write."
        );
        Assert.HasCount(
            2,
            (await browser.GetFromJsonAsync<ActivityLogPage>("/user/activity-log"))!.Entries
        );
    }

    [TestMethod]
    public async Task ReadOnlyTokenCannotWrite_RefreshCannotEscalate_AndRevocationStopsAccess()
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = CreateClient(factory);
        await SeedAndSetCookie(factory, browser);
        var token = await Tokens(browser, "tripplanner.read offline_access");
        using var agent = CreateClient(factory);
        string access = token.GetProperty("access_token").GetString()!;
        agent.DefaultRequestHeaders.Authorization = new("Bearer", access);
        var listed = await Rpc(agent, "tools/list");
        Assert.AreEqual(
            HttpStatusCode.OK,
            listed.StatusCode,
            await listed.Content.ReadAsStringAsync()
        );
        var write = await Result(
            await Rpc(
                agent,
                "tools/call",
                new
                {
                    name = "create_trip",
                    arguments = new { request = new { name = "Denied", description = "" } },
                }
            )
        );
        Assert.IsTrue(write.GetProperty("isError").GetBoolean());
        string challenge = write
            .GetProperty("_meta")
            .GetProperty("mcp/www_authenticate")[0]
            .GetString()!;
        StringAssert.Contains(challenge, "error=\"insufficient_scope\"");
        StringAssert.Contains(challenge, "error_description=\"");
        StringAssert.Contains(challenge, "scope=\"tripplanner.write\"");
        Assert.IsEmpty(factory.Database.Trips);
        using var tokenClient = CreateClient(factory);
        var refreshed = await tokenClient.PostAsync(
            "/oauth/token",
            new FormUrlEncodedContent(
                new Dictionary<string, string>
                {
                    ["grant_type"] = "refresh_token",
                    ["client_id"] = "chatgpt",
                    ["resource"] = Resource,
                    ["refresh_token"] = token.GetProperty("refresh_token").GetString()!,
                    ["scope"] = "tripplanner.write",
                }
            )
        );
        Assert.AreEqual(HttpStatusCode.BadRequest, refreshed.StatusCode);
        var validRefresh = await tokenClient.PostAsync(
            "/oauth/token",
            new FormUrlEncodedContent(
                new Dictionary<string, string>
                {
                    ["grant_type"] = "refresh_token",
                    ["client_id"] = "chatgpt",
                    ["resource"] = Resource,
                    ["refresh_token"] = token.GetProperty("refresh_token").GetString()!,
                }
            )
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            validRefresh.StatusCode,
            await validRefresh.Content.ReadAsStringAsync()
        );
        var refreshedTokens = await validRefresh.Content.ReadFromJsonAsync<JsonElement>();
        string newAccess = refreshedTokens.GetProperty("access_token").GetString()!;
        var revoked = await tokenClient.PostAsync(
            "/oauth/revoke",
            new FormUrlEncodedContent(
                new Dictionary<string, string>
                {
                    ["client_id"] = "chatgpt",
                    ["token"] = access,
                    ["token_type_hint"] = "access_token",
                }
            )
        );
        Assert.AreEqual(HttpStatusCode.OK, revoked.StatusCode);
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await Rpc(agent, "tools/list")).StatusCode);
        SetTestPrincipal(browser, "ada@example.com");
        var status = await browser.GetFromJsonAsync<JsonElement>("/user/mcp-access");
        Assert.IsTrue(status.GetProperty("connected").GetBoolean());
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await browser.DeleteAsync("/user/mcp-access")).StatusCode
        );
        agent.DefaultRequestHeaders.Authorization = new("Bearer", newAccess);
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await Rpc(agent, "tools/list")).StatusCode);
        status = await browser.GetFromJsonAsync<JsonElement>("/user/mcp-access");
        Assert.IsFalse(status.GetProperty("connected").GetBoolean());
    }

    internal static HttpClient CreateClient(TestApplicationFactory factory) =>
        factory.CreateClient(
            new WebApplicationFactoryClientOptions
            {
                BaseAddress = new Uri("https://localhost"),
                AllowAutoRedirect = false,
            }
        );

    internal static async Task<User> SeedAndSetCookie(
        TestApplicationFactory factory,
        HttpClient client,
        string email = "ada@example.com"
    )
    {
        var user = await factory.Database.GetOrCreateUserAsync(
            new("google", email, "Ada Traveler")
        );
        user = await factory.Database.SetUserProfileAsync(user.Id, new(new("Boston", -71, 42), []));
        var principal = new ClaimsPrincipal(
            new ClaimsIdentity(
                new[]
                {
                    new Claim("provider", "google"),
                    new Claim(ClaimTypes.Email, email),
                    new Claim(ClaimTypes.Name, user.DisplayName),
                    new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                },
                "Cookies"
            )
        );
        var options = factory
            .Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
            .Get("Cookies");
        string cookie = options.TicketDataFormat.Protect(
            new AuthenticationTicket(principal, "Cookies")
        );
        client.DefaultRequestHeaders.Add("Cookie", "tripplanner.auth=" + cookie);
        return user;
    }

    internal static void SetTestPrincipal(HttpClient client, string email)
    {
        client.DefaultRequestHeaders.Add("X-Test-Subject", email);
        client.DefaultRequestHeaders.Add("X-Test-Email", email);
        client.DefaultRequestHeaders.Add("X-Test-Name", "Ada Traveler");
    }

    private static Dictionary<string, string> AuthorizationParameters(string scopes) =>
        new()
        {
            ["client_id"] = "chatgpt",
            ["redirect_uri"] = Redirect,
            ["response_type"] = "code",
            ["scope"] = scopes,
            ["state"] = "unpredictable-test-state",
            ["resource"] = Resource,
            ["code_challenge_method"] = "S256",
            ["code_challenge"] = WebEncoders.Base64UrlEncode(
                SHA256.HashData(Encoding.ASCII.GetBytes(Verifier))
            ),
        };

    private static async Task<string> Authorize(HttpClient browser, string scopes)
    {
        var query = AuthorizationParameters(scopes);
        using var post = await SubmitConsent(browser, query, "allow");
        string html = await post.Content.ReadAsStringAsync();
        Assert.AreEqual(HttpStatusCode.OK, post.StatusCode, html);
        StringAssert.Contains(html, "Access approved");
        var callback = ConsentCallback(html, "query");
        var returned = QueryHelpers.ParseQuery(callback.Query);
        Assert.AreEqual(query["state"], returned["state"].ToString());
        Assert.IsTrue(returned.ContainsKey("code"), callback.ToString());
        return returned["code"].ToString();
    }

    private static async Task<HttpResponseMessage> SubmitConsent(
        HttpClient browser,
        Dictionary<string, string> query,
        string decision
    )
    {
        var get = await browser.GetAsync(QueryHelpers.AddQueryString("/oauth/authorize", query!));
        string html = await get.Content.ReadAsStringAsync();
        Assert.AreEqual(HttpStatusCode.OK, get.StatusCode, html);
        StringAssert.Contains(html, "Allow ChatGPT");
        var fields = ConsentFields(html);
        fields["decision"] = decision;
        return await browser.PostAsync("/oauth/authorize", new FormUrlEncodedContent(fields));
    }

    private static Dictionary<string, string> ConsentFields(string html) =>
        Regex
            .Matches(html, "<input[^>]*name=\"([^\"]+)\" value=\"([^\"]*)\"")
            .ToDictionary(
                match => WebUtility.HtmlDecode(match.Groups[1].Value),
                match => WebUtility.HtmlDecode(match.Groups[2].Value)
            );

    private static Uri ConsentCallback(string html, string responseMode)
    {
        if (responseMode == "form_post")
        {
            var form = Regex.Match(html, "<form[^>]*action=\"([^\"]+)\"");
            Assert.IsTrue(form.Success, html);
            return new Uri(
                QueryHelpers.AddQueryString(
                    WebUtility.HtmlDecode(form.Groups[1].Value),
                    ConsentFields(html)!
                )
            );
        }
        var link = Regex.Match(html, "<a class=\"return-to-chatgpt\" href=\"([^\"]+)\"");
        Assert.IsTrue(link.Success, html);
        return new Uri(WebUtility.HtmlDecode(link.Groups[1].Value));
    }

    private static Task<HttpResponseMessage> Exchange(
        HttpClient client,
        string code,
        string verifier = Verifier,
        string resource = Resource
    ) =>
        client.PostAsync(
            "/oauth/token",
            new FormUrlEncodedContent(
                new Dictionary<string, string>
                {
                    ["grant_type"] = "authorization_code",
                    ["client_id"] = "chatgpt",
                    ["code"] = code,
                    ["redirect_uri"] = Redirect,
                    ["resource"] = resource,
                    ["code_verifier"] = verifier,
                }
            )
        );

    internal static async Task<JsonElement> Tokens(HttpClient browser, string scopes)
    {
        string code = await Authorize(browser, scopes);
        var response = await Exchange(browser, code);
        Assert.AreEqual(
            HttpStatusCode.OK,
            response.StatusCode,
            await response.Content.ReadAsStringAsync()
        );
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    internal static Task<HttpResponseMessage> Rpc(
        HttpClient client,
        string method,
        object? parameters = null
    )
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/mcp")
        {
            Content = JsonContent.Create(
                new
                {
                    jsonrpc = "2.0",
                    id = 1,
                    method,
                    @params = parameters ?? new { },
                }
            ),
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        request.Headers.Add("MCP-Protocol-Version", "2025-06-18");
        return client.SendAsync(request);
    }

    internal static async Task<JsonElement> Result(HttpResponseMessage response)
    {
        string body = await response.Content.ReadAsStringAsync();
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode, body);
        if (body.StartsWith("event:") || body.StartsWith("data:"))
        {
            body = body.Split('\n').First(line => line.StartsWith("data:")).Substring(5).Trim();
        }

        var message = JsonSerializer.Deserialize<JsonElement>(body);
        Assert.IsTrue(message.TryGetProperty("result", out var result), body);
        return result.Clone();
    }
}
