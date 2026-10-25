using System.Diagnostics;
using Google.OrTools.Sat;
using Microsoft.Extensions.Options;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using Activity = TripPlanner.Api.Models.Activity;

namespace TripPlanner.Api.Services.ActivityPlanning;

public interface IActivityPlanOptimizer
{
    Task<ActivityPlanningResult> ProposeAsync(
        ActivityPlanningContext planningContext,
        ActivityPlanningJob job,
        string[] dismissed,
        Func<ActivityPlanningResult, Task> progress,
        CancellationToken ct
    );
}

public sealed class ActivityPlanOptimizer(
    IOptions<ActivityPlanningOptions> options,
    TimeProvider clock
) : IActivityPlanOptimizer
{
    // CP-SAT variables are integral. Duration objects remain in the rest of the planner.
    private static int SolverMinutes(TimeSpan duration) =>
        checked((int)Math.Ceiling(duration.TotalMinutes));

    public async Task<ActivityPlanningResult> ProposeAsync(
        ActivityPlanningContext planningContext,
        ActivityPlanningJob job,
        string[] dismissed,
        Func<ActivityPlanningResult, Task> progress,
        CancellationToken ct
    )
    {
        bool scheduleSelected = job.Kind == "schedule";
        var baseline = planningContext.Evaluate(job.Plan, clock.GetUtcNow());
        var alternatives = new List<ActivityPlanAlternative>();
        var warnings = new List<string>(planningContext.Evidence.Warnings);
        ActivityPlanningResult Result(string status) =>
            new(
                job.Id,
                job.Kind,
                status,
                planningContext.SavedPlan?.Version ?? 0,
                ActivityPlanningService.ContextVersion(planningContext),
                baseline,
                [.. alternatives],
                status == "optimizing" || scheduleSelected
                    ? []
                    : Suggestions(planningContext, job.Plan, alternatives, dismissed),
                [.. warnings]
            )
            {
                SuggestedRules = planningContext.Evidence.SuggestedRules,
                RuleChanges = RuleChanges(job.Plan, baseline),
            };
        if (
            planningContext.Activities.Length > options.Value.MaxActivities
            || job.Plan.Days.Length > options.Value.MaxDays
        )
        {
            warnings.Add(
                $"Optimization supports {options.Value.MaxActivities} candidates and {options.Value.MaxDays} destination days. Manual planning and assessment remain available."
            );
            return Result("limit_exceeded");
        }
        if (job.Plan.Days.Length == 0)
        {
            warnings.Add("Add dated visits before generating a schedule.");
            return Result("insufficient_evidence");
        }
        if (scheduleSelected && job.Plan.SelectedActivityIds.Length == 0)
        {
            warnings.Add("Mark activities Planned before asking to schedule them.");
            return Result("insufficient_evidence");
        }
        var zone = ActivityPlanRules.Zone(
            ActivityPlanRules.EffectiveTimeZone(job.Plan, planningContext)
        );
        if (zone is null)
        {
            warnings.Add(
                "The city time zone could not be resolved automatically. Reload the plan and retry."
            );
            return Result("insufficient_evidence");
        }
        if (ContradictoryRestrictions(job.Plan))
        {
            warnings.Add(
                "A required activity is excluded, or required relative-order rules form a cycle. No schedule can satisfy these restrictions together. Changes to restrictions require a separate choice."
            );
            return Result("proven_infeasible");
        }
        var stopwatch = Stopwatch.StartNew();
        // Spatially grouped, independently checked incumbents make useful partial
        // results available while CP-SAT presolves larger instances.
        var seed = Seed(planningContext, job.Plan, ct, scheduleSelected);
        if (seed is not null)
        {
            alternatives.Add(
                new(
                    scheduleSelected ? "travel" : "overall",
                    scheduleSelected ? "Suggested schedule" : "Overall fit",
                    seed,
                    planningContext.Evaluate(seed, clock.GetUtcNow())
                )
            );
            await progress(Result("optimizing"));
        }
        bool timedOut = false;
        long bestUtility = 0;
        foreach (
            string objective in scheduleSelected
                ? new[] { "travel" }
                : new[] { "overall", "balanced", "travel" }
        )
        {
            ct.ThrowIfCancellationRequested();
            double remaining =
                Math.Clamp(options.Value.SolverSeconds, 1, 120) - stopwatch.Elapsed.TotalSeconds;
            if (remaining <= .05)
            {
                timedOut = true;
                break;
            }
            var model = Build(
                planningContext,
                job.Plan,
                seed ?? job.Plan,
                zone,
                objective,
                bestUtility,
                ct,
                scheduleSelected
            );
            remaining =
                Math.Clamp(options.Value.SolverSeconds, 1, 120) - stopwatch.Elapsed.TotalSeconds;
            if (remaining <= .05)
            {
                timedOut = true;
                break;
            }
            using var solver = new CpSolver();
            solver.StringParameters = FormattableString.Invariant(
                $"max_time_in_seconds:{remaining / (objective == "overall" ? 3 : objective == "balanced" ? 2 : 1):0.###} num_search_workers:2 random_seed:17"
            );
            using var cancellation = ct.Register(solver.StopSearch);
            ActivityPlanAlternative? best = alternatives.FirstOrDefault(a => a.Id == objective);
            var callback = new SolutionCallback(solution =>
            {
                var plan = Read(model, job.Plan, solution);
                var assessment = planningContext.Evaluate(plan, clock.GetUtcNow());
                if (assessment.ConflictCount > 0 || assessment.Status == "incomplete")
                {
                    return;
                }
                // Route and meal approximations in the solver never override the independent evaluator.
                long utility = Utility(planningContext, plan);
                if (
                    objective == "travel"
                    && (
                        utility * 10 < bestUtility * 9
                        || assessment.GroupUtility * 10 + 1e-9
                            < alternatives
                                .Select(a => a.Assessment.GroupUtility)
                                .DefaultIfEmpty(0)
                                .Max() * 9
                    )
                )
                {
                    return;
                }

                var candidate = new ActivityPlanAlternative(
                    objective,
                    scheduleSelected
                        ? "Suggested schedule"
                        : objective switch
                        {
                            "overall" => "Overall fit",
                            "balanced" => "Balanced interests",
                            _ => "Less travel",
                        },
                    plan,
                    assessment
                );
                if (best is not null && !Better(candidate, best, objective, job.Plan))
                {
                    return;
                }

                best = candidate;
                var previous = alternatives.FindIndex(a => a.Id == objective);
                if (previous >= 0)
                {
                    alternatives[previous] = candidate;
                }
                else
                {
                    alternatives.Add(candidate);
                }

                progress(Result("optimizing")).GetAwaiter().GetResult();
            });
            CpSolverStatus status = await Task.Run(
                () => solver.Solve(model.Model, callback),
                CancellationToken.None
            );
            if (status is CpSolverStatus.Feasible or CpSolverStatus.Unknown)
            {
                timedOut = true;
            }

            bestUtility =
                alternatives.Count > 0
                    ? alternatives.Max(a => Utility(planningContext, a.Plan))
                    : 0;
            if (status == CpSolverStatus.ModelInvalid)
            {
                throw new InvalidOperationException("The activity optimization model was invalid.");
            }
        }
        if (alternatives.Count == 0)
        {
            if (scheduleSelected)
            {
                warnings.Add(
                    "All selected activities were kept required. Try more time or fewer planned activities; none have been removed from your plan."
                );
            }
            warnings.Add(
                "No independently validated schedule was found. This is not a proof that every possible schedule is infeasible; review the listed restrictions and uncertain evidence."
            );
            return Result(timedOut ? "timeout" : "no_feasible_candidate");
        }
        bool changed = alternatives.Any(a =>
            ActivityPlanRules.Hash(a.Plan) != ActivityPlanRules.Hash(job.Plan)
        );
        return Result(
            timedOut ? "timeout"
            : changed ? "completed"
            : "no_improvement_found"
        );
    }

    private ActivityPlan? Seed(
        ActivityPlanningContext planningContext,
        ActivityPlan original,
        CancellationToken ct,
        bool scheduleSelected = false
    )
    {
        var budget = Stopwatch.StartNew();
        var plan = original with
        {
            SelectedActivityIds = [],
            Days = original
                .Days.OrderBy(d => d.Date)
                .Select(d => d with { ActivityIds = [], MealPositions = null })
                .ToArray(),
        };
        var rules = original.Rules.ToDictionary(r => r.ActivityId);
        var remaining = planningContext
            .Activities.Where(a => !original.ExcludedActivityIds.Contains(a.Id))
            .Where(a => !scheduleSelected || original.SelectedActivityIds.Contains(a.Id))
            .OrderByDescending(a =>
                rules.GetValueOrDefault(a.Id) is { } r
                && (r.MustDo || r.FixedDate is not null || r.FixedStart is not null)
            )
            .ThenBy(a => rules.GetValueOrDefault(a.Id)?.FixedDate)
            .ThenBy(a => rules.GetValueOrDefault(a.Id)?.FixedStart)
            .ThenBy(a => a.Geometry?.Position.Longitude)
            .ThenBy(a => a.Geometry?.Position.Latitude)
            .ToList();
        int nextDay = 0;
        while (remaining.Count > 0 && budget.Elapsed < TimeSpan.FromSeconds(2))
        {
            ct.ThrowIfCancellationRequested();
            int index = remaining.FindIndex(a =>
                rules.GetValueOrDefault(a.Id)?.AfterActivityId is not { } after
                || plan.SelectedActivityIds.Contains(after)
            );
            if (index < 0)
            {
                break;
            }

            var activity = remaining[index];
            remaining.RemoveAt(index);
            for (
                int offset = 0;
                offset < plan.Days.Length && budget.Elapsed < TimeSpan.FromSeconds(2);
                offset++
            )
            {
                int d = (nextDay + offset) % plan.Days.Length;
                if (
                    rules.GetValueOrDefault(activity.Id)?.FixedDate is { } date
                    && date != plan.Days[d].Date
                )
                {
                    continue;
                }

                var candidate = plan with
                {
                    SelectedActivityIds = [.. plan.SelectedActivityIds, activity.Id],
                    Days = plan
                        .Days.Select(
                            (day, at) =>
                                at == d
                                    ? day with
                                    {
                                        MealPositions = null,
                                        ActivityIds = [.. day.ActivityIds, activity.Id],
                                    }
                                    : day
                        )
                        .ToArray(),
                };
                var assessment = planningContext.Evaluate(candidate, clock.GetUtcNow());
                if (
                    assessment.Issues.Any(i =>
                        i.Severity == "conflict" && i.Code != "must_do_missing"
                    )
                )
                {
                    continue;
                }

                plan = candidate;
                nextDay = d;
                break;
            }
        }
        var result = planningContext.Evaluate(plan, clock.GetUtcNow());
        if (
            scheduleSelected
            && !original.SelectedActivityIds.ToHashSet().SetEquals(plan.SelectedActivityIds)
        )
        {
            return null;
        }
        return result.ConflictCount == 0 && result.Status != "incomplete" ? plan : null;
    }

    private sealed record SolverModel(
        CpModel Model,
        Activity[] Activities,
        ActivityPlanDay[] Days,
        BoolVar[] Selected,
        BoolVar[,] Assigned,
        IntVar[] Starts
    );

    private SolverModel Build(
        ActivityPlanningContext planningContext,
        ActivityPlan plan,
        ActivityPlan hint,
        TimeZoneInfo zone,
        string objective,
        long bestUtility,
        CancellationToken ct,
        bool scheduleSelected = false
    )
    {
        var activities = planningContext
            .Activities.OrderBy(a =>
                a.Geometry?.Position.Longitude ?? planningContext.Place.Longitude
            )
            .ThenBy(a => a.Geometry?.Position.Latitude ?? planningContext.Place.Latitude)
            .ThenBy(a => a.Id)
            .ToArray();
        var days = plan.Days.OrderBy(d => d.Date).ToArray();
        int n = activities.Length,
            dCount = days.Length;
        var model = new CpModel();
        var selected = Enumerable
            .Range(0, n)
            .Select(i => model.NewBoolVar($"selected_{i}"))
            .ToArray();
        var assigned = new BoolVar[n, dCount];
        var firstInDay = new BoolVar[n, dCount];
        var lastInDay = new BoolVar[n, dCount];
        var starts = Enumerable
            .Range(0, n)
            .Select(i => model.NewIntVar(0, dCount * 2880, $"start_{i}"))
            .ToArray();
        var dayOf = Enumerable
            .Range(0, n)
            .Select(i => model.NewIntVar(0, dCount - 1, $"day_{i}"))
            .ToArray();
        var durations = activities
            .Select(a =>
                SolverMinutes(
                    plan.Rules.FirstOrDefault(r => r.ActivityId == a.Id)?.Duration
                        ?? a.Properties.Duration
                        ?? TimeSpan.FromHours(1)
                )
            )
            .ToArray();
        var travelTerms = new List<LinearExpr>();
        var changeTerms = new List<LinearExpr>();
        var dailyTravel = Enumerable.Range(0, dCount).Select(_ => new List<LinearExpr>()).ToArray();
        var outgoingTravel = Enumerable.Range(0, n).Select(_ => new List<LinearExpr>()).ToArray();
        var circuit = model.AddCircuit();
        var origins = new DateTimeOffset[dCount];
        var capacity = new int[dCount];
        for (int d = 0; d < dCount; d++)
        {
            var settings = days[d].Settings ?? plan.Settings;
            TimeSpan wake = settings.SleepEnd.ToTimeSpan(),
                sleep = settings.SleepStart.ToTimeSpan();
            if (sleep <= wake)
            {
                sleep += TimeSpan.FromDays(1);
            }

            TimeSpan from = days[d].AvailableFrom is { } f
                ? ActivityPlanRules.DayOffset(f, settings)
                : wake;
            if (from < wake)
            {
                from = wake;
            }
            TimeSpan until = days[d].AvailableUntil is { } u
                ? ActivityPlanRules.DayOffset(u, settings)
                : sleep;
            origins[d] =
                ActivityPlanRules.Instant(days[d].Date, from, zone)
                ?? new DateTimeOffset(
                    days[d].Date.ToDateTime(TimeOnly.MinValue),
                    TimeSpan.Zero
                ).Add(from);
            var end = ActivityPlanRules.Instant(days[d].Date, sleep < until ? sleep : until, zone);
            capacity[d] = end is null
                ? 0
                : Math.Max(
                    0,
                    (int)(end.Value - origins[d]).TotalMinutes
                        - SolverMinutes(settings.SlackDuration)
                );
            var empty = model.NewBoolVar($"empty_{d}");
            circuit.AddArc(n + d, n + (d + 1) % dCount, empty);
            // A one-day circuit needs a depot self-loop only when no activities are selected.
            if (dCount == 1)
            {
                model.Add(LinearExpr.Sum(selected) == 0).OnlyEnforceIf(empty);
            }
        }
        for (int i = 0; i < n; i++)
        {
            circuit.AddArc(i, i, selected[i].Not());
            var rule = plan.Rules.FirstOrDefault(r => r.ActivityId == activities[i].Id);
            if (scheduleSelected)
            {
                model.Add(
                    selected[i] == (plan.SelectedActivityIds.Contains(activities[i].Id) ? 1 : 0)
                );
            }
            if (plan.ExcludedActivityIds.Contains(activities[i].Id))
            {
                model.Add(selected[i] == 0);
            }

            if (rule?.MustDo == true || rule?.FixedDate is not null || rule?.FixedStart is not null)
            {
                model.Add(selected[i] == 1);
            }

            var assignments = new List<LinearExpr>();
            var indexes = new List<LinearExpr>();
            for (int d = 0; d < dCount; d++)
            {
                var day = days[d];
                var settings = day.Settings ?? plan.Settings;
                var x = assigned[i, d] = model.NewBoolVar($"at_{i}_{d}");
                assignments.Add(x);
                indexes.Add(x * d);
                var visit = planningContext.Visits.First(v => v.StayId == day.StayId);
                if (
                    visit.ArrivalDate is null
                    || visit.DepartureDate is null
                    || day.Date < visit.ArrivalDate
                    || day.Date > visit.DepartureDate
                    || rule?.FixedDate is { } fixedDate && fixedDate != day.Date
                    || rule?.ClosedDates.Contains(day.Date) == true
                )
                {
                    model.Add(x == 0);
                }

                model.Add(starts[i] >= d * 2880).OnlyEnforceIf(x);
                model.Add(starts[i] + durations[i] <= d * 2880 + capacity[d]).OnlyEnforceIf(x);
                if (rule?.FixedStart is { } time)
                {
                    var fixedInstant = ActivityPlanRules.Instant(
                        day.Date,
                        ActivityPlanRules.DayOffset(time, settings),
                        zone
                    );
                    if (fixedInstant is null)
                    {
                        model.Add(x == 0);
                    }
                    else
                    {
                        model
                            .Add(
                                starts[i]
                                    == d * 2880
                                        + (int)(fixedInstant.Value - origins[d]).TotalMinutes
                            )
                            .OnlyEnforceIf(x);
                    }
                }
                if (rule is { OpeningWindows.Length: > 0 })
                {
                    var windows = new List<ILiteral>();
                    foreach (
                        var window in rule.OpeningWindows.Where(w =>
                            w.Date == day.Date
                            || settings.SleepStart.ToTimeSpan() <= settings.SleepEnd.ToTimeSpan()
                                && w.Date == day.Date.AddDays(1)
                        )
                    )
                    {
                        TimeSpan open = window.Start.ToTimeSpan(),
                            close = window.End.ToTimeSpan();
                        if (close <= open)
                        {
                            close += TimeSpan.FromDays(1);
                        }

                        var s = ActivityPlanRules.Instant(window.Date, open, zone);
                        var e = ActivityPlanRules.Instant(window.Date, close, zone);
                        if (s is null || e is null)
                        {
                            continue;
                        }

                        var w = model.NewBoolVar($"window_{i}_{d}_{windows.Count}");
                        windows.Add(w);
                        model
                            .Add(starts[i] >= d * 2880 + (int)(s.Value - origins[d]).TotalMinutes)
                            .OnlyEnforceIf(w);
                        model
                            .Add(
                                starts[i] + durations[i]
                                    <= d * 2880 + (int)(e.Value - origins[d]).TotalMinutes
                            )
                            .OnlyEnforceIf(w);
                    }
                    model.AddBoolOr(windows).OnlyEnforceIf(x);
                }
                int outbound = SolverMinutes(
                    planningContext
                        .Travel(plan, day, null, activities[i].Id, origins[d], clock.GetUtcNow())
                        .Duration
                );
                int inbound = SolverMinutes(
                    planningContext
                        .Travel(plan, day, activities[i].Id, null, origins[d], clock.GetUtcNow())
                        .Duration
                );
                var first = firstInDay[i, d] = model.NewBoolVar($"first_{i}_{d}");
                var last = lastInDay[i, d] = model.NewBoolVar($"last_{i}_{d}");
                circuit.AddArc(n + d, i, first);
                circuit.AddArc(i, n + (d + 1) % dCount, last);
                model.AddImplication(first, x);
                model.AddImplication(last, x);
                model.Add(starts[i] >= d * 2880 + outbound).OnlyEnforceIf(first);
                model
                    .Add(starts[i] + durations[i] + inbound <= d * 2880 + capacity[d])
                    .OnlyEnforceIf(last);
                dailyTravel[d].Add(first * outbound);
                outgoingTravel[i].Add(last * inbound);
                travelTerms.Add(first * outbound + last * inbound);
                changeTerms.Add(x * (day.ActivityIds.Contains(activities[i].Id) ? -1 : 1));
                model.AddHint(
                    x,
                    hint.Days.Any(h =>
                        h.StayId == day.StayId
                        && h.Date == day.Date
                        && h.ActivityIds.Contains(activities[i].Id)
                    )
                        ? 1
                        : 0
                );
            }
            model.Add(LinearExpr.Sum(assignments) == selected[i]);
            model.Add(dayOf[i] == LinearExpr.Sum(indexes));
            changeTerms.Add(
                selected[i] * (plan.SelectedActivityIds.Contains(activities[i].Id) ? -1 : 1)
            );
            model.AddHint(selected[i], hint.SelectedActivityIds.Contains(activities[i].Id) ? 1 : 0);
        }
        for (int i = 0; i < n; i++)
        {
            ct.ThrowIfCancellationRequested();
            var rule = plan.Rules.FirstOrDefault(r => r.ActivityId == activities[i].Id);
            if (
                rule?.AfterActivityId is { } after
                && Array.FindIndex(activities, a => a.Id == after) is var predecessor
                && predecessor >= 0
            )
            {
                model.AddImplication(selected[i], selected[predecessor]);
                model
                    .Add(starts[i] >= starts[predecessor] + durations[predecessor])
                    .OnlyEnforceIf(selected[i]);
            }
            for (int j = 0; j < n; j++)
            {
                if (i == j)
                {
                    continue;
                }

                var arc = model.NewBoolVar($"arc_{i}_{j}");
                circuit.AddArc(i, j, arc);
                model.Add(dayOf[i] == dayOf[j]).OnlyEnforceIf(arc);
                // Departure-dependent estimates are rechecked on shortlisted schedules.
                var minutes = days.Select(
                        (day, d) =>
                            (long)SolverMinutes(
                                planningContext
                                    .Travel(
                                        plan,
                                        day,
                                        activities[i].Id,
                                        activities[j].Id,
                                        origins[d],
                                        clock.GetUtcNow()
                                    )
                                    .Duration
                            )
                    )
                    .ToArray();
                LinearExpr legMinutes;
                if (minutes.Distinct().Count() == 1)
                {
                    model
                        .Add(starts[j] >= starts[i] + durations[i] + minutes[0])
                        .OnlyEnforceIf(arc);
                    legMinutes = arc * minutes[0];
                }
                else
                {
                    var timeForDay = model.NewIntVar(
                        minutes.Min(),
                        minutes.Max(),
                        $"leg_time_{i}_{j}"
                    );
                    model.AddElement(dayOf[i], minutes, timeForDay);
                    model
                        .Add(starts[j] >= starts[i] + durations[i] + timeForDay)
                        .OnlyEnforceIf(arc);
                    var used = model.NewIntVar(0, minutes.Max(), $"leg_used_{i}_{j}");
                    model.Add(used == timeForDay).OnlyEnforceIf(arc);
                    model.Add(used == 0).OnlyEnforceIf(arc.Not());
                    legMinutes = used;
                }
                travelTerms.Add(legMinutes);
                outgoingTravel[i].Add(legMinutes);
                bool consecutive = plan.Days.Any(day =>
                    Array.IndexOf(day.ActivityIds, activities[i].Id) is var at
                    && at >= 0
                    && at + 1 < day.ActivityIds.Length
                    && day.ActivityIds[at + 1] == activities[j].Id
                );
                if (consecutive)
                {
                    changeTerms.Add(-arc);
                }
            }
        }
        for (int i = 0; i < n; i++)
        {
            for (int d = 0; d < dCount; d++)
            {
                var minutes = model.NewIntVar(0, 30000, $"travel_{i}_{d}");
                model
                    .Add(minutes == LinearExpr.Sum(outgoingTravel[i]))
                    .OnlyEnforceIf(assigned[i, d]);
                model.Add(minutes == 0).OnlyEnforceIf(assigned[i, d].Not());
                dailyTravel[d].Add(minutes);
            }
        }

        for (int d = 0; d < dCount; d++)
        {
            var settings = days[d].Settings ?? plan.Settings;
            var meals = new List<IntVar>();
            foreach (
                var (name, allowance) in new[]
                {
                    ("breakfast", SolverMinutes(settings.BreakfastDuration)),
                    ("lunch", SolverMinutes(settings.LunchDuration)),
                    ("dinner", SolverMinutes(settings.DinnerDuration)),
                }
            )
            {
                var remaining = model.NewIntVar(0, allowance, $"meal_{name}_{d}");
                var credits = Enumerable
                    .Range(0, n)
                    .Where(i =>
                        plan.Rules.Any(r =>
                            r.ActivityId == activities[i].Id && r.CoversMeal == name
                        )
                    )
                    .Select(i => assigned[i, d] * Math.Min(allowance, durations[i]))
                    .ToArray();
                model.AddMaxEquality(
                    remaining,
                    new LinearExpr[] { LinearExpr.Constant(0), allowance - LinearExpr.Sum(credits) }
                );
                meals.Add(remaining);
                if (planningContext.StayLocationFor(days[d].StayId) is null && name == "breakfast")
                {
                    for (int i = 0; i < n; i++)
                    {
                        model
                            .Add(starts[i] >= d * 2880 + remaining)
                            .OnlyEnforceIf(firstInDay[i, d]);
                    }
                }
                if (planningContext.StayLocationFor(days[d].StayId) is null && name == "dinner")
                {
                    var needsDinner = model.NewBoolVar($"needs_dinner_{d}");
                    model.Add(remaining > 0).OnlyEnforceIf(needsDinner);
                    model.Add(remaining == 0).OnlyEnforceIf(needsDinner.Not());
                    var dinner = ActivityPlanRules.Instant(
                        days[d].Date,
                        ActivityPlanRules.DinnerTarget.ToTimeSpan(),
                        zone
                    );
                    int dinnerOffset = dinner is null
                        ? 0
                        : (int)(dinner.Value - origins[d]).TotalMinutes;
                    for (int i = 0; i < n; i++)
                    {
                        model
                            .Add(starts[i] >= d * 2880 + Math.Max(0, dinnerOffset) + remaining)
                            .OnlyEnforceIf([lastInDay[i, d], needsDinner]);
                    }
                }
            }
            model.Add(
                LinearExpr.Sum(Enumerable.Range(0, n).Select(i => assigned[i, d] * durations[i]))
                    + LinearExpr.Sum(dailyTravel[d])
                    + LinearExpr.Sum(meals)
                    <= capacity[d]
            );
        }
        long[] utilities = activities
            .Select(a =>
                (long)
                    Math.Round(
                        planningContext.Travellers.Sum(u => planningContext.Affinity(u.Id, a.Id))
                            * 100
                    )
            )
            .ToArray();
        var utility = LinearExpr.WeightedSum(selected, utilities);
        var travel = LinearExpr.Sum(travelTerms);
        var changes = LinearExpr.Sum(changeTerms);
        if (objective == "travel")
        {
            model.Add(utility * 10 >= bestUtility * 9);
            model.Minimize(travel * 10000 + changes);
        }
        else if (objective == "balanced")
        {
            var minimum = model.NewIntVar(0, 10000, "least_covered");
            foreach (var traveller in planningContext.Travellers)
            {
                var values = activities
                    .Select(a => planningContext.Affinity(traveller.Id, a.Id))
                    .ToArray();
                double total = values
                    .Where((_, i) => !plan.ExcludedActivityIds.Contains(activities[i].Id))
                    .Sum();
                if (total <= 0)
                {
                    continue;
                }

                model.Add(
                    minimum
                        <= LinearExpr.WeightedSum(
                            selected,
                            values.Select(v => (long)Math.Floor(v / total * 10000)).ToArray()
                        )
                );
            }
            long coverageWeight = utilities.Sum() * 10000L + 10000L;
            model.Maximize(minimum * coverageWeight + utility * 10000L - changes);
        }
        else
        {
            model.Maximize(utility * 10000L - changes);
        }

        return new(model, activities, days, selected, assigned, starts);
    }

    private static ActivityPlan Read(
        SolverModel model,
        ActivityPlan original,
        Func<IntVar, long> value
    ) =>
        original with
        {
            SelectedActivityIds = model
                .Activities.Where((_, i) => value(model.Selected[i]) != 0)
                .Select(a => a.Id)
                .Order()
                .ToArray(),
            Days = model
                .Days.Select(
                    (d, index) =>
                        d with
                        {
                            MealPositions = null,
                            ActivityIds = model
                                .Activities.Select((a, i) => (Activity: a, Index: i))
                                .Where(a => value(model.Assigned[a.Index, index]) != 0)
                                .OrderBy(a => value(model.Starts[a.Index]))
                                .Select(a => a.Activity.Id)
                                .ToArray(),
                        }
                )
                .ToArray(),
        };

    private sealed class SolutionCallback(Action<Func<IntVar, long>> found)
        : CpSolverSolutionCallback
    {
        public override void OnSolutionCallback() => found(Value);
    }

    private static long Utility(ActivityPlanningContext planningContext, ActivityPlan plan) =>
        plan.SelectedActivityIds.Sum(id =>
            (long)
                Math.Round(
                    planningContext.Travellers.Sum(u => planningContext.Affinity(u.Id, id)) * 100
                )
        );

    private static double Balanced(ActivityPlanAssessment a) =>
        a
            .TravellerFit.Select(f => f.AvailablePoints == 0 ? 1 : f.Points / f.AvailablePoints)
            .DefaultIfEmpty(0)
            .Min();

    private static bool Better(
        ActivityPlanAlternative a,
        ActivityPlanAlternative b,
        string objective,
        ActivityPlan original
    )
    {
        double primaryA =
            objective == "travel" ? -a.Assessment.TravelDuration.TotalMinutes
            : objective == "balanced" ? Balanced(a.Assessment)
            : a.Assessment.GroupUtility;
        double primaryB =
            objective == "travel" ? -b.Assessment.TravelDuration.TotalMinutes
            : objective == "balanced" ? Balanced(b.Assessment)
            : b.Assessment.GroupUtility;
        return primaryA > primaryB
            || primaryA == primaryB
                && (
                    a.Assessment.GroupUtility > b.Assessment.GroupUtility
                    || a.Assessment.GroupUtility == b.Assessment.GroupUtility
                        && Changes(original, a.Plan) < Changes(original, b.Plan)
                );
    }

    private static int Changes(ActivityPlan from, ActivityPlan to) =>
        from.SelectedActivityIds.Except(to.SelectedActivityIds).Count()
        + to.SelectedActivityIds.Except(from.SelectedActivityIds).Count()
        + to.Days.Sum(d =>
            d.ActivityIds.Where(
                    (id, i) =>
                        from.Days.FirstOrDefault(x => x.Date == d.Date)
                            ?.ActivityIds.ElementAtOrDefault(i) != id
                )
                .Count()
        );

    private ActivityPlanSuggestion[] Suggestions(
        ActivityPlanningContext planningContext,
        ActivityPlan original,
        List<ActivityPlanAlternative> alternatives,
        string[] dismissed
    )
    {
        var baseline = planningContext.Evaluate(original, clock.GetUtcNow());
        var suggestions = new List<ActivityPlanSuggestion>();
        var hashes = new HashSet<string>();
        var budget = Stopwatch.StartNew();
        void Consider(ActivityPlan plan, string title)
        {
            if (budget.Elapsed > TimeSpan.FromSeconds(2))
            {
                return;
            }

            string fingerprint = ActivityPlanRules.Hash(plan);
            if (!hashes.Add(fingerprint) || dismissed.Contains(fingerprint))
            {
                return;
            }

            var assessment = planningContext.Evaluate(plan, clock.GetUtcNow());
            if (
                assessment.ConflictCount > baseline.ConflictCount
                || assessment.OverrunDuration > baseline.OverrunDuration
            )
            {
                return;
            }

            if (
                assessment.ConflictCount == baseline.ConflictCount
                && assessment.OverrunDuration == baseline.OverrunDuration
                && assessment.GroupUtility <= baseline.GroupUtility
                && assessment.TravelDuration >= baseline.TravelDuration
            )
            {
                return;
            }

            if (
                assessment.Issues.Any(i =>
                    i.Code
                        is "fixed_day"
                            or "late_for_anchor"
                            or "relative_order"
                            or "must_do_missing"
                    && i.Severity == "conflict"
                )
            )
            {
                return;
            }

            suggestions.Add(
                new(
                    fingerprint[..16],
                    title,
                    $"Conflicts: {baseline.ConflictCount} → {assessment.ConflictCount}; overrun: {baseline.OverrunDuration.TotalMinutes} → {assessment.OverrunDuration.TotalMinutes} min; travel: {baseline.TravelDuration.TotalMinutes} → {assessment.TravelDuration.TotalMinutes} min; group fit: {baseline.GroupUtility:0.##} → {assessment.GroupUtility:0.##}.",
                    plan,
                    assessment,
                    fingerprint
                )
            );
        }
        foreach (var alternative in alternatives)
        {
            foreach (var day in alternative.Plan.Days)
            {
                foreach (var (id, index) in day.ActivityIds.Select((id, i) => (id, i)))
                {
                    var days = original
                        .Days.Select(d =>
                            d with
                            {
                                MealPositions = null,
                                ActivityIds = d.ActivityIds.Where(a => a != id).ToArray(),
                            }
                        )
                        .Select(d =>
                            d.Date == day.Date && d.StayId == day.StayId
                                ? d with
                                {
                                    MealPositions = null,
                                    ActivityIds = d
                                        .ActivityIds.Take(index)
                                        .Append(id)
                                        .Concat(d.ActivityIds.Skip(index))
                                        .ToArray(),
                                }
                                : d
                        )
                        .ToArray();
                    Consider(
                        original with
                        {
                            Days = days,
                            SelectedActivityIds = original
                                .SelectedActivityIds.Append(id)
                                .Distinct()
                                .Order()
                                .ToArray(),
                        },
                        $"Schedule {planningContext.Activities.First(a => a.Id == id).Properties.Name} on {day.Date:MMM d}"
                    );
                }
            }
        }

        foreach (
            var id in original.SelectedActivityIds.Where(id =>
                !original.Rules.Any(r =>
                    r.ActivityId == id
                    && (r.MustDo || r.FixedDate is not null || r.FixedStart is not null)
                )
            )
        )
        {
            Consider(
                original with
                {
                    SelectedActivityIds = original
                        .SelectedActivityIds.Where(a => a != id)
                        .ToArray(),
                    Days = original
                        .Days.Select(d =>
                            d with
                            {
                                MealPositions = null,
                                ActivityIds = d.ActivityIds.Where(a => a != id).ToArray(),
                            }
                        )
                        .ToArray(),
                },
                $"Return {planningContext.Activities.First(a => a.Id == id).Properties.Name} to Ideas"
            );
        }

        foreach (var day in baseline.Days)
        {
            foreach (var leg in day.Travel)
            {
                if (
                    leg.Mode == "driving"
                    || original.TransportOverrides.Any(t =>
                        t.Date == day.Date
                        && t.FromActivityId == leg.FromActivityId
                        && t.ToActivityId == leg.ToActivityId
                    )
                )
                {
                    continue;
                }

                foreach (var mode in new[] { "walking", "taxi" }.Where(m => m != leg.Mode))
                {
                    Consider(
                        original with
                        {
                            TransportOverrides =
                            [
                                .. original.TransportOverrides,
                                new(day.Date, leg.FromActivityId, leg.ToActivityId, mode),
                            ],
                        },
                        $"Use {mode} {(leg.ToActivityId is { } id ? "to " + planningContext.Activities.First(a => a.Id == id).Properties.Name : "back to accommodation")}"
                    );
                }
            }
        }

        return suggestions
            .OrderBy(s => s.Assessment.ConflictCount)
            .ThenBy(s => s.Assessment.OverrunDuration)
            .ThenByDescending(s => s.Assessment.GroupUtility)
            .ThenBy(s => s.Assessment.TravelDuration)
            .Take(12)
            .ToArray();
    }

    private static bool ContradictoryRestrictions(ActivityPlan plan)
    {
        var rules = plan.Rules.ToDictionary(r => r.ActivityId);
        var required = plan
            .Rules.Where(r => r.MustDo || r.FixedDate is not null || r.FixedStart is not null)
            .Select(r => r.ActivityId)
            .ToArray();
        foreach (var id in required)
        {
            var seen = new HashSet<Guid>();
            Guid? current = id;
            while (current is { } value)
            {
                if (!seen.Add(value) || plan.ExcludedActivityIds.Contains(value))
                {
                    return true;
                }

                current = rules.GetValueOrDefault(value)?.AfterActivityId;
            }
        }
        return false;
    }

    private static ActivityRuleChange[] RuleChanges(
        ActivityPlan plan,
        ActivityPlanAssessment assessment
    ) =>
        plan
            .Rules.Where(r =>
                assessment.Issues.Any(i =>
                    i.ActivityId == r.ActivityId
                    && i.Severity == "conflict"
                    && i.Code
                        is "must_do_missing"
                            or "fixed_day"
                            or "late_for_anchor"
                            or "relative_order"
                            or "anchor_outside_hours"
                )
            )
            .Select(r => new ActivityRuleChange(
                r.ActivityId,
                "Optional restriction change: remove the must-do, fixed-day/time and relative-order restrictions for this activity. Other activity settings stay intact. Review before accepting into your draft.",
                r with
                {
                    MustDo = false,
                    FixedDate = null,
                    FixedStart = null,
                    AfterActivityId = null,
                }
            ))
            .ToArray();
}
