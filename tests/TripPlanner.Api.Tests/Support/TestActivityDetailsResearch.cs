using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Activities;

namespace TripPlanner.Api.Tests.Support;

public sealed class TestActivityDetailsResearch(bool fails = false) : IActivityDetailsResearch
{
    public int Calls { get; private set; }
    public ActivityDetailsSuggestion Suggestion { get; } =
        new(
            new(
                TimeSpan.FromMinutes(90),
                new(
                    "Recommended visit: 60–90 minutes.",
                    new("https://museum.test/visit", "Duration source"),
                    DateTimeOffset.UtcNow
                )
            ),
            new(
                new(20, "EUR", "perPerson"),
                new(
                    "Current standard adult admission; future dates unconfirmed.",
                    new("https://museum.test/tickets", "Cost source"),
                    DateTimeOffset.UtcNow
                )
            )
        );

    public Task<ActivityDetailsSuggestion?> FindAsync(
        Activity activity,
        GeoJsonFeature<DestinationProperties> destination,
        CancellationToken cancellationToken
    )
    {
        Calls++;
        if (fails)
        {
            throw new HttpRequestException("Provider unavailable");
        }
        return Task.FromResult<ActivityDetailsSuggestion?>(Suggestion);
    }
}
