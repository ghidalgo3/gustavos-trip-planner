using Microsoft.Extensions.Options;
using TripPlanner.Api.Options;

namespace TripPlanner.Api.Services.Maps;

public sealed partial class AzureMapsClient(
    HttpClient client,
    IMapTokenProvider tokens,
    ILogger<AzureMapsClient> logger,
    IOptions<ActivityPlanningOptions> planning,
    TimeProvider clock
) : IAzureMapsClient
{
    private async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken,
        HttpCompletionOption completionOption = HttpCompletionOption.ResponseContentRead
    )
    {
        if (
            request.RequestUri is null
            || request.RequestUri.IsAbsoluteUri
            || request.RequestUri.OriginalString.StartsWith('/')
        )
        {
            throw new ArgumentException(
                "Supply a path relative to the Azure Maps endpoint.",
                nameof(request)
            );
        }

        var token = await tokens.GetTokenAsync(cancellationToken);
        request.RequestUri = new Uri(
            $"{token.Endpoint.TrimEnd('/')}/{request.RequestUri.OriginalString}"
        );
        request.Headers.Remove("Authorization");
        request.Headers.TryAddWithoutValidation("Authorization", $"jwt-sas {token.Token}");
        return await client.SendAsync(request, completionOption, cancellationToken);
    }
}
