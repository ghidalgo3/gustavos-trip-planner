using Microsoft.Extensions.Options;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;

namespace TripPlanner.Api.Services;

// The durable queue is in PostgreSQL, so this hosted worker can run on each API instance.
public sealed class PlanningWorker(
    IPlannerDb database,
    IIgnavClient ignav,
    IOptions<IgnavOptions> ignavOptions,
    IOptions<PlanningOptions> planningOptions,
    TimeProvider clock,
    ILogger<PlanningWorker> logger,
    TripFormJobProcessor? formProcessor
) : BackgroundService
{
    private readonly TimeSpan _timeout = TimeSpan.FromSeconds(
        Math.Clamp(ignavOptions.Value.TimeoutSeconds, 1, 1800)
    );

    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var consumers = Enumerable
            .Range(0, Math.Clamp(planningOptions.Value.WorkerConcurrency, 1, 8))
            .Select(_ => ConsumeAsync(stoppingToken))
            .ToList();
        if (formProcessor is not null)
            consumers.Add(ConsumeFormsAsync(stoppingToken));
        return Task.WhenAll(consumers);
    }

    private async Task ConsumeFormsAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await formProcessor!.ProcessNextAsync(stoppingToken))
                    continue;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(
                    exception,
                    "Trip form queue failed; work will resume after its lease expires."
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

    private async Task ConsumeAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await ProcessNextAsync(stoppingToken))
                    continue;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                // Leave the message leased; a subsequent worker can recover it on expiry.
                logger.LogError(
                    "Planning queue failed ({ErrorType}); work will resume after its lease expires.",
                    exception.GetType().Name
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

    public async Task<bool> ProcessNextAsync(CancellationToken cancellationToken = default)
    {
        var work = await database.ClaimFareWorkAsync(
            _timeout + TimeSpan.FromMinutes(2),
            cancellationToken
        );
        if (work is null)
            return false;
        if (work.Attempts > 3)
        {
            await database.CompleteFareWorkAsync(
                work,
                null,
                null,
                "Search could not complete after repeated worker interruptions. Please try planning again.",
                cancellationToken
            );
            return true;
        }
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(_timeout);
        System.Text.Json.JsonElement response;
        try
        {
            response = await ignav.SearchAsync(work.Request, timeout.Token);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
            when (exception
                    is HttpRequestException
                        or OperationCanceledException
                        or System.Text.Json.JsonException
                        or InvalidOperationException
            )
        {
            var transient =
                exception is OperationCanceledException or System.Text.Json.JsonException
                || exception is HttpRequestException { StatusCode: null }
                || exception
                    is HttpRequestException { StatusCode: System.Net.HttpStatusCode.RequestTimeout }
                || exception
                    is HttpRequestException
                    {
                        StatusCode: System.Net.HttpStatusCode.TooManyRequests
                    }
                || exception
                    is HttpRequestException
                    {
                        StatusCode: >= System.Net.HttpStatusCode.InternalServerError
                    };
            if (transient && work.Attempts < 3)
            {
                var delay = TimeSpan.FromSeconds(2 * (1 << (work.Attempts - 1)));
                logger.LogWarning(
                    exception,
                    "Retrying fare search {CacheKey} after attempt {Attempt} in {DelaySeconds} seconds.",
                    work.CacheKey,
                    work.Attempts,
                    delay.TotalSeconds
                );
                await database.RetryFareWorkAsync(work, delay, cancellationToken);
                return true;
            }
            var error = exception switch
            {
                OperationCanceledException => "The flight search timed out. Try planning again.",
                HttpRequestException { StatusCode: { } status } =>
                    $"The flight provider returned HTTP {(int)status}. Try planning again.",
                InvalidOperationException =>
                    "The flight provider is not configured. Contact the trip planner administrator.",
                _ => "The flight provider could not return valid results. Try planning again.",
            };
            await database.CompleteFareWorkAsync(work, null, null, error, cancellationToken);
            return true;
        }
        await database.CompleteFareWorkAsync(
            work,
            response,
            clock.GetUtcNow(),
            null,
            cancellationToken
        );
        return true;
    }
}
