using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Azure.Core;
using Microsoft.Extensions.Options;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.Maps;

namespace TripPlanner.Api.Tests.Services.Maps;

[TestClass]
public class AzureMapsSasTokenProviderTests
{
    [TestMethod]
    public async Task Token_IsValidForTwoHoursAndLimitedToFiftyRequestsPerSecond()
    {
        DateTimeOffset now = DateTimeOffset.Parse("2026-09-19T12:00:00Z");
        var handler = new CaptureHandler();
        var provider = new AzureMapsSasTokenProvider(
            Microsoft.Extensions.Options.Options.Create(
                new AzureMapsOptions
                {
                    ResourceId =
                        "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Maps/accounts/maps",
                    SasPrincipalId = "11111111-1111-1111-1111-111111111111",
                    Endpoint = "https://atlas.microsoft.com/",
                }
            ),
            new TestHttpClientFactory(handler),
            new FixedTimeProvider(now),
            new TestTokenCredential()
        );

        MapToken first = await provider.GetTokenAsync();

        Assert.AreEqual("issued-sas", first.Token);
        Assert.AreEqual("https://atlas.microsoft.com", first.Endpoint);
        Assert.AreEqual(now.AddHours(2), first.ExpiresAt);
        Assert.AreEqual(1, handler.RequestCount);
        Assert.AreEqual(
            "https://management.azure.com/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Maps/accounts/maps/listSas?api-version=2023-06-01",
            handler.RequestUri?.ToString()
        );
        Assert.AreEqual("Bearer", handler.AuthorizationScheme);

        using JsonDocument body = JsonDocument.Parse(handler.RequestBody!);
        JsonElement root = body.RootElement;
        Assert.AreEqual("managedIdentity", root.GetProperty("signingKey").GetString());
        Assert.AreEqual(50, root.GetProperty("maxRatePerSecond").GetInt32());
        Assert.AreEqual(
            "11111111-1111-1111-1111-111111111111",
            root.GetProperty("principalId").GetString()
        );
        Assert.AreEqual(now.AddMinutes(-5), root.GetProperty("start").GetDateTimeOffset());
        Assert.AreEqual(now.AddHours(2), root.GetProperty("expiry").GetDateTimeOffset());
    }

    private sealed class CaptureHandler : HttpMessageHandler
    {
        public int RequestCount { get; private set; }
        public Uri? RequestUri { get; private set; }
        public string? AuthorizationScheme { get; private set; }
        public string? RequestBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        )
        {
            RequestCount++;
            RequestUri = request.RequestUri;
            AuthorizationScheme = request.Headers.Authorization?.Scheme;
            RequestBody = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = JsonContent.Create(new { accountSasToken = "issued-sas" }),
            };
        }
    }

    private sealed class TestHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class TestTokenCredential : TokenCredential
    {
        public override AccessToken GetToken(
            TokenRequestContext requestContext,
            CancellationToken cancellationToken
        ) => new("management-token", DateTimeOffset.MaxValue);

        public override ValueTask<AccessToken> GetTokenAsync(
            TokenRequestContext requestContext,
            CancellationToken cancellationToken
        ) => ValueTask.FromResult(new AccessToken("management-token", DateTimeOffset.MaxValue));
    }
}
