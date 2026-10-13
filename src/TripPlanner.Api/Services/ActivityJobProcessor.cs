using System.Security.Cryptography;
using System.Text;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services;

public sealed class ActivityJobProcessor(
    IPlannerDb database,
    DestinationService destinations,
    IActivityAssistant assistant,
    IActivityPlaceResolver places,
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
            return false;
        if (job.Attempts > 3)
        {
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
                throw new InvalidOperationException(
                    "Access to the trip or activity assistant was removed."
                );
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
                throw new InvalidOperationException("Destination changed. Try again.");
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(120));
            IReadOnlyList<ActivityCandidate> candidates = await assistant.SuggestAsync(
                destination.Properties.Name,
                destination.Properties.CountryCode,
                destination.Properties.Stays,
                job.Input,
                job.Image,
                job.ImageMimeType,
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
                    catch (HttpRequestException)
                    {
                        warnings.Add($"Location for {name} could not be verified.");
                    }
                }
                if (point is null)
                    warnings.Add($"Add a location for {name} if you want it on the map.");
                ActivityCost? cost =
                    candidate.CostAmount is { } amount
                    && amount >= 0
                    && candidate.CostCurrency is { Length: 3 } currency
                    && currency.All(char.IsAsciiLetter)
                    && candidate.CostBasis is "perPerson" or "total"
                        ? new(amount, currency.ToUpperInvariant(), candidate.CostBasis)
                        : null;
                if (candidate.CostAmount is not null && cost is null)
                    warnings.Add($"Cost for {name} needs review.");
                int? duration = candidate.DurationMinutes is > 0 and <= 10080
                    ? candidate.DurationMinutes
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
                            "Proposed",
                            placeName
                        ),
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
            logger.LogWarning(
                exception,
                "Activity suggestion {OperationId} failed",
                job.OperationId
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
