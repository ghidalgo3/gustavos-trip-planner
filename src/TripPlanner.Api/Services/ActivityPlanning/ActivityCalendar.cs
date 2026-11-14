using System.Globalization;
using System.Text;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services.ActivityPlanning;

public static class ActivityCalendar
{
    public static string Render(
        Trip trip,
        IEnumerable<(
            StoredActivityPlan Saved,
            Activity[] Activities,
            DestinationVisit[] Visits
        )> plans
    )
    {
        var lines = new List<string>
        {
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//TripPlanner//Activity plan//EN",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            "X-WR-CALNAME:" + Escape(trip.Name),
        };
        foreach (var (saved, activities, visits) in plans)
        {
            foreach (var entry in saved.Assessment.Days.SelectMany(d => d.Entries))
            {
                if (
                    entry.Start is null
                    || entry.End is null
                    || !saved.Plan.Days.Any(d =>
                        d.StayId == entry.StayId
                        && d.Date == entry.Date
                        && d.ActivityIds.Contains(entry.ActivityId)
                    )
                    || !activities.Any(a =>
                        a.Id == entry.ActivityId && a.Properties.State == ActivityState.Yes
                    )
                    || !visits.Any(v => v.StayId == entry.StayId)
                )
                {
                    continue;
                }

                bool provisional = entry.Provisional || saved.Assessment.Status != "fits";
                lines.AddRange([
                    "BEGIN:VEVENT",
                    $"UID:{trip.Id:D}-{entry.ActivityId:D}@tripplanner",
                    $"SEQUENCE:{saved.Version}",
                    "DTSTAMP:" + Utc(saved.SavedAt),
                    "LAST-MODIFIED:" + Utc(saved.SavedAt),
                    "DTSTART:" + Utc(entry.Start.Value),
                    "DTEND:" + Utc(entry.End.Value),
                    "SUMMARY:" + Escape((provisional ? "[Provisional] " : "") + entry.Name),
                    "LOCATION:" + Escape(entry.Location ?? ""),
                    "DESCRIPTION:"
                        + Escape(
                            "Saved TripPlanner schedule. "
                                + (
                                    provisional
                                        ? "Timing or feasibility still needs confirmation. "
                                        : ""
                                )
                                + string.Join(" ", entry.Links.Select(l => l.Url))
                        ),
                    "STATUS:" + (provisional ? "TENTATIVE" : "CONFIRMED"),
                ]);
                if (entry.Position is { } point)
                {
                    lines.Add(
                        string.Create(
                            CultureInfo.InvariantCulture,
                            $"GEO:{point.Latitude};{point.Longitude}"
                        )
                    );
                }

                if (
                    entry.Links.FirstOrDefault(l =>
                        Uri.TryCreate(l.Url, UriKind.Absolute, out var u)
                        && u.Scheme is "https" or "http"
                    ) is
                    { } link
                )
                {
                    lines.Add("URL:" + link.Url.Replace("\r", "").Replace("\n", ""));
                }

                lines.Add("END:VEVENT");
            }
        }

        lines.Add("END:VCALENDAR");
        return string.Join("\r\n", lines.Select(Fold)) + "\r\n";
    }

    private static string Utc(DateTimeOffset time) =>
        time.UtcDateTime.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);

    private static string Escape(string text) =>
        text.Replace("\\", "\\\\")
            .Replace("\r\n", "\n")
            .Replace("\r", "\n")
            .Replace("\n", "\\n")
            .Replace(";", "\\;")
            .Replace(",", "\\,");

    private static string Fold(string line)
    {
        var output = new StringBuilder();
        int bytes = 0;
        foreach (var rune in line.EnumerateRunes())
        {
            if (bytes + rune.Utf8SequenceLength > 75)
            {
                output.Append("\r\n ");
                bytes = 1;
            }
            output.Append(rune.ToString());
            bytes += rune.Utf8SequenceLength;
        }
        return output.ToString();
    }
}
