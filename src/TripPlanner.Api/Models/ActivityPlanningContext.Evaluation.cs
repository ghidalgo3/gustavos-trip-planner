using System.Globalization;
using Microsoft.Spatial;
using TripPlanner.Api.Services.ActivityPlanning;

namespace TripPlanner.Api.Models;

public sealed partial record ActivityPlanningContext
{
    private static TimeSpan Max(TimeSpan a, TimeSpan b) => a >= b ? a : b;

    private static TimeSpan Sum(IEnumerable<TimeSpan> durations) =>
        durations.Aggregate(TimeSpan.Zero, (sum, duration) => sum + duration);

    public string AffinityContext() =>
        ActivityPlanRules.Hash(
            new
            {
                Activities = Activities
                    .OrderBy(a => a.Id)
                    .Select(a => new
                    {
                        a.Id,
                        a.Properties.Name,
                        a.Properties.Description,
                    }),
                Profiles = ProfilePreferences.OrderBy(p => p.Key),
                TripPreferences,
                DestinationPreferences,
            }
        );

    public static string ActivityContext(Activity activity) =>
        ActivityPlanRules.Hash(
            new
            {
                activity.Properties.Name,
                activity.Properties.PlaceName,
                activity.Geometry,
            }
        );

    public double Affinity(Guid userId, Guid activityId) =>
        Evidence.AffinityContext == AffinityContext()
            ? Evidence
                .Affinities.FirstOrDefault(a => a.UserId == userId && a.ActivityId == activityId)
                ?.Score
                ?? 2
            : 2;

    public static string RouteKey(
        GeographyPoint? from,
        GeographyPoint? to,
        DateTimeOffset departure,
        string mode
    ) =>
        ActivityPlanRules.Hash(
            new
            {
                from = from is null ? null : new[] { from.Longitude, from.Latitude },
                to = to is null ? null : new[] { to.Longitude, to.Latitude },
                departure = departure
                    .ToUniversalTime()
                    .ToString("yyyy-MM-ddTHH:mm", CultureInfo.InvariantCulture),
                mode,
            }
        );

    public ActivityTravelLeg Travel(
        ActivityPlan plan,
        ActivityPlanDay day,
        Guid? fromId,
        Guid? toId,
        DateTimeOffset departure,
        DateTimeOffset now
    )
    {
        var stayLocation = StayLocationFor(day.StayId);
        var settings = day.Settings ?? plan.Settings;
        var change = plan.TransportOverrides.LastOrDefault(t =>
            t.Date == day.Date && t.FromActivityId == fromId && t.ToActivityId == toId
        );
        string[] modes =
            change is not null ? [change.Mode]
            : settings.TransportMode == "driving" ? ["driving"]
            : settings.TransportMode is "fastest" or "walking" ? ["walking", "driving"]
            : [settings.TransportMode];
        string mode = modes[0];
        // Without accommodation, optimize an open path through the activities.
        // Old accommodation overrides must not introduce a journey to a deleted stay.
        if (stayLocation is null && (fromId is null || toId is null))
        {
            return new(
                fromId,
                toId,
                mode,
                TimeSpan.Zero,
                false,
                "No stay: no accommodation travel"
            );
        }
        if (change?.Duration is { } duration)
        {
            return new(fromId, toId, mode, duration, false, "Your estimate");
        }

        GeographyPoint? Position(Guid? id) =>
            id is { } value
                ? Activities.FirstOrDefault(a => a.Id == value)?.Geometry?.Position
                : stayLocation?.Geometry?.Position;
        var from = Position(fromId);
        var to = Position(toId);
        // Compare supported, fresh evidence at the same departure time. A missing
        // alternative must not let a rough distance estimate beat a measured route.
        var cached = modes
            .Select(candidate =>
                Evidence.Routes.LastOrDefault(r =>
                    r.Key == RouteKey(from, to, departure, candidate)
                    && r.Mode == candidate
                    && r.ExpiresAt > now
                )
            )
            .OfType<ActivityRouteEvidence>()
            .OrderBy(r => r.Duration)
            .ThenBy(r => r.Provisional)
            .FirstOrDefault();
        if (cached is not null)
        {
            return new(
                fromId,
                toId,
                cached.Mode,
                cached.Duration,
                cached.Provisional,
                cached.Source,
                cached.WalkingDuration,
                cached.Transfers,
                cached.WaitingDuration
            );
        }

        if (from is null || to is null)
        {
            return new(
                fromId,
                toId,
                mode,
                TimeSpan.FromMinutes(20),
                true,
                "20-minute assumption; location unavailable"
            );
        }

        double kilometres = Distance(from, to);
        return modes
            .Select(candidate =>
            {
                int estimate = (int)
                    Math.Ceiling(
                        candidate == "walking"
                            ? kilometres * 1.3 / 4.5 * 60
                            : kilometres * 1.3 / 25 * 60 + (candidate == "taxi" ? 5 : 0)
                    );
                var duration = TimeSpan.FromMinutes(Math.Max(1, estimate));
                return new ActivityTravelLeg(
                    fromId,
                    toId,
                    candidate,
                    duration,
                    true,
                    "Distance-based estimate; route unverified",
                    candidate == "walking" ? duration : TimeSpan.Zero
                );
            })
            .OrderBy(leg => leg.Duration)
            .First();
    }

    public static double Distance(GeographyPoint a, GeographyPoint b)
    {
        double rad = Math.PI / 180;
        double x = Math.Sin((b.Latitude - a.Latitude) * rad / 2),
            y = Math.Sin((b.Longitude - a.Longitude) * rad / 2);
        return 6371
            * 2
            * Math.Asin(
                Math.Sqrt(
                    Math.Clamp(
                        x * x + Math.Cos(a.Latitude * rad) * Math.Cos(b.Latitude * rad) * y * y,
                        0,
                        1
                    )
                )
            );
    }

    public ActivityPlanAssessment Evaluate(ActivityPlan plan, DateTimeOffset now)
    {
        var issues = new List<ActivityPlanIssue>();
        var days = new List<ActivityDayAssessment>();
        var zone = ActivityPlanRules.Zone(ActivityPlanRules.EffectiveTimeZone(plan, this));
        bool knownZone = zone is not null;
        zone ??= TimeZoneInfo.Utc;
        if (!knownZone)
        {
            issues.Add(
                new(
                    "timezone_unknown",
                    "incomplete",
                    "The city time zone could not be resolved automatically. Retry before exporting timed calendar events."
                )
            );
        }

        var activities = Activities.ToDictionary(a => a.Id);
        var rules = plan.Rules.ToDictionary(r => r.ActivityId);
        var assigned = plan.Days.SelectMany(d => d.ActivityIds).ToHashSet();
        foreach (var id in plan.SelectedActivityIds.Where(id => !assigned.Contains(id)))
        {
            issues.Add(
                new(
                    "unscheduled",
                    "incomplete",
                    $"{activities[id].Properties.Name} is selected but has no day.",
                    ActivityId: id
                )
            );
        }

        foreach (
            var rule in plan.Rules.Where(r =>
                (r.MustDo || r.FixedDate is not null || r.FixedStart is not null)
                && (
                    !plan.SelectedActivityIds.Contains(r.ActivityId)
                    || !assigned.Contains(r.ActivityId)
                )
            )
        )
        {
            issues.Add(
                new(
                    "must_do_missing",
                    "conflict",
                    $"Required activity {activities[rule.ActivityId].Properties.Name} is not scheduled.",
                    ActivityId: rule.ActivityId
                )
            );
        }

        var flightSuggestions = ActivityFlightAvailability.SuggestKnown(this, plan);
        var orderedDays = plan.Days.OrderBy(d => d.Date).ToArray();
        foreach (var day in orderedDays)
        {
            var stayLocation = StayLocationFor(day.StayId);
            var settings = day.Settings ?? plan.Settings;
            var visit = Visits.First(v => v.StayId == day.StayId);
            if (visit.ArrivalDate is null || visit.DepartureDate is null)
            {
                issues.Add(
                    new(
                        "visit_dates_unknown",
                        "incomplete",
                        "Visit dates are needed to verify available time.",
                        day.Date
                    )
                );
            }

            if (day.Date < visit.ArrivalDate || day.Date > visit.DepartureDate)
            {
                issues.Add(
                    new(
                        "outside_visit",
                        "conflict",
                        "This day falls outside the destination visit.",
                        day.Date
                    )
                );
            }

            if (
                !day.AvailabilityConfirmed
                && (day.Date == visit.ArrivalDate || day.Date == visit.DepartureDate)
            )
            {
                issues.Add(
                    new(
                        "availability_estimated",
                        "provisional",
                        "First/last-day availability has not been confirmed against arrival and departure times.",
                        day.Date
                    )
                );
            }

            TimeSpan wake = settings.SleepEnd.ToTimeSpan(),
                sleep = settings.SleepStart.ToTimeSpan();
            if (sleep <= wake)
            {
                sleep += TimeSpan.FromDays(1);
            }

            TimeSpan from = day.AvailableFrom is null
                ? wake
                : Max(wake, ActivityPlanRules.DayOffset(day.AvailableFrom.Value, settings));
            TimeSpan until = day.AvailableUntil is null
                ? sleep
                : ActivityPlanRules.DayOffset(day.AvailableUntil.Value, settings);
            until = sleep < until ? sleep : until;
            if (until < from)
            {
                issues.Add(
                    new(
                        "availability_reversed",
                        "conflict",
                        "Available-until precedes available-from within this day's awake window.",
                        day.Date
                    )
                );
            }

            var start = ActivityPlanRules.Instant(day.Date, from, zone);
            var end = ActivityPlanRules.Instant(day.Date, until, zone);
            if (start is null || end is null)
            {
                issues.Add(
                    new(
                        "ambiguous_time",
                        "incomplete",
                        "This day's times fall in a skipped or repeated daylight-saving hour. Choose another time.",
                        day.Date
                    )
                );
            }

            DateTimeOffset cursor =
                start
                ?? new DateTimeOffset(day.Date.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero).Add(
                    from
                );
            DateTimeOffset limit = end ?? cursor.Add(Max(TimeSpan.Zero, until - from));
            var flightAvailability = ActivityFlightAvailability.ForDay(flightSuggestions, day);
            if (flightAvailability?.AvailableFromInstant is { } ready && ready > cursor)
            {
                cursor = ready;
            }
            if (flightAvailability?.AvailableUntilInstant is { } leave && leave < limit)
            {
                limit = leave;
            }
            TimeSpan available = Max(TimeSpan.Zero, limit - cursor);
            var entries = new List<ActivityScheduleEntry>();
            var travel = new List<ActivityTravelLeg>();
            var breaks = new List<ActivityPlanBreak>();
            var allowances = new Dictionary<string, TimeSpan>
            {
                ["breakfast"] = settings.BreakfastDuration,
                ["lunch"] = settings.LunchDuration,
                ["dinner"] = settings.DinnerDuration,
            };
            foreach (var meal in new[] { "breakfast", "lunch", "dinner" })
            {
                if (
                    allowances[meal] > TimeSpan.Zero
                    && !ActivityFlightAvailability.IncludesMeal(
                        day,
                        settings,
                        zone,
                        flightAvailability,
                        meal
                    )
                )
                {
                    allowances[meal] = TimeSpan.Zero;
                    breaks.Add(new(meal, null, null, TimeSpan.Zero));
                }
            }
            foreach (var id in day.ActivityIds)
            {
                if (rules.GetValueOrDefault(id) is { CoversMeal: { } meal } rule)
                {
                    allowances[meal] = Max(
                        TimeSpan.Zero,
                        allowances[meal]
                            - (
                                rule.Duration
                                ?? activities[id].Properties.Duration
                                ?? TimeSpan.FromHours(1)
                            )
                    );
                }
            }

            var pending = new Queue<(string Name, TimeSpan Duration, TimeOnly Target)>(
                new[]
                {
                    ("breakfast", allowances["breakfast"], new TimeOnly(9, 0)),
                    ("lunch", allowances["lunch"], new TimeOnly(13, 0)),
                    ("dinner", allowances["dinner"], ActivityPlanRules.DinnerTarget),
                }.Where(m => m.Item2 > TimeSpan.Zero)
            );
            TimeSpan waiting = TimeSpan.Zero;
            void AddMeal(bool respectTarget = false)
            {
                var meal = pending.Dequeue();
                if (
                    respectTarget
                    && meal.Name != "breakfast"
                    && ActivityPlanRules.Instant(day.Date, meal.Target.ToTimeSpan(), zone)
                        is { } target
                    && cursor < target
                )
                {
                    waiting += target - cursor;
                    cursor = target;
                }
                var mealStart = cursor;
                cursor = cursor.Add(meal.Duration);
                breaks.Add(
                    new(
                        meal.Name,
                        knownZone ? mealStart : null,
                        knownZone ? TimeZoneInfo.ConvertTime(cursor, zone) : null,
                        meal.Duration
                    )
                );
            }
            Guid? previous = null;
            foreach (var id in day.ActivityIds)
            {
                var activity = activities[id];
                var rule = rules.GetValueOrDefault(id);
                TimeSpan duration =
                    rule?.Duration ?? activity.Properties.Duration ?? TimeSpan.FromHours(1);
                bool provisional =
                    !knownZone || rule?.Duration is null && activity.Properties.Duration is null;
                if (rule?.Duration is null && activity.Properties.Duration is null)
                {
                    issues.Add(
                        new(
                            "duration_estimated",
                            "provisional",
                            $"{activity.Properties.Name}: using 60 minutes until a duration is supplied.",
                            day.Date,
                            id
                        )
                    );
                }

                var fixedTime = rule?.FixedStart is { } fixedStart
                    ? ActivityPlanRules.Instant(
                        day.Date,
                        ActivityPlanRules.DayOffset(fixedStart, settings),
                        zone
                    )
                    : null;
                bool lastWithoutStay = stayLocation is null && id == day.ActivityIds[^1];
                // With no stay, breakfast precedes the first stop and dinner precedes
                // the last. Keep conflicting bookings at their requested times and report them.
                while (
                    pending.TryPeek(out var meal)
                    && (
                        day.MealPositions is { } positions
                            ? positions.Before(meal.Name) <= entries.Count
                            : (stayLocation is not null || meal.Name != "dinner" || lastWithoutStay)
                                && (
                                    lastWithoutStay
                                    || entries.Count == 0 && meal.Name == "breakfast"
                                    || TimeZoneInfo
                                        .ConvertTime(cursor.Add(duration), zone)
                                        .TimeOfDay >= meal.Target.ToTimeSpan()
                                )
                                && (
                                    lastWithoutStay
                                    || stayLocation is null
                                        && entries.Count == 0
                                        && meal.Name == "breakfast"
                                    || fixedTime is null
                                    || cursor.Add(
                                        meal.Duration
                                            + Travel(
                                                plan,
                                                day,
                                                previous,
                                                id,
                                                cursor.Add(meal.Duration),
                                                now
                                            ).Duration
                                    ) <= fixedTime
                                )
                    )
                )
                {
                    AddMeal(respectTarget: day.MealPositions is not null || lastWithoutStay);
                }

                var leg = Travel(plan, day, previous, id, cursor, now) with { Departure = cursor };
                if (previous is not null || stayLocation is not null)
                {
                    travel.Add(leg);
                }
                cursor = cursor.Add(leg.Duration);
                if (leg.Provisional)
                {
                    provisional = true;
                    issues.Add(
                        new(
                            "travel_estimated",
                            "provisional",
                            $"Travel to {activity.Properties.Name}: {leg.Duration.TotalMinutes} minutes ({leg.Source}).",
                            day.Date,
                            id,
                            leg.Duration
                        )
                    );
                }
                if (rule?.FixedDate is { } fixedDate && fixedDate != day.Date)
                {
                    issues.Add(
                        new(
                            "fixed_day",
                            "conflict",
                            $"{activity.Properties.Name} must stay on {fixedDate:yyyy-MM-dd}.",
                            day.Date,
                            id
                        )
                    );
                }

                if (rule?.FixedStart is not null && fixedTime is null)
                {
                    issues.Add(
                        new(
                            "ambiguous_anchor",
                            "incomplete",
                            $"{activity.Properties.Name}'s fixed time is skipped or repeated by daylight saving.",
                            day.Date,
                            id
                        )
                    );
                }

                if (fixedTime is { } anchor)
                {
                    if (cursor > anchor)
                    {
                        issues.Add(
                            new(
                                "late_for_anchor",
                                "conflict",
                                $"Meals, travel, and earlier activities make {activity.Properties.Name} {(int)Math.Ceiling((cursor - anchor).TotalMinutes)} minutes late.",
                                day.Date,
                                id,
                                cursor - anchor
                            )
                        );
                    }
                    else
                    {
                        waiting += anchor - cursor;
                    }

                    cursor = anchor;
                }
                var hours = Evidence.Hours.LastOrDefault(h =>
                    h.ActivityId == id
                    && h.ActivityContext == ActivityContext(activity)
                    && (h.ExpiresAt ?? h.RetrievedAt.AddHours(24)) > now
                );
                var windows = rule is { OpeningWindows.Length: > 0 }
                    ? rule.OpeningWindows
                    : hours?.Windows ?? [];
                var closed =
                    rule?.ClosedDates.Contains(day.Date) == true
                    || hours?.ClosedDates.Contains(day.Date) == true;
                bool hoursProvisional =
                    rule is { OpeningWindows.Length: > 0 }
                    || rule?.ClosedDates.Contains(day.Date) == true
                        ? false
                        : hours?.Provisional ?? true;
                var availableWindows = windows
                    .Where(w =>
                        w.Date == day.Date
                        || sleep > TimeSpan.FromDays(1) && w.Date == day.Date.AddDays(1)
                    )
                    .Select(w =>
                    {
                        TimeSpan s = w.Start.ToTimeSpan(),
                            e = w.End.ToTimeSpan();
                        if (e <= s)
                        {
                            e += TimeSpan.FromDays(1);
                        }

                        return (
                            Start: ActivityPlanRules.Instant(w.Date, s, zone),
                            End: ActivityPlanRules.Instant(w.Date, e, zone)
                        );
                    })
                    .Where(w => w.Start is not null && w.End is not null)
                    .OrderBy(w => w.Start)
                    .ToArray();
                if (closed)
                {
                    issues.Add(
                        new(
                            "venue_closed",
                            hoursProvisional ? "provisional" : "conflict",
                            $"{activity.Properties.Name} is reported closed on this date.",
                            day.Date,
                            id
                        )
                    );
                }
                else if (availableWindows.Length > 0)
                {
                    var fitting = availableWindows.FirstOrDefault(w =>
                        (cursor > w.Start ? cursor : w.Start!.Value).Add(duration) <= w.End
                    );
                    if (fitting.Start is null)
                    {
                        issues.Add(
                            new(
                                "opening_window",
                                hoursProvisional ? "provisional" : "conflict",
                                $"{activity.Properties.Name}'s {duration}-minute visit does not fit its opening windows.",
                                day.Date,
                                id
                            )
                        );
                    }
                    else if (cursor < fitting.Start)
                    {
                        if (fixedTime is not null)
                        {
                            issues.Add(
                                new(
                                    "anchor_outside_hours",
                                    "conflict",
                                    $"{activity.Properties.Name}'s fixed start is before it opens.",
                                    day.Date,
                                    id
                                )
                            );
                        }
                        else
                        {
                            waiting += fitting.Start.Value - cursor;
                            cursor = fitting.Start.Value;
                        }
                    }
                }
                else if (rule?.AlwaysAvailable != true)
                {
                    issues.Add(
                        new(
                            "hours_unknown",
                            "provisional",
                            $"Opening hours for {activity.Properties.Name} have not been verified for this date.",
                            day.Date,
                            id
                        )
                    );
                }

                provisional |= hoursProvisional && rule?.AlwaysAvailable != true;
                var activityStart = cursor;
                cursor = cursor.Add(duration);
                if (
                    flightAvailability?.AvailableFromInstant is { } firstAvailable
                        && activityStart < firstAvailable
                    || flightAvailability?.AvailableUntilInstant is { } lastAvailable
                        && cursor > lastAvailable
                )
                {
                    issues.Add(
                        new(
                            "flight_unavailable",
                            "conflict",
                            $"{activity.Properties.Name} overlaps flight travel or airport/transfer time. Choose a time within the flight availability window.",
                            day.Date,
                            id
                        )
                    );
                }
                entries.Add(
                    new(
                        id,
                        day.StayId,
                        day.Date,
                        activity.Properties.Name,
                        knownZone
                        && start is not null
                        && (rule?.FixedStart is null || fixedTime is not null)
                            ? TimeZoneInfo.ConvertTime(activityStart, zone)
                            : null,
                        knownZone
                        && start is not null
                        && (rule?.FixedStart is null || fixedTime is not null)
                            ? TimeZoneInfo.ConvertTime(cursor, zone)
                            : null,
                        duration,
                        provisional,
                        activity.Properties.PlaceName,
                        activity.Geometry?.Position,
                        [.. activity.Properties.Links]
                    )
                );
                previous = id;
            }
            if (previous is not null && stayLocation is not null)
            {
                var leg = Travel(plan, day, previous, null, cursor, now) with
                {
                    Departure = cursor,
                };
                travel.Add(leg);
                cursor = cursor.Add(leg.Duration);
                if (leg.Provisional)
                {
                    issues.Add(
                        new(
                            "return_travel_estimated",
                            "provisional",
                            $"Return to accommodation: {leg.Duration.TotalMinutes} minutes ({leg.Source}).",
                            day.Date,
                            Duration: leg.Duration
                        )
                    );
                }
            }
            while (pending.Count > 0)
            {
                AddMeal(respectTarget: day.MealPositions is not null);
            }
            if (
                previous is not null
                && flightAvailability?.AvailableUntilInstant is { } departureLimit
                && cursor > departureLimit
            )
            {
                issues.Add(
                    new(
                        "flight_unavailable",
                        "conflict",
                        "Activities, return travel, or meals finish after you need to leave for the airport.",
                        day.Date
                    )
                );
            }

            if (
                entries.Count > 0
                && available == TimeSpan.Zero
                && (
                    flightAvailability?.AvailableFromInstant is not null
                    || flightAvailability?.AvailableUntilInstant is not null
                )
            )
            {
                issues.Add(
                    new(
                        "flight_unavailable",
                        "conflict",
                        "This day is unavailable because of flight travel and airport/transfer time.",
                        day.Date
                    )
                );
            }

            TimeSpan activityDuration = Sum(entries.Select(e => e.Duration)),
                travelDuration = Sum(travel.Select(t => t.Duration)),
                mealDuration = Sum(breaks.Select(b => b.Duration));
            // Gaps before meals, bookings, or opening hours remain available for
            // other activities. Actual transit waiting is already part of travel.
            TimeSpan free = available - activityDuration - travelDuration - mealDuration;
            TimeSpan overrun = Max(
                TimeSpan.Zero,
                Max(cursor - limit, settings.SlackDuration - free)
            );
            if (
                entries.Count == 0
                && available == TimeSpan.Zero
                && (
                    flightAvailability?.AvailableFromInstant is not null
                    || flightAvailability?.AvailableUntilInstant is not null
                )
            )
            {
                overrun = TimeSpan.Zero;
            }
            if (overrun > TimeSpan.Zero)
            {
                issues.Add(
                    new(
                        "day_over_capacity",
                        "conflict",
                        $"Activities ({activityDuration.TotalMinutes} min), travel ({travelDuration.TotalMinutes} min), meals ({mealDuration.TotalMinutes} min), and {settings.SlackDuration.TotalMinutes} min reserved slack exceed the available schedule by {overrun.TotalMinutes} min.",
                        day.Date,
                        Duration: overrun
                    )
                );
            }
            var precedingDay = orderedDays.LastOrDefault(d => d.Date == day.Date.AddDays(-1));
            var previousSettings =
                precedingDay?.Settings ?? (precedingDay is null ? settings : plan.Settings);
            TimeSpan previousSleep = previousSettings.SleepStart.ToTimeSpan();
            var restDate = precedingDay is null
                ? day.Date.AddDays(previousSleep < wake ? 0 : -1)
                : precedingDay.Date.AddDays(
                    previousSleep <= previousSettings.SleepEnd.ToTimeSpan() ? 1 : 0
                );
            var restStart = ActivityPlanRules.Instant(restDate, previousSleep, zone);
            var restEnd = ActivityPlanRules.Instant(day.Date, wake, zone);
            TimeSpan rest =
                restStart is not null && restEnd is not null
                    ? Max(TimeSpan.Zero, restEnd.Value - restStart.Value)
                    : TimeSpan.FromDays(1) - (sleep - wake);
            days.Add(
                new(
                    day.StayId,
                    day.Date,
                    available,
                    activityDuration,
                    travelDuration,
                    mealDuration,
                    rest,
                    waiting,
                    Max(TimeSpan.Zero, free),
                    settings.SlackDuration,
                    overrun,
                    [.. entries],
                    [.. travel]
                )
                {
                    Breaks = [.. breaks],
                    FlightAvailability = flightAvailability,
                }
            );
        }
        var allEntries = days.SelectMany(d => d.Entries).ToArray();
        foreach (var rule in plan.Rules.Where(r => r.AfterActivityId is not null))
        {
            var first = Array.FindIndex(allEntries, e => e.ActivityId == rule.AfterActivityId);
            var second = Array.FindIndex(allEntries, e => e.ActivityId == rule.ActivityId);
            if (second >= 0 && (first < 0 || first >= second))
            {
                issues.Add(
                    new(
                        "relative_order",
                        "conflict",
                        $"{activities[rule.ActivityId].Properties.Name} must follow {activities[rule.AfterActivityId!.Value].Properties.Name}.",
                        ActivityId: rule.ActivityId
                    )
                );
            }
        }
        var timed = allEntries.Where(e => e.Start is not null).OrderBy(e => e.Start).ToArray();
        for (int i = 1; i < timed.Length; i++)
        {
            if (timed[i].Start < timed[i - 1].End)
            {
                issues.Add(
                    new(
                        "overlap",
                        "conflict",
                        $"{timed[i].Name} overlaps {timed[i - 1].Name}.",
                        timed[i].Date,
                        timed[i].ActivityId
                    )
                );
            }
        }

        bool affinityCurrent = Evidence.AffinityContext == AffinityContext();
        var scores = Evidence
            .Affinities.GroupBy(a => (a.UserId, a.ActivityId))
            .ToDictionary(g => g.Key, g => g.Last().Score);
        double Score(Guid user, Guid id) =>
            affinityCurrent ? scores.GetValueOrDefault((user, id), 2) : 2;
        var fit = Travellers
            .Select(u => new TravellerActivityFit(
                u.Id,
                u.DisplayName,
                allEntries.Sum(e => Score(u.Id, e.ActivityId)),
                Activities
                    .Where(a => !plan.ExcludedActivityIds.Contains(a.Id))
                    .Sum(a => Score(u.Id, a.Id)),
                !affinityCurrent || Activities.Any(a => !scores.ContainsKey((u.Id, a.Id)))
            ))
            .ToArray();
        string status =
            issues.Any(i => i.Severity == "conflict") ? "conflicting"
            : issues.Any(i => i.Severity == "incomplete") ? "incomplete"
            : issues.Any(i => i.Severity == "provisional") ? "provisional"
            : "fits";
        return new(
            status,
            [.. issues],
            [.. days],
            fit,
            fit.Length == 0 ? 0 : fit.Average(f => f.Points),
            now
        )
        {
            Evidence = Evidence
                .Hours.Where(h =>
                    assigned.Contains(h.ActivityId)
                    && activities.TryGetValue(h.ActivityId, out var a)
                    && h.ActivityContext == ActivityContext(a)
                )
                .Select(h => new PlanningEvidenceReference(
                    "openingHours",
                    h.ActivityId,
                    h.SourceUrl,
                    h.RetrievedAt,
                    h.Windows.Select(w => w.Date).Concat(h.ClosedDates).Distinct().ToArray(),
                    h.Provisional || (h.ExpiresAt ?? h.RetrievedAt.AddHours(24)) <= now
                ))
                .ToArray(),
        };
    }
}
