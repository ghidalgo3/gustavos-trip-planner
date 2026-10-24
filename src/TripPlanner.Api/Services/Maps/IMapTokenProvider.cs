namespace TripPlanner.Api.Services.Maps;

public interface IMapTokenProvider
{
    Task<MapToken> GetTokenAsync(CancellationToken cancellationToken = default);
}

public sealed record MapToken(string Token, string Endpoint, DateTimeOffset ExpiresAt);
