using System.Net;
using System.Text.Json;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;

namespace TripPlanner.Api.Services.ActivityPlanning;

internal static class PlanningProviderRequests
{
    internal sealed class ProviderJson(
        JsonDocument document,
        DateTimeOffset? cacheUntil,
        bool noStore
    ) : IDisposable
    {
        public JsonElement RootElement => document.RootElement;
        public DateTimeOffset? CacheUntil { get; } = cacheUntil;
        public bool NoStore { get; } = noStore;

        public void Dispose() => document.Dispose();
    }

    internal static async Task<ProviderJson> SendAsync(
        Func<HttpRequestMessage> create,
        PlanningProviderBudget budget,
        CancellationToken ct,
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send,
        ActivityPlanningOptions options,
        TimeProvider clock
    )
    {
        await budget.Concurrency.WaitAsync(ct);
        try
        {
            for (int attempt = 0; ; attempt++)
            {
                if (!budget.Take())
                {
                    throw new PlanningProviderException("Provider request budget reached.");
                }

                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(
                    TimeSpan.FromSeconds(Math.Clamp(options.ProviderTimeoutSeconds, 1, 60))
                );
                using var request = create();
                using var response = await send(request, timeout.Token);
                if (
                    attempt == 0
                    && response.StatusCode
                        is HttpStatusCode.TooManyRequests
                            or HttpStatusCode.ServiceUnavailable
                            or HttpStatusCode.BadGateway
                )
                {
                    var delay = response.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(1);
                    if (delay > TimeSpan.FromSeconds(5))
                    {
                        throw new PlanningProviderException(
                            "Provider temporarily unavailable; retry later."
                        );
                    }

                    await Task.Delay(delay, ct);
                    continue;
                }
                if (!response.IsSuccessStatusCode)
                {
                    throw new PlanningProviderException(
                        $"Provider returned HTTP {(int)response.StatusCode}; evidence for these inputs or dates is unavailable."
                    );
                }

                await response.Content.LoadIntoBufferAsync(2_000_000, timeout.Token);
                return new ProviderJson(
                    JsonDocument.Parse(await response.Content.ReadAsByteArrayAsync(timeout.Token)),
                    response.Headers.CacheControl?.MaxAge is { } maxAge
                        ? clock.GetUtcNow() + maxAge
                        : null,
                    response.Headers.CacheControl?.NoStore == true
                );
            }
        }
        catch (HttpRequestException)
        {
            throw new PlanningProviderException(
                "Provider connection failed; cached evidence and estimates remain available."
            );
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new PlanningProviderException("Provider request timed out.");
        }
        finally
        {
            budget.Concurrency.Release();
        }
    }
}
