using System.Security.Cryptography;
using System.Text;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Destinations;
using TripPlanner.Api.Telemetry;

namespace TripPlanner.Api.Services.Activities;

public sealed class ActivityJobProcessor(
    IPlannerDb database,
    DestinationService destinations,
    IActivityAssistant assistant,
    IActivityPlaceResolver places,
    IActivityVenueResearch research,
    IActivityCoordinateResearch coordinateResearch,
    ILogger<ActivityJobProcessor> logger
)
{
    public async Task<bool> ProcessNextAsync(CancellationToken cancellationToken = default)
    {
        ActivityJob? job = await database.ClaimActivityJobAsync(
            TimeSpan.FromMinutes(3),
            cancellationToken
        );
        if (job is null)
        {
            return false;
        }
        return await OperationTelemetry.TraceJobAsync(
            "activity_suggestions",
            () => ProcessClaimedAsync(job, cancellationToken),
            cancellationToken
        );
    }

    private async Task<bool> ProcessClaimedAsync(
        ActivityJob job,
        CancellationToken cancellationToken
    )
    {
        if (job.Attempts > 3)
        {
            OperationTelemetry.JobFailed();
            await database.CompleteActivityJobAsync(
                job,
                null,
                [],
                "Activity suggestions could not complete after repeated interruptions.",
                cancellationToken
            );
            return true;
        }
        try
        {
            Trip? trip = await database.GetTripAsync(job.UserId, job.TripId, cancellationToken);
            User? user = await database.GetUserAsync(job.UserId, cancellationToken);
            if (
                trip is null
                || user is null
                || !user.FeatureFlags.Split(',').Contains("LLM", StringComparer.Ordinal)
            )
            {
                throw new InvalidOperationException(
                    "Access to the trip or activity assistant was removed."
                );
            }

            DestinationSnapshot? snapshot = await destinations.GetAsync(
                user.Id,
                trip,
                cancellationToken
            );
            var destination = snapshot?.Find(job.CityId);
            if (
                destination is null
                || destination.Properties.ContextVersion != job.DestinationContext
            )
            {
                throw new InvalidOperationException("Destination changed. Try again.");
            }

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(120));
            IReadOnlyList<ActivityCandidate> candidates = await assistant.SuggestAsync(
                destination.Properties.Name,
                destination.Properties.CountryCode,
                destination.Properties.Stays,
                job.Input,
                ActivityImagePayload.Decode(job.Image, job.ImageMimeType),
                timeout.Token
            );
            var existing = await database.GetActivitiesAsync(
                user.Id,
                job.TripId,
                job.CityId,
                cancellationToken
            );
            var names = existing
                .Select(a => a.Properties.Name.Trim())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var activities = new List<Activity>();
            var warnings = new List<string>();
            int index = 0;
            foreach (var candidate in candidates.Take(10))
            {
                int candidateIndex = index++;
                string name = candidate.Name?.Trim() ?? "";
                if (name.Length is < 1 or > 200 || !names.Add(name))
                {
                    warnings.Add("A duplicate or invalid suggestion was skipped.");
                    continue;
                }
                GeoJsonPoint? point = null;
                string placeName = string.IsNullOrWhiteSpace(candidate.PlaceName)
                    ? name
                    : candidate.PlaceName.Trim();
                if (!string.IsNullOrWhiteSpace(placeName))
                {
                    try
                    {
                        point = await places.ResolveAsync(
                            placeName,
                            destination.Properties.Name,
                            destination.Properties.CountryCode,
                            timeout.Token,
                            destination.Geometry
                        );
                    }
                    catch (OperationCanceledException)
                        when (!cancellationToken.IsCancellationRequested)
                    {
                        warnings.Add($"Location lookup for {name} timed out.");
                    }
                    catch (HttpRequestException)
                    {
                        warnings.Add($"Location for {name} could not be verified.");
                    }
                }
                IReadOnlyList<ActivityLink> links = [];
                if (point is null && !timeout.IsCancellationRequested)
                {
                    using var researchTimeout = CancellationTokenSource.CreateLinkedTokenSource(
                        timeout.Token
                    );
                    researchTimeout.CancelAfter(TimeSpan.FromSeconds(20));
                    try
                    {
                        var venue = await research.FindAsync(
                            candidate,
                            destination.Properties.Name,
                            destination.Properties.CountryCode,
                            destination.Properties.Stays,
                            researchTimeout.Token,
                            job.Input
                        );
                        if (venue is not null)
                        {
                            links = [venue.Source];
                            placeName = $"{venue.PlaceName}, {venue.Address}";
                            var verified = await places.ResolveAddressAsync(
                                venue.Address,
                                destination.Properties.Name,
                                destination.Properties.CountryCode,
                                researchTimeout.Token,
                                destination.Geometry,
                                venue.AddressComponents
                            );
                            if (verified is not null)
                            {
                                point = verified;
                            }
                        }
                    }
                    catch (Exception exception)
                        when (exception
                                is HttpRequestException
                                    or InvalidOperationException
                                    or System.Text.Json.JsonException
                                    or OperationCanceledException
                        )
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        warnings.Add($"Venue research for {name} could not be completed.");
                        logger.LogWarning(
                            exception,
                            "Venue research failed for activity in operation {OperationId}",
                            job.OperationId
                        );
                    }
                }
                ActivityLocationSuggestion? locationSuggestion = null;
                if (point is null && !timeout.IsCancellationRequested)
                {
                    try
                    {
                        locationSuggestion = await coordinateResearch.FindAsync(
                            candidate with
                            {
                                PlaceName = placeName,
                            },
                            destination.Properties.Name,
                            destination.Geometry!,
                            timeout.Token
                        );
                    }
                    catch (Exception exception)
                        when (exception
                                is HttpRequestException
                                    or InvalidOperationException
                                    or System.Text.Json.JsonException
                                    or OperationCanceledException
                                    or IOException
                        )
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        logger.LogWarning(
                            exception,
                            "Coordinate research failed for operation {OperationId}",
                            job.OperationId
                        );
                    }
                }
                if (point is null)
                {
                    warnings.Add(
                        locationSuggestion is null
                            ? $"Add a location for {name} if you want it on the map."
                            : $"Review the suggested location for {name} before adding it to the map."
                    );
                }

                ActivityCost? cost =
                    candidate.CostAmount is { } amount
                    && amount >= 0
                    && candidate.CostCurrency is { Length: 3 } currency
                    && currency.All(char.IsAsciiLetter)
                    && candidate.CostBasis is "perPerson" or "total"
                        ? new(amount, currency.ToUpperInvariant(), candidate.CostBasis)
                        : null;
                if (candidate.CostAmount is not null && cost is null)
                {
                    warnings.Add($"Cost for {name} needs review.");
                }

                TimeSpan? duration = new TripPlanner.Api.DTO.DurationRangeAttribute(
                    1,
                    10080
                ).IsValid(candidate.Duration)
                    ? candidate.Duration
                    : null;
                var now = DateTimeOffset.UtcNow;
                byte[] hash = SHA256.HashData(
                    Encoding.UTF8.GetBytes($"{job.OperationId:D}/{candidateIndex}")
                );
                activities.Add(
                    new(
                        new Guid(hash.AsSpan(0, 16)),
                        job.TripId,
                        job.CityId,
                        point,
                        new(
                            name,
                            duration,
                            (candidate.Description ?? "")[
                                ..Math.Min(candidate.Description?.Length ?? 0, 10000)
                            ],
                            cost,
                            ActivityState.Proposed,
                            placeName
                        )
                        {
                            Links = links,
                            LocationSuggestion = locationSuggestion,
                        },
                        now,
                        now,
                        job.OperationId
                    )
                );
            }
            await database.CompleteActivityJobAsync(
                job,
                activities,
                [.. warnings],
                null,
                cancellationToken
            );
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
            when (exception
                    is HttpRequestException
                        or InvalidOperationException
                        or System.Text.Json.JsonException
                        or OperationCanceledException
            )
        {
            OperationTelemetry.JobFailed(exception);
            logger.LogWarning(
                exception,
                "Activity suggestion {OperationId} failed on attempt {Attempt}; HTTP status {StatusCode}",
                job.OperationId,
                job.Attempts,
                exception is HttpRequestException { StatusCode: { } status } ? (int?)status : null
            );
            await database.CompleteActivityJobAsync(
                job,
                null,
                [],
                "Activity suggestions could not be completed. Try again.",
                cancellationToken
            );
        }
        return true;
    }
}
