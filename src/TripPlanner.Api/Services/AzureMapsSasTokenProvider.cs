using System.Net.Http.Headers;
using System.Net.Http.Json;
using Azure.Core;
using Microsoft.Extensions.Options;
using TripPlanner.Api.Options;

namespace TripPlanner.Api.Services;

public sealed class AzureMapsSasTokenProvider(
    IOptions<AzureMapsOptions> options,
    IHttpClientFactory httpClientFactory,
    TimeProvider timeProvider,
    TokenCredential credential
) : IMapTokenProvider
{
    private static readonly TokenRequestContext ManagementTokenRequest = new([
        "https://management.azure.com/.default",
    ]);

    public async Task<MapToken> GetTokenAsync(CancellationToken cancellationToken = default)
    {
        DateTimeOffset now = timeProvider.GetUtcNow();
        string resourceId = RequiredConfiguration(options.Value.ResourceId, "AzureMaps:ResourceId");
        string sasPrincipalId = RequiredConfiguration(
            options.Value.SasPrincipalId,
            "AzureMaps:SasPrincipalId"
        );
        string endpoint = RequiredConfiguration(options.Value.Endpoint, "AzureMaps:Endpoint")
            .TrimEnd('/');
        DateTimeOffset expiresAt = now.AddHours(2);
        AccessToken managementToken = await credential.GetTokenAsync(
            ManagementTokenRequest,
            cancellationToken
        );

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"https://management.azure.com{resourceId}/listSas?api-version=2023-06-01"
        );
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            managementToken.Token
        );
        request.Content = JsonContent.Create(
            new
            {
                signingKey = "managedIdentity",
                principalId = sasPrincipalId,
                maxRatePerSecond = 50,
                start = now.AddMinutes(-5),
                expiry = expiresAt,
            }
        );

        using HttpResponseMessage response = await httpClientFactory
            .CreateClient()
            .SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        MapsSasResponse? sas = await response.Content.ReadFromJsonAsync<MapsSasResponse>(
            cancellationToken
        );
        if (string.IsNullOrWhiteSpace(sas?.AccountSasToken))
        {
            throw new InvalidOperationException(
                "Azure Maps returned an empty shared access signature."
            );
        }

        return new MapToken(sas.AccountSasToken, endpoint, expiresAt);
    }

    private static string RequiredConfiguration(string? value, string key) =>
        value ?? throw new InvalidOperationException($"Configuration value '{key}' is required.");

    private sealed record MapsSasResponse(string AccountSasToken);
}
