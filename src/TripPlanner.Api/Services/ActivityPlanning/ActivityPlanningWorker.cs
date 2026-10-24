using Microsoft.Extensions.Options;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Telemetry;

namespace TripPlanner.Api.Services.ActivityPlanning;

public sealed class ActivityPlanningJobProcessor(
    IPlannerDb database,
    ActivityPlanningService service,
    IActivityPlanOptimizer optimizer,
    ActivityPlanningEnrichment enrichment,
    IOptions<ActivityPlanningOptions> options,
    TimeProvider clock
)
{
    public async Task<bool> ProcessNextAsync(CancellationToken stoppingToken = default)
    {
        var job = await database.ClaimActivityPlanningJobAsync(
            TimeSpan.FromSeconds(Math.Clamp(options.Value.JobTimeoutSeconds, 10, 180) + 30),
            stoppingToken
        );
        if (job is null)
        {
            return false;
        }
        return await OperationTelemetry.TraceJobAsync(
            "activity_planning",
            () => ProcessClaimedAsync(job, stoppingToken),
            stoppingToken
        );
    }

    private async Task<bool> ProcessClaimedAsync(
        ActivityPlanningJob job,
        CancellationToken stoppingToken
    )
    {
        ActivityPlanningResult? latest = null;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        timeout.CancelAfter(
            TimeSpan.FromSeconds(Math.Clamp(options.Value.JobTimeoutSeconds, 10, 180))
        );
        using var budget = new PlanningProviderBudget(
            Math.Clamp(options.Value.ProviderRequestLimit, 0, 500)
        );
        async Task<bool> Authorized() =>
            await database.GetTripAsync(job.UserId, job.TripId, stoppingToken) is not null
            && (
                !job.UseAi
                || (await database.GetUserAsync(job.UserId, stoppingToken))
                    ?.FeatureFlags.Split(',')
                    .Contains("LLM") == true
            );
        async Task Publish(ActivityPlanningResult result)
        {
            if (!await Authorized())
            {
                throw new ActivityPlanningChangedException();
            }

            latest = result;
            await database.CompleteActivityPlanningJobAsync(
                job,
                result,
                null,
                false,
                stoppingToken
            );
        }
        try
        {
            if (job.Attempts > 3)
            {
                throw new ActivityPlanningChangedException();
            }

            if (!await Authorized())
            {
                throw new ActivityPlanningChangedException();
            }

            var planningContext = await service.ReadAsync(
                job.UserId,
                job.TripId,
                job.CityId,
                stoppingToken
            );
            if (
                planningContext is null
                || planningContext.InputRevision != job.InputRevision
                || (planningContext.SavedPlan?.Version ?? 0) != job.PlanVersion
            )
            {
                throw new ActivityPlanningChangedException();
            }

            await Publish(
                service.Assess(planningContext, job.Plan, job.Id) with
                {
                    Kind = job.Kind,
                    Status = "enriching",
                }
            );
            if (job.RefreshEvidence || job.UseAi)
            {
                var evidence = await enrichment.EnrichAsync(
                    planningContext,
                    job.Plan,
                    job.UseAi,
                    job.RefreshEvidence,
                    budget,
                    timeout.Token
                );
                if (
                    !await Authorized()
                    || !await database.SaveActivityPlanningEvidenceAsync(
                        job.UserId,
                        job.TripId,
                        job.CityId,
                        evidence,
                        planningContext.InputRevision,
                        stoppingToken
                    )
                )
                {
                    throw new ActivityPlanningChangedException();
                }

                planningContext =
                    await service.ReadAsync(job.UserId, job.TripId, job.CityId, stoppingToken)
                    ?? throw new ActivityPlanningChangedException();
                if ((planningContext.SavedPlan?.Version ?? 0) != job.PlanVersion)
                {
                    throw new ActivityPlanningChangedException();
                }
            }
            if (job.Kind == "assessment")
            {
                latest = service.Assess(planningContext, job.Plan, job.Id);
            }
            else if (!timeout.IsCancellationRequested)
            {
                var dismissed = await database.GetDismissedActivitySuggestionsAsync(
                    job.UserId,
                    job.TripId,
                    job.CityId,
                    ActivityPlanningService.ContextVersion(planningContext),
                    job.PlanVersion,
                    stoppingToken
                );
                latest = await optimizer.ProposeAsync(
                    planningContext,
                    job,
                    dismissed,
                    Publish,
                    timeout.Token
                );
                if (
                    job.RefreshEvidence
                    && latest.Alternatives.Length > 0
                    && !timeout.IsCancellationRequested
                )
                {
                    var evidence = await enrichment.RoutesAsync(
                        planningContext,
                        latest.Alternatives.Select(a => a.Plan).ToArray(),
                        job.UseAi,
                        budget,
                        timeout.Token
                    );
                    if (
                        !await database.SaveActivityPlanningEvidenceAsync(
                            job.UserId,
                            job.TripId,
                            job.CityId,
                            evidence,
                            planningContext.InputRevision,
                            stoppingToken
                        )
                    )
                    {
                        throw new ActivityPlanningChangedException();
                    }

                    planningContext =
                        await service.ReadAsync(job.UserId, job.TripId, job.CityId, stoppingToken)
                        ?? throw new ActivityPlanningChangedException();
                    latest = latest with
                    {
                        ContextVersion = ActivityPlanningService.ContextVersion(planningContext),
                        Assessment = planningContext.Evaluate(job.Plan, clock.GetUtcNow()),
                        Alternatives = latest
                            .Alternatives.Select(a =>
                                a with
                                {
                                    Assessment = planningContext.Evaluate(
                                        a.Plan,
                                        clock.GetUtcNow()
                                    ),
                                }
                            )
                            .Where(a => a.Assessment.ConflictCount == 0)
                            .ToArray(),
                        Suggestions = latest
                            .Suggestions.Select(s =>
                                s with
                                {
                                    Assessment = planningContext.Evaluate(
                                        s.Plan,
                                        clock.GetUtcNow()
                                    ),
                                }
                            )
                            .Where(s => s.Assessment.ConflictCount == 0)
                            .ToArray(),
                        Warnings = evidence.Warnings,
                    };
                }
            }
            if (
                !await Authorized()
                || await database.GetActivityPlanningRevisionAsync(
                    job.UserId,
                    job.TripId,
                    stoppingToken
                ) != planningContext.InputRevision
                || (
                    await database.GetActivityPlanAsync(
                        job.UserId,
                        job.TripId,
                        job.CityId,
                        stoppingToken
                    )
                )?.Version != planningContext.SavedPlan?.Version
            )
            {
                throw new ActivityPlanningChangedException();
            }

            if (timeout.IsCancellationRequested && latest is not null)
            {
                OperationTelemetry.JobFailed();
                latest = latest with
                {
                    Status = "timeout",
                    Warnings = latest
                        .Warnings.Append(
                            "Job deadline reached; available partial results are shown."
                        )
                        .ToArray(),
                };
            }

            await database.CompleteActivityPlanningJobAsync(job, latest, null, true, stoppingToken);
        }
        catch (OperationCanceledException exception) when (!stoppingToken.IsCancellationRequested)
        {
            OperationTelemetry.JobFailed(exception);
            await database.CompleteActivityPlanningJobAsync(
                job,
                latest is null ? null : latest with { Status = "timeout" },
                latest is null ? "Job deadline reached." : null,
                true,
                stoppingToken
            );
        }
        catch (Exception e)
            when (!stoppingToken.IsCancellationRequested && e is not OutOfMemoryException)
        {
            OperationTelemetry.JobFailed(e);
            // Never persist provider exception bodies: URLs, keys or profile text can occur in them.
            await database.CompleteActivityPlanningJobAsync(
                job,
                null,
                e is ActivityPlanningChangedException
                    ? "Planning inputs or permissions changed. Read the plan and start a new request."
                    : "Planning could not complete. Existing manual plans remain available.",
                true,
                stoppingToken
            );
        }
        return true;
    }
}

public sealed class ActivityPlanningWorker(
    ActivityPlanningJobProcessor processor,
    ILogger<ActivityPlanningWorker> logger
) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await processor.ProcessNextAsync(stoppingToken))
                {
                    continue;
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception)
            {
                logger.LogError(
                    "Activity planning queue unavailable; work will resume after its lease expires."
                );
            }
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }
}
