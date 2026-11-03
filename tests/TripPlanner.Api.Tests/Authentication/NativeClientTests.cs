using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.WebUtilities;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Tests.Mcp;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Authentication;

[TestClass]
public sealed class NativeClientTests
{
    [TestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public async Task NativePkceClientUsesBearerWithoutCookiesOrOriginAndHonorsScopes(bool writable)
    {
        await using var factory = new TestApplicationFactory
        {
            McpEnabled = true,
            UseNativeAuthentication = true,
        };
        using var browser = McpEndpointTests.CreateClient(factory);
        var user = await McpEndpointTests.SeedAndSetCookie(factory, browser);
        var trip = await factory.Database.CreateTripAsync(user.Id, "Native trip", "");
        const string verifier = "native-client-pkce-verifier-012345678901234567890123456789";
        const string callback = "com.example.tripplanner:/oauth/callback";
        var parameters = new Dictionary<string, string?>
        {
            ["client_id"] = "tripplanner-mobile",
            ["redirect_uri"] = callback,
            ["response_type"] = "code",
            ["scope"] = writable
                ? "tripplanner.read tripplanner.write offline_access"
                : "tripplanner.read offline_access",
            ["resource"] = "https://localhost/api",
            ["state"] = "native-state",
            ["code_challenge_method"] = "S256",
            ["code_challenge"] = WebEncoders.Base64UrlEncode(
                SHA256.HashData(Encoding.ASCII.GetBytes(verifier))
            ),
        };
        using var consent = await browser.GetAsync(
            QueryHelpers.AddQueryString("/oauth/authorize", parameters)
        );
        var html = await consent.Content.ReadAsStringAsync();
        Assert.AreEqual(HttpStatusCode.OK, consent.StatusCode, html);
        StringAssert.Contains(html, "Allow TripPlanner mobile");
        StringAssert.Contains(
            consent.Headers.GetValues("Content-Security-Policy").Single(),
            "form-action 'self' com.example.tripplanner:;"
        );
        var fields = Regex
            .Matches(html, "<input[^>]*name=\"([^\"]+)\" value=\"([^\"]*)\"")
            .ToDictionary(
                m => WebUtility.HtmlDecode(m.Groups[1].Value),
                m => WebUtility.HtmlDecode(m.Groups[2].Value)
            );
        fields["decision"] = "allow";
        using var accepted = await browser.PostAsync(
            "/oauth/authorize",
            new FormUrlEncodedContent(fields)
        );
        Assert.AreEqual(
            HttpStatusCode.Redirect,
            accepted.StatusCode,
            await accepted.Content.ReadAsStringAsync()
        );
        var returned = QueryHelpers.ParseQuery(accepted.Headers.Location!.Query);
        Assert.AreEqual(callback, accepted.Headers.Location.GetLeftPart(UriPartial.Path));
        Assert.AreEqual("native-state", returned["state"].ToString());
        using var native = McpEndpointTests.CreateClient(factory);
        using var tokenResponse = await native.PostAsync(
            "/oauth/token",
            new FormUrlEncodedContent(
                new Dictionary<string, string>
                {
                    ["grant_type"] = "authorization_code",
                    ["client_id"] = "tripplanner-mobile",
                    ["redirect_uri"] = callback,
                    ["code"] = returned["code"].ToString(),
                    ["resource"] = "https://localhost/api",
                    ["code_verifier"] = verifier,
                }
            )
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            tokenResponse.StatusCode,
            await tokenResponse.Content.ReadAsStringAsync()
        );
        var tokens = await tokenResponse.Content.ReadFromJsonAsync<JsonElement>();
        native.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            tokens.GetProperty("access_token").GetString()
        );
        using var profileResponse = await native.GetAsync("/user");
        Assert.AreEqual(HttpStatusCode.OK, profileResponse.StatusCode);
        var profile = await profileResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.AreEqual(user.Id.ToString(), profile.GetProperty("id").GetString());
        using var snapshot = await native.GetAsync($"/trips/{trip.Id}/snapshot");
        Assert.AreEqual(
            HttpStatusCode.OK,
            snapshot.StatusCode,
            await snapshot.Content.ReadAsStringAsync()
        );
        using var read = await native.GetAsync($"/trips/{trip.Id}");
        using var write = new HttpRequestMessage(HttpMethod.Put, $"/trips/{trip.Id}")
        {
            Content = JsonContent.Create(new UpdateTripRequest("Native edit", "")),
        };
        write.Headers.IfMatch.Add(read.Headers.ETag!);
        using var saved = await native.SendAsync(write);
        Assert.AreEqual(writable ? HttpStatusCode.OK : HttpStatusCode.Forbidden, saved.StatusCode);
        // API tokens are not MCP tokens, even when they carry the same named scopes.
        using var wrongAudience = await McpEndpointTests.Rpc(native, "tools/list");
        Assert.IsTrue(
            wrongAudience.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.Unauthorized
        );
        using var anonymous = McpEndpointTests.CreateClient(factory);
        using var denied = await anonymous.GetAsync($"/trips/{trip.Id}/snapshot");
        Assert.AreEqual(HttpStatusCode.Unauthorized, denied.StatusCode);
        Assert.IsNull(
            denied.Headers.Location,
            "REST authentication failures must not redirect to HTML."
        );
    }
}
