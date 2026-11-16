using System.Text.Json.Nodes;

namespace TripPlanner.Api.Services.Documents;

// One calendar item owns its details and timing, whether scheduled or still a task.
public static class TripCalendarProjection
{
    private static string Text(JsonNode? value) => value?.GetValue<string>() ?? "";

    public static JsonObject Project(
        Guid tripId,
        JsonObject[] places,
        IEnumerable<JsonObject> visits,
        IEnumerable<JsonObject> activities,
        IEnumerable<JsonObject> transportation,
        JsonArray schedule
    )
    {
        var items = new List<JsonObject>();
        var timings = schedule.OfType<JsonObject>().ToDictionary(item => Text(item["id"]));
        void Timing(JsonObject item)
        {
            if (timings.TryGetValue(Text(item["id"]), out var timing))
            {
                foreach (var key in new[] { "start", "timeZone", "duration" })
                {
                    if (timing[key] is { } value)
                    {
                        item[key] = value.DeepClone();
                    }
                }
            }
            item["type"] = item["start"] is null ? "task" : "event";
            item["busy"] = item["start"] is not null;
        }
        void Dates(JsonObject item, JsonObject visit)
        {
            if (visit["arrivalDate"] is { } arrival)
            {
                item["start"] = arrival.DeepClone();
            }
            if (visit["departureDate"] is { } departure)
            {
                item["end"] = departure.DeepClone();
            }
            var city = places.Single(place =>
                Text(place["destinationId"]) == Text(visit["destinationId"])
            );
            if (city["timeZone"] is { } zone)
            {
                item["timeZone"] = zone.DeepClone();
            }
            item["type"] = item["start"] is null ? "task" : "event";
            item["busy"] = false;
        }
        foreach (var visit in visits)
        {
            var item = visit.DeepClone().AsObject();
            var city = places.Single(place =>
                Text(place["destinationId"]) == Text(visit["destinationId"])
            );
            item["kind"] = "visit";
            item["name"] = city["name"]!.DeepClone();
            item["placeId"] = city["id"]!.DeepClone();
            Dates(item, visit);
            item.Remove("arrivalDate");
            item.Remove("departureDate");
            item.Remove("accommodationPlaceId");
            item.Remove("checkInTime");
            item.Remove("checkOutTime");
            if (visit["accommodationPlaceId"] is { } accommodation)
            {
                var place = places.Single(place => Text(place["id"]) == Text(accommodation));
                var lodging = new JsonObject
                {
                    ["id"] = TripResourceProjection
                        .StableGuid($"{tripId:D}:lodging:{Text(visit["id"])}")
                        .ToString("D"),
                    ["kind"] = "lodging",
                    ["name"] = place["name"]!.DeepClone(),
                    ["placeId"] = accommodation.DeepClone(),
                    ["visitId"] = visit["id"]!.DeepClone(),
                    ["etag"] = visit["accommodationEtag"]?.DeepClone(),
                    ["timingSource"] = "visit",
                    ["checkInTime"] = visit["checkInTime"]?.DeepClone(),
                    ["checkOutTime"] = visit["checkOutTime"]?.DeepClone(),
                };
                Dates(lodging, visit);
                item.Remove("accommodationEtag");
                items.Add(lodging);
            }
            items.Add(item);
        }
        foreach (var activity in activities)
        {
            var item = activity.DeepClone().AsObject();
            item["kind"] = "activity";
            item["estimatedDuration"] = item["duration"]?.DeepClone();
            item.Remove("duration");
            Timing(item);
            items.Add(item);
        }
        foreach (var leg in transportation)
        {
            var item = leg.DeepClone().AsObject();
            Timing(item);
            if (Text(item["kind"]) == "flight")
            {
                item["name"] = "Flight " + Text(item["flightNumber"]);
                if (item["departureTime"] is { } departure)
                {
                    item["start"] = departure.DeepClone();
                    item["type"] = "event";
                    item["busy"] = true;
                }
                if (item["arrivalTime"] is { } arrival)
                {
                    item["end"] = arrival.DeepClone();
                    item.Remove("duration");
                }
                item.Remove("departureTime");
                item.Remove("arrivalTime");
            }
            else if (item["name"] is null)
            {
                item["name"] = "Transfer";
            }
            items.Add(item);
        }
        return new JsonObject
        {
            ["items"] = new JsonArray(
                items
                    .OrderBy(item => Text(item["id"]), StringComparer.Ordinal)
                    .Select(item => (JsonNode?)item)
                    .ToArray()
            ),
        };
    }
}
