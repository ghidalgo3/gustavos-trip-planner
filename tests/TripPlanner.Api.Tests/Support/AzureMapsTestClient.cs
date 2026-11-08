using Microsoft.Extensions.Logging.Abstractions;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.Maps;

namespace TripPlanner.Api.Tests.Support;

internal static class AzureMapsTestClient
{
    public static AzureMapsClient Create(HttpClient client, IMapTokenProvider tokens) =>
        new(
            client,
            tokens,
            NullLogger<AzureMapsClient>.Instance,
            Microsoft.Extensions.Options.Options.Create(new ActivityPlanningOptions()),
            TimeProvider.System
        );
}
