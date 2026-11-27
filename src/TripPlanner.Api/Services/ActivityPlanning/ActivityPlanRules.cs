using System.Security.Cryptography;
using System.Text.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services.ActivityPlanning;

public static class ActivityPlanRules
{
    public static readonly string[] TransportModes = ["walking", "taxi", "driving"];
    public static readonly TimeOnly DinnerTarget = new(19, 0);

    public static string Hash<T>(T value) =>
        Convert
            .ToHexString(
                SHA256.HashData(
                    JsonSerializer.SerializeToUtf8Bytes(value, JsonSerializerOptions.Web)
                )
            )
            .ToLowerInvariant();

    public static string ETag(long version) => $"\"{version}\"";

    public static ActivityPlan NormalizeDayNames(ActivityPlan plan) =>
        plan with
        {
            Days = plan
                .Days.Select(day =>
                    day with
                    {
                        Name = string.IsNullOrWhiteSpace(day.Name) ? null : day.Name.Trim(),
                    }
                )
                .ToArray(),
        };

    private static ActivityPlan WithoutDayDetails(ActivityPlan plan) =>
        plan with
        {
            Days = plan.Days.Select(day => day with { Name = null, Review = null }).ToArray(),
        };

    public static bool OnlyDayDetailsChanged(ActivityPlan before, ActivityPlan after) =>
        Hash(before) != Hash(after)
        && Hash(WithoutDayDetails(before)) == Hash(WithoutDayDetails(after));

    // A planning day starts at wake-up. A 01:00 booking belongs to the following
    // calendar date when that day's awake window extends past midnight.
    public static TimeSpan DayOffset(TimeOnly time, DailyPlanningSettings settings)
    {
        TimeSpan offset = time.ToTimeSpan(),
            wake = settings.SleepEnd.ToTimeSpan(),
            sleep = settings.SleepStart.ToTimeSpan();
        return sleep <= wake && offset < wake ? offset + TimeSpan.FromDays(1) : offset;
    }

    public static string? EffectiveTimeZone(ActivityPlan plan, ActivityPlanningContext context) =>
        !string.IsNullOrWhiteSpace(plan.TimeZone) ? plan.TimeZone
        : !string.IsNullOrWhiteSpace(context.Place.TimeZone) ? context.Place.TimeZone
        : context.Evidence.TimeZone;

    public static TimeZoneInfo? Zone(string? id)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return null;
        }

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(id);
        }
        catch (TimeZoneNotFoundException)
        {
            return null;
        }
        catch (InvalidTimeZoneException)
        {
            return null;
        }
    }

    public static DateTimeOffset? Instant(DateOnly date, TimeSpan localOffset, TimeZoneInfo zone)
    {
        var local = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified).Add(localOffset);
        if (zone.IsInvalidTime(local) || zone.IsAmbiguousTime(local))
        {
            return null;
        }

        return new(local, zone.GetUtcOffset(local));
    }

    public static ActivityState SelectionState(Activity activity, ActivityPlan plan) =>
        plan.SelectedActivityIds.Contains(activity.Id) ? ActivityState.Yes
        : plan.ExcludedActivityIds.Contains(activity.Id) ? ActivityState.No
        : activity.Properties.State is ActivityState.Yes or ActivityState.No ? ActivityState.Maybe
        : activity.Properties.State;

    public static ActivityPlan InvalidateVisitSchedule(ActivityPlan plan, DestinationVisit visit)
    {
        var removedDays = plan.Days.Where(day => day.StayId == visit.StayId).ToArray();
        var removedIds = removedDays.SelectMany(day => day.ActivityIds).ToHashSet();
        var removedDates = removedDays.Select(day => day.Date).ToHashSet();
        var retainedDays = plan.Days.Where(day => day.StayId != visit.StayId).ToArray();
        var retainedIds = retainedDays.SelectMany(day => day.ActivityIds).ToHashSet();
        var retainedDates = retainedDays.Select(day => day.Date).ToHashSet();
        bool AffectedDate(DateOnly date) =>
            removedDates.Contains(date)
            || (
                visit.ArrivalDate is { } start
                && visit.DepartureDate is { } end
                && date >= start
                && date <= end
            );
        return plan with
        {
            Days = retainedDays,
            Rules = plan
                .Rules.Select(rule =>
                    !retainedIds.Contains(rule.ActivityId)
                    && (
                        removedIds.Contains(rule.ActivityId)
                        || (rule.FixedDate is { } date && AffectedDate(date))
                    )
                        ? rule with
                        {
                            FixedDate = null,
                            FixedStart = null,
                        }
                        : rule
                )
                .ToArray(),
            TransportOverrides = plan
                .TransportOverrides.Where(item =>
                    !AffectedDate(item.Date)
                    || (
                        retainedDates.Contains(item.Date)
                        && (item.FromActivityId is not { } from || !removedIds.Contains(from))
                        && (item.ToActivityId is not { } to || !removedIds.Contains(to))
                    )
                )
                .ToArray(),
        };
    }

    public static ActivityPlan Reconcile(
        ActivityPlan plan,
        Activity[] activities,
        DestinationVisit[] visits
    )
    {
        var available = activities.Select(a => a.Id).ToHashSet();
        var selected = activities
            .Where(a => a.Properties.State == ActivityState.Yes)
            .Select(a => a.Id)
            .Order()
            .ToArray();
        var excluded = activities
            .Where(a => a.Properties.State == ActivityState.No)
            .Select(a => a.Id)
            .Order()
            .ToArray();
        return plan with
        {
            SelectedActivityIds = selected,
            ExcludedActivityIds = excluded,
            Days = plan
                .Days.Where(d => visits.Any(v => v.StayId == d.StayId))
                .Select(d =>
                    d with
                    {
                        ActivityIds = d.ActivityIds.Where(selected.Contains).ToArray(),
                        MealPositions = d.MealPositions is { } meals
                            ? new(
                                d.ActivityIds.Take(meals.Breakfast).Count(selected.Contains),
                                d.ActivityIds.Take(meals.Lunch).Count(selected.Contains),
                                d.ActivityIds.Take(meals.Dinner).Count(selected.Contains)
                            )
                            : null,
                    }
                )
                .ToArray(),
            Rules = plan
                .Rules.Where(r =>
                    available.Contains(r.ActivityId) && !excluded.Contains(r.ActivityId)
                )
                .Select(r =>
                    r.AfterActivityId is { } after && !available.Contains(after)
                        ? r with
                        {
                            AfterActivityId = null,
                        }
                        : r
                )
                .ToArray(),
            TransportOverrides = plan
                .TransportOverrides.Where(t =>
                    (t.FromActivityId is null || available.Contains(t.FromActivityId.Value))
                    && (t.ToActivityId is null || available.Contains(t.ToActivityId.Value))
                )
                .ToArray(),
        };
    }

    public static ActivityPlan Initial(ActivityPlanningContext planningContext)
    {
        var days = new List<ActivityPlanDay>();
        foreach (var visit in planningContext.Visits.OrderBy(v => v.Order))
        {
            if (visit.ArrivalDate is not { } start || visit.DepartureDate is not { } end)
            {
                continue;
            }

            for (var day = start; day <= end && days.Count < 366; day = day.AddDays(1))
            {
                days.Add(new(visit.StayId, day, []));
            }
        }
        return Reconcile(
            new()
            {
                Days = [.. days],
                Settings =
                    planningContext.DestinationPreferences.Defaults
                    ?? planningContext.TripPreferences.Defaults
                    ?? new(),
                TimeZone = string.IsNullOrWhiteSpace(planningContext.Place.TimeZone)
                    ? planningContext.Evidence.TimeZone
                    : planningContext.Place.TimeZone,
            },
            planningContext.Activities,
            planningContext.Visits
        );
    }

    public static Dictionary<string, string[]> Validate(
        ActivityPlan? plan,
        ActivityPlanningContext planningContext
    )
    {
        var errors = new Dictionary<string, string[]>();
        if (
            plan is null
            || plan.Days is null
            || plan.Rules is null
            || plan.SelectedActivityIds is null
            || plan.ExcludedActivityIds is null
            || plan.TransportOverrides is null
            || plan.Settings is null
        )
        {
            errors["plan"] = ["Provide the complete plan and its arrays."];
            return errors;
        }
        if (
            plan.Days.Length > 366
            || plan.SelectedActivityIds.Length > 1000
            || plan.ExcludedActivityIds.Length > 1000
            || plan.Rules.Length > 1000
            || plan.TransportOverrides.Length > 2000
        )
        {
            errors["plan"] = ["Plan exceeds 366 days or 1,000 activities."];
        }

        var ids = planningContext.Activities.Select(a => a.Id).ToHashSet();
        if (
            plan.SelectedActivityIds.Concat(plan.ExcludedActivityIds).Any(id => !ids.Contains(id))
            || plan.SelectedActivityIds.Intersect(plan.ExcludedActivityIds).Any()
            || plan.SelectedActivityIds.Distinct().Count() != plan.SelectedActivityIds.Length
            || plan.ExcludedActivityIds.Distinct().Count() != plan.ExcludedActivityIds.Length
        )
        {
            errors["selection"] =
            [
                "Select existing destination activities once, either included or excluded.",
            ];
        }

        if (
            plan.Days.Any(d =>
                d is null
                || d.ActivityIds is null
                || !planningContext.Visits.Any(v => v.StayId == d.StayId)
            )
        )
        {
            errors["days"] =
            [
                "Each day must reference an existing visit and contain activity IDs.",
            ];
        }
        else
        {
            if (plan.Days.Any(day => day.Name is { Length: > 200 }))
            {
                errors["days.name"] = ["Day names cannot exceed 200 characters."];
            }

            if (
                plan.Days.Select(d => (d.StayId, d.Date)).Distinct().Count() != plan.Days.Length
                || plan.Days.Where(d => d.ActivityIds.Length > 0)
                    .GroupBy(d => d.Date)
                    .Any(g => g.Count() > 1)
            )
            {
                errors["days"] =
                [
                    "Use one review per visit and one activity schedule per local date.",
                ];
            }

            if (
                plan.Days.Any(d =>
                    d.MealPositions is { } meals
                    && (
                        meals.Breakfast < 0
                        || meals.Lunch < meals.Breakfast
                        || meals.Dinner < meals.Lunch
                        || meals.Dinner > d.ActivityIds.Length
                    )
                )
            )
            {
                errors["mealPositions"] =
                [
                    "Meal positions must follow breakfast, lunch, dinner order and fall within the day's activities.",
                ];
            }

            var scheduled = plan.Days.SelectMany(d => d.ActivityIds).ToArray();
            if (
                scheduled.Any(id => !plan.SelectedActivityIds.Contains(id))
                || scheduled.Distinct().Count() != scheduled.Length
            )
            {
                errors["days"] = ["Schedule only selected activities, at most once across visits."];
            }

            if (
                plan.Days.Any(d =>
                    !new ClockTimeAttribute().IsValid(d.AvailableFrom)
                    || !new ClockTimeAttribute().IsValid(d.AvailableUntil)
                )
            )
            {
                errors["availability"] = ["Use whole-minute precision for availability."];
            }

            if (
                plan.Days.Any(d =>
                    d.FlightMatches is null
                    || d.FlightMatches.Any(m =>
                        !planningContext.Travellers.Any(u => u.Id == m.TravellerId)
                        || m.Direction is not ("arrival" or "departure")
                        || string.IsNullOrWhiteSpace(m.CandidateId)
                    )
                    || d.FlightMatches.GroupBy(m => (m.TravellerId, m.Direction))
                        .Any(g => g.Count() > 1)
                )
            )
            {
                errors["flightMatches"] =
                [
                    "Choose at most one flight per traveller and direction from this trip's returned candidates.",
                ];
            }

            foreach (
                var settings in plan
                    .Days.Select(d => d.Settings)
                    .Prepend(plan.Settings)
                    .OfType<DailyPlanningSettings>()
            )
            {
                foreach (var error in ValidateSettings(settings))
                {
                    errors[error.Key] = error.Value;
                }
            }
            if (errors.Count == 0 && planningContext.FlightLegs.Length > 0)
            {
                var candidates = ActivityFlightAvailability.SuggestKnown(planningContext, plan);
                if (
                    plan.Days.Any(day =>
                        day.FlightMatches.Any(match =>
                            !candidates.Any(s =>
                                s.StayId == day.StayId
                                && s.Date == day.Date
                                && s.Candidates.Any(c =>
                                    c.Id == match.CandidateId
                                    && c.TravellerId == match.TravellerId
                                    && c.Direction == match.Direction
                                )
                            )
                        )
                    )
                )
                {
                    errors["flightMatches"] =
                    [
                        "Use a matching flight candidate supplied for this traveller and visit date.",
                    ];
                }
            }
        }
        if (plan.TimeZone is { Length: > 0 } && Zone(plan.TimeZone) is null)
        {
            errors["timeZone"] =
            [
                "Use a recognized IANA time zone, or omit it to use the city's zone.",
            ];
        }

        if (
            plan.Rules.Any(r =>
                r is null
                || !ids.Contains(r.ActivityId)
                || r.AfterActivityId is { } after && !ids.Contains(after)
                || !new ClockTimeAttribute().IsValid(r.FixedStart)
                || !new TripPlanner.Api.DTO.DurationRangeAttribute(1, 10080).IsValid(r.Duration)
                || r.CoversMeal is not (null or "breakfast" or "lunch" or "dinner")
                || r.ClosedDates is null
                || r.OpeningWindows is null
                || r.OpeningWindows.Any(w =>
                    w is null
                    || !new ClockTimeAttribute().IsValid(w.Start)
                    || !new ClockTimeAttribute().IsValid(w.End)
                )
            )
            || plan.Rules.Select(r => r.ActivityId).Distinct().Count() != plan.Rules.Length
        )
        {
            errors["rules"] =
            [
                "Rules must uniquely reference destination activities and use valid times, meals, and positive durations.",
            ];
        }

        if (
            plan.TransportOverrides.Any(t =>
                t is null
                || !TransportModes.Contains(t.Mode)
                || !new TripPlanner.Api.DTO.DurationRangeAttribute(0, 1440).IsValid(t.Duration)
                || t.FromActivityId is { } from && !ids.Contains(from)
                || t.ToActivityId is { } to && !ids.Contains(to)
            )
        )
        {
            errors["transportOverrides"] =
            [
                "Use supported transport modes, existing activity IDs, and durations of 0–1440 minutes.",
            ];
        }
        else if (
            plan
                .TransportOverrides.GroupBy(t => (t.Date, t.FromActivityId, t.ToActivityId))
                .Any(g => g.Count() > 1)
        )
        {
            errors["transportOverrides"] = ["Provide one override per leg."];
        }

        return errors;
    }

    public static Dictionary<string, string[]> ValidateSettings(DailyPlanningSettings settings)
    {
        var errors = new Dictionary<string, string[]>();
        if (
            !new ClockTimeAttribute().IsValid(settings.SleepStart)
            || !new ClockTimeAttribute().IsValid(settings.SleepEnd)
            || settings.SleepStart == settings.SleepEnd
        )
        {
            errors["sleep"] =
            [
                "Choose different sleep and wake times with whole-minute precision.",
            ];
        }

        if (
            new[]
            {
                settings.BreakfastDuration,
                settings.LunchDuration,
                settings.DinnerDuration,
                settings.SlackDuration,
                settings.AirportArrivalBufferDuration,
                settings.AirportDepartureBufferDuration,
                settings.AirportTransferDuration,
            }.Any(duration =>
                !new TripPlanner.Api.DTO.DurationRangeAttribute(0, 1440).IsValid(duration)
            )
        )
        {
            errors["allowances"] = ["Time allowances must be 0–1440 minutes."];
        }

        if (settings.TransportMode != "fastest" && !TransportModes.Contains(settings.TransportMode))
        {
            errors["transportMode"] = ["Choose fastest walking/driving, taxi, or driving."];
        }

        return errors;
    }
}
