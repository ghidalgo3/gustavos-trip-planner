using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Serialization;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Tests.Support;
using TripPlanner.Api.Validation;

namespace TripPlanner.Api.Tests.Serialization;

[TestClass]
public sealed class PlanningValueSerializationTests
{
    [TestMethod]
    [DataRow("P1D", true)]
    [DataRow("PT0S", true)]
    [DataRow("PT1H", true)]
    [DataRow("PT30M", true)]
    [DataRow("PT1H30M", true)]
    [DataRow("PT1H2S", true)]
    [DataRow("PT2M3.1234567S", true)]
    [DataRow("-P1DT2H3M4.5S", true)]
    [DataRow("P1DT0S", true)]
    [DataRow("P", false)]
    [DataRow("PT", false)]
    [DataRow("P1DT", false)]
    [DataRow("P1M", false)]
    [DataRow("P1Y", false)]
    [DataRow("PT1.5H", false)]
    [DataRow("PT1.5M", false)]
    [DataRow("PT1.12345678S", false)]
    [DataRow("PT1M2H", false)]
    [DataRow("PT1H2H", false)]
    [DataRow("PT-1H", false)]
    [DataRow("P1D2H", false)]
    public void DurationSchema_UsesNoLookaroundAndValidatesElapsedDurations(string text, bool valid)
    {
        // NonBacktracking rejects lookaround when compiling, catching the provider regression.
        var pattern = new Regex(IsoDurationConverter.Pattern, RegexOptions.NonBacktracking);
        Assert.AreEqual(valid, pattern.IsMatch(text));
        if (valid)
        {
            var settings = JsonSerializer.Deserialize<DailyPlanningSettings>(
                JsonSerializer.Serialize(new { slackDuration = text }),
                JsonSerializerOptions.Web
            )!;
            Assert.AreEqual(System.Xml.XmlConvert.ToTimeSpan(text), settings.SlackDuration);
        }
    }

    [TestMethod]
    [DataRow("PT0S", 0)]
    [DataRow("PT1H30M", 90)]
    [DataRow("PT90M", 90)]
    [DataRow("P1DT1H", 1500)]
    public void IsoDurations_RoundTripAsElapsedTime(string iso, int minutes)
    {
        var json = JsonSerializer.Serialize(
            new
            {
                duration = iso,
                name = "Museum",
                state = "Proposed",
            }
        );
        var properties = JsonSerializer.Deserialize<ActivityProperties>(
            json,
            JsonSerializerOptions.Web
        )!;
        Assert.AreEqual(TimeSpan.FromMinutes(minutes), properties.Duration);
        var roundTrip = JsonSerializer.Deserialize<ActivityProperties>(
            JsonSerializer.Serialize(properties, JsonSerializerOptions.Web),
            JsonSerializerOptions.Web
        )!;
        Assert.AreEqual(properties.Duration, roundTrip.Duration);
    }

    [TestMethod]
    public void ActivityJson_RoundTripsIsoDurationsAndGeoJsonCoordinates()
    {
        const string json = """
            {"type":"Feature","id":null,"geometry":{"type":"Point","coordinates":[2.35,48.86]},
             "properties":{"name":"Museum","duration":"P1DT1H","description":"Art","cost":null,"state":"Proposed"}}
            """;
        var activity = JsonSerializer.Deserialize<ActivityInput>(json, JsonSerializerOptions.Web)!;
        Assert.AreEqual(TimeSpan.FromHours(25), activity.Properties.Duration);
        Assert.AreEqual(
            GeographyPoint.Create(latitude: 48.86, longitude: 2.35),
            activity.Geometry!.Position
        );

        var saved = JsonSerializer.SerializeToElement(activity, JsonSerializerOptions.Web);
        Assert.AreEqual(
            "P1DT1H",
            saved.GetProperty("properties").GetProperty("duration").GetString()
        );
        var geometry = saved.GetProperty("geometry");
        Assert.AreEqual("Point", geometry.GetProperty("type").GetString());
        Assert.AreEqual(2.35, geometry.GetProperty("coordinates")[0].GetDouble());
        Assert.AreEqual(48.86, geometry.GetProperty("coordinates")[1].GetDouble());
        Assert.IsFalse(geometry.TryGetProperty("position", out _));
    }

    [TestMethod]
    public void SavedAssessmentsAndEvidence_UseIsoDurationsAndGeoJsonCoordinates()
    {
        var planningContext = ActivityPlanningFixture.Context(TimeSpan.FromHours(2));
        var plan = ActivityPlanningFixture.Plan(planningContext);
        var assessment = planningContext.Evaluate(plan, ActivityPlanningFixture.Now);
        var stored = new StoredActivityPlan(plan, assessment, 3, 5, ActivityPlanningFixture.Now);
        var json = JsonSerializer.SerializeToElement(stored, JsonSerializerOptions.Web);
        var day = json.GetProperty("assessment").GetProperty("days")[0];
        Assert.AreEqual("PT16H", day.GetProperty("availableDuration").GetString());
        Assert.AreEqual("PT2H", day.GetProperty("activityDuration").GetString());
        Assert.AreEqual("PT30M", day.GetProperty("breaks")[0].GetProperty("duration").GetString());
        Assert.AreEqual("PT0S", day.GetProperty("travel")[0].GetProperty("duration").GetString());
        Assert.AreEqual(
            2.35,
            day.GetProperty("entries")[0].GetProperty("coordinates")[0].GetDouble()
        );
        var restored = json.Deserialize<StoredActivityPlan>(JsonSerializerOptions.Web)!;
        Assert.AreEqual(TimeSpan.FromHours(2), restored.Assessment.Days[0].Entries[0].Duration);
        Assert.AreEqual(
            planningContext.Activities[0].Geometry!.Position,
            restored.Assessment.Days[0].Entries[0].Position
        );

        const string evidenceJson = """
            {"key":"route","mode":"walking","duration":"PT1H30M","retrievedAt":"2026-10-16T12:00:00Z",
             "expiresAt":"2026-10-16T12:30:00Z","source":"Azure Maps","walkingDuration":"PT10M","waitingDuration":"PT15M"}
            """;
        var route = JsonSerializer.Deserialize<ActivityRouteEvidence>(
            evidenceJson,
            JsonSerializerOptions.Web
        )!;
        Assert.AreEqual(TimeSpan.FromMinutes(90), route.Duration);
        Assert.AreEqual(TimeSpan.FromMinutes(10), route.WalkingDuration);
        Assert.AreEqual(TimeSpan.FromMinutes(15), route.WaitingDuration);
        Assert.AreEqual(
            "PT1H30M",
            JsonSerializer
                .SerializeToElement(route, JsonSerializerOptions.Web)
                .GetProperty("duration")
                .GetString()
        );
    }

    [TestMethod]
    public void MissingDuration_RemainsUnknown_AndRangesUseFullElapsedTime()
    {
        var properties = JsonSerializer.Deserialize<ActivityProperties>(
            """{"name":"Museum","duration":null,"description":"","state":"Proposed"}""",
            JsonSerializerOptions.Web
        )!;
        Assert.IsNull(properties.Duration);
        Assert.IsEmpty(
            ApiInputValidation.Validate(
                properties with
                {
                    Duration = TimeSpan.FromDays(7),
                },
                "activity"
            )
        );
        Assert.IsTrue(
            ApiInputValidation
                .Validate(
                    properties with
                    {
                        Duration = TimeSpan.FromDays(7) + TimeSpan.FromMinutes(1),
                    },
                    "activity"
                )
                .ContainsKey("activity.duration")
        );
        Assert.IsFalse(new DurationRangeAttribute(0, 1440).IsValid(TimeSpan.FromSeconds(30)));
    }

    [TestMethod]
    [DataRow("1.5")]
    [DataRow("\"01:30:00\"")]
    [DataRow("2147483648")]
    [DataRow("\"P1Y\"")]
    [DataRow("\"P1M\"")]
    [DataRow("\"P\"")]
    [DataRow("\"PT\"")]
    [DataRow("\"PT1H\\n\"")]
    [DataRow("\"PT1.5H\"")]
    [DataRow("\"PT99999999999999999999999H\"")]
    public void InvalidDurationJson_IsRejected(string value)
    {
        Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<DailyPlanningSettings>(
                "{\"slackDuration\":" + value + "}",
                JsonSerializerOptions.Web
            )
        );
    }

    [TestMethod]
    [DataRow("[181,48]")]
    [DataRow("[2,91]")]
    [DataRow("[2]")]
    [DataRow("[2,48,3]")]
    [DataRow("[\"2\",48]")]
    [DataRow("{}")]
    public void InvalidCoordinates_AreRejectedBeforeCreatingAPoint(string coordinates)
    {
        Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<GeoJsonPoint>(
                "{\"type\":\"Point\",\"coordinates\":" + coordinates + "}",
                JsonSerializerOptions.Web
            )
        );
    }

    [TestMethod]
    public void RouteCacheKeys_PreserveExistingCoordinateOrder()
    {
        var departure = ActivityPlanningFixture.Now;
        var expected = ActivityPlanRules.Hash(
            new
            {
                from = new[] { 2.35, 48.86 },
                to = new[] { 2.36, 48.87 },
                departure = "2026-10-16T12:00",
                mode = "walking",
            }
        );
        Assert.AreEqual(
            expected,
            ActivityPlanningContext.RouteKey(
                GeographyPoint.Create(latitude: 48.86, longitude: 2.35),
                GeographyPoint.Create(latitude: 48.87, longitude: 2.36),
                departure,
                "walking"
            )
        );
    }
}
