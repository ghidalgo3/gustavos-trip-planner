using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services.ActivityPlanning;

public sealed class ActivityPlanningEnrichment(
    IActivityRoutingProvider routing,
    IActivityPreferenceScorer preferences,
    IActivityPlanningResearch research,
    TimeProvider clock
)
{
    public async Task<ActivityPlanningEvidence> EnrichAsync(
        ActivityPlanningContext planningContext,
        ActivityPlan plan,
        bool useAi,
        bool refresh,
        PlanningProviderBudget budget,
        CancellationToken ct
    )
    {
        var evidence = planningContext.Evidence;
        var warnings = new ConcurrentBag<string>();
        async Task Try(Func<Task> work, string label)
        {
            try
            {
                await work();
            }
            catch (Exception e)
                when (e
                        is PlanningProviderException
                            or JsonException
                            or InvalidOperationException
                            or KeyNotFoundException
                            or FormatException
                            or OverflowException
                            or OperationCanceledException
                )
            {
                warnings.Add(
                    label
                        + ": "
                        + (
                            e is PlanningProviderException
                                ? e.Message
                                : "Evidence unavailable or malformed; existing estimates are retained."
                        )
                );
            }
        }
        if (useAi)
        {
            await Try(
                async () =>
                    evidence = evidence with
                    {
                        Affinities = await preferences.AffinityAsync(planningContext, budget, ct),
                        AffinityContext = planningContext.AffinityContext(),
                    },
                "Preference scoring"
            );
            if (
                evidence.AffinityContext == planningContext.AffinityContext()
                && evidence.Affinities.Length
                    < planningContext.Travellers.Length * planningContext.Activities.Length
            )
            {
                warnings.Add(
                    "Preference scoring is partial. Unscored activities retain an explicit neutral estimate."
                );
            }

            await Try(
                async () =>
                    evidence = evidence with
                    {
                        SuggestedRules = await research.InterpretAsync(
                            planningContext,
                            plan,
                            budget,
                            ct
                        ),
                    },
                "Preference interpretation"
            );
            var hours = new ConcurrentDictionary<Guid, ActivityHoursEvidence>(
                evidence.Hours.ToDictionary(h => h.ActivityId)
            );
            var dates = plan.Days.Select(d => d.Date).Distinct().Order().Take(30).ToArray();
            await Parallel.ForEachAsync(
                planningContext.Activities.Take(100),
                new ParallelOptions { MaxDegreeOfParallelism = 4 },
                async (activity, _) =>
                {
                    if (
                        ct.IsCancellationRequested
                        || budget.Exhausted
                        || plan.Rules.Any(r => r.ActivityId == activity.Id && r.AlwaysAvailable)
                    )
                    {
                        return;
                    }

                    if (
                        !refresh
                        && hours.TryGetValue(activity.Id, out var saved)
                        && saved.ActivityContext
                            == ActivityPlanningContext.ActivityContext(activity)
                        && (saved.ExpiresAt ?? saved.RetrievedAt.AddHours(24)) > clock.GetUtcNow()
                        && dates.All(d =>
                            saved.ClosedDates.Contains(d) || saved.Windows.Any(w => w.Date == d)
                        )
                    )
                    {
                        return;
                    }

                    await Try(
                        async () =>
                        {
                            if (
                                await research.HoursAsync(
                                    activity,
                                    planningContext.Place.Name,
                                    dates,
                                    budget,
                                    ct
                                ) is
                                { } researched
                            )
                            {
                                hours[activity.Id] = researched;
                            }
                            else
                            {
                                warnings.Add(
                                    "Opening hours remain unverified for some activities."
                                );
                            }
                        },
                        "Opening-hours research"
                    );
                }
            );
            evidence = evidence with { Hours = hours.Values.OrderBy(h => h.ActivityId).ToArray() };
        }
        evidence = await RoutesAsync(
            planningContext with
            {
                Evidence = evidence,
            },
            [plan],
            useAi,
            budget,
            ct
        );
        if (budget.Exhausted)
        {
            warnings.Add("Provider request budget reached. Unverified inputs remain provisional.");
        }

        if (ct.IsCancellationRequested)
        {
            warnings.Add("Enrichment deadline reached; useful partial evidence was retained.");
        }

        return evidence with
        {
            Warnings = evidence.Warnings.Concat(warnings).Distinct().Take(30).ToArray(),
        };
    }

    public async Task<ActivityPlanningEvidence> RoutesAsync(
        ActivityPlanningContext planningContext,
        ActivityPlan[] plans,
        bool useAi,
        PlanningProviderBudget budget,
        CancellationToken ct
    )
    {
        var routes = new ConcurrentDictionary<string, ActivityRouteEvidence>(
            planningContext
                .Evidence.Routes.Where(r => r.ExpiresAt > clock.GetUtcNow())
                .GroupBy(r => r.Key)
                .ToDictionary(g => g.Key, g => g.Last())
        );
        var warnings = new ConcurrentBag<string>();
        var seen = new HashSet<string>();
        // Re-evaluation can shift departure times. Three bounded passes verify newly selected times;
        // remaining misses stay explicitly provisional instead of reusing a different departure.
        for (int pass = 0; pass < 3 && !ct.IsCancellationRequested && !budget.Exhausted; pass++)
        {
            var requests =
                new List<(
                    GeographyPoint From,
                    GeographyPoint To,
                    DateTimeOffset Departure,
                    string Mode
                )>();
            foreach (var plan in plans)
            {
                var contextWithRoutes = planningContext with
                {
                    Evidence = planningContext.Evidence with { Routes = routes.Values.ToArray() },
                };
                var assessment = contextWithRoutes.Evaluate(plan, clock.GetUtcNow());
                foreach (var day in assessment.Days)
                {
                    foreach (var leg in day.Travel)
                    {
                        if (leg.Departure is not { } departure || leg.Source == "Your estimate")
                        {
                            continue;
                        }

                        GeographyPoint? Point(Guid? id) =>
                            id is { } value
                                ? planningContext
                                    .Activities.FirstOrDefault(a => a.Id == value)
                                    ?.Geometry?.Position
                                : planningContext.StayLocationFor(day.StayId)?.Geometry?.Position;
                        if (
                            Point(leg.FromActivityId) is not { } from
                            || Point(leg.ToActivityId) is not { } to
                        )
                        {
                            continue;
                        }

                        var settings =
                            plan.Days.First(d =>
                                d.StayId == day.StayId && d.Date == day.Date
                            ).Settings
                            ?? plan.Settings;
                        bool automatic =
                            settings.TransportMode is "fastest" or "walking"
                            && !plan.TransportOverrides.Any(t =>
                                t.Date == day.Date
                                && t.FromActivityId == leg.FromActivityId
                                && t.ToActivityId == leg.ToActivityId
                            );
                        foreach (
                            string mode in automatic
                                ? new[] { "walking", "driving" }
                                : new[] { leg.Mode }
                        )
                        {
                            string key = ActivityPlanningContext.RouteKey(
                                from,
                                to,
                                departure,
                                mode
                            );
                            if (!routes.ContainsKey(key) && seen.Add(key))
                            {
                                requests.Add((from, to, departure, mode));
                            }
                        }
                    }
                }
            }
            if (requests.Count == 0)
            {
                break;
            }

            await Parallel.ForEachAsync(
                requests,
                new ParallelOptions { MaxDegreeOfParallelism = 4 },
                async (request, _) =>
                {
                    if (budget.Exhausted || ct.IsCancellationRequested)
                    {
                        return;
                    }

                    try
                    {
                        var choices = await routing.RoutesAsync(
                            request.From,
                            request.To,
                            request.Departure,
                            request.Mode,
                            budget,
                            ct
                        );
                        if (useAi && choices.Length > 1 && !budget.Exhausted)
                        {
                            try
                            {
                                choices = await preferences.TransportAsync(
                                    planningContext,
                                    choices,
                                    budget,
                                    ct
                                );
                            }
                            catch (Exception e)
                                when (e
                                        is PlanningProviderException
                                            or JsonException
                                            or InvalidOperationException
                                            or OperationCanceledException
                                )
                            {
                                warnings.Add(
                                    "Transport preference scoring unavailable; fastest returned route retained."
                                );
                            }
                        }
                        if (
                            choices
                                .OrderBy(c => c.Duration)
                                .ThenByDescending(c => c.PreferenceScore)
                                .FirstOrDefault() is
                            { } chosen
                        )
                        {
                            routes[chosen.Key] = chosen;
                        }
                        else
                        {
                            warnings.Add(
                                "Some routes or requested dates are unsupported; distance estimates remain provisional."
                            );
                        }
                    }
                    catch (Exception e)
                        when (e
                                is PlanningProviderException
                                    or JsonException
                                    or InvalidOperationException
                                    or KeyNotFoundException
                                    or FormatException
                                    or OverflowException
                                    or OperationCanceledException
                        )
                    {
                        warnings.Add(
                            request.Mode
                                + ": "
                                + (
                                    e is PlanningProviderException
                                        ? e.Message
                                        : "Routing evidence unavailable or malformed."
                                )
                        );
                    }
                }
            );
        }
        return planningContext.Evidence with
        {
            Routes = routes.Values.OrderBy(r => r.Key).Take(5000).ToArray(),
            Warnings = planningContext
                .Evidence.Warnings.Concat(warnings)
                .Distinct()
                .Take(30)
                .ToArray(),
        };
    }
}
