using Microsoft.Extensions.Options;
using TripPlanner.Api.Options;

namespace TripPlanner.Api.Services;

public sealed class ConfiguredMapTokenProvider(IOptions<AzureMapsOptions> options)
    : IMapTokenProvider
{
    public Task<MapToken> GetTokenAsync(CancellationToken cancellationToken = default)
    {
        string token =
            options.Value.SasToken
            ?? throw new InvalidOperationException("AzureMaps:SasToken is required.");
        string endpoint =
            options.Value.Endpoint
            ?? throw new InvalidOperationException("AzureMaps:Endpoint is required.");
        DateTimeOffset expiresAt = options.Value.SasTokenExpiresAt;

        return Task.FromResult(new MapToken(token, endpoint.TrimEnd('/'), expiresAt));
    }
}
