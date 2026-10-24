using System.Text.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Tests.Serialization;

[TestClass]
public sealed class ClockTimeSerializationTests
{
    [TestMethod]
    public void SavedPlans_RoundTripIso8601ClockTimes()
    {
        const string json = """
            {"settings":{"sleepStart":"23:00:00","sleepEnd":"07:00:00"},
             "days":[{"stayId":"00000000-0000-0000-0000-000000000001","date":"2027-06-10","activityIds":[],"availableFrom":"00:00:00","availableUntil":null}],
             "rules":[{"activityId":"00000000-0000-0000-0000-000000000002","fixedStart":"09:30:00","openingWindows":[{"date":"2027-06-10","start":"09:00:00","end":"23:59:00"}]}]}
            """;
        var plan = JsonSerializer.Deserialize<ActivityPlan>(json, JsonSerializerOptions.Web)!;
        Assert.AreEqual(new TimeOnly(23, 0), plan.Settings.SleepStart);
        Assert.AreEqual(new TimeOnly(7, 0), plan.Settings.SleepEnd);
        Assert.AreEqual(TimeOnly.MinValue, plan.Days[0].AvailableFrom);
        Assert.IsNull(plan.Days[0].AvailableUntil);
        Assert.AreEqual(new TimeOnly(9, 30), plan.Rules[0].FixedStart);
        Assert.AreEqual(new TimeOnly(9, 0), plan.Rules[0].OpeningWindows[0].Start);
        Assert.AreEqual(new TimeOnly(23, 59), plan.Rules[0].OpeningWindows[0].End);

        var saved = JsonSerializer.SerializeToElement(plan, JsonSerializerOptions.Web);
        Assert.AreEqual(
            "23:00:00",
            saved.GetProperty("settings").GetProperty("sleepStart").GetString()
        );
        Assert.AreEqual(
            "00:00:00",
            saved.GetProperty("days")[0].GetProperty("availableFrom").GetString()
        );
        Assert.AreEqual(
            JsonValueKind.Null,
            saved.GetProperty("days")[0].GetProperty("availableUntil").ValueKind
        );
        Assert.AreEqual(
            "09:30:00",
            saved.GetProperty("rules")[0].GetProperty("fixedStart").GetString()
        );
        Assert.AreEqual(
            "23:59:00",
            saved
                .GetProperty("rules")[0]
                .GetProperty("openingWindows")[0]
                .GetProperty("end")
                .GetString()
        );
    }

    [TestMethod]
    [DataRow("\"24:00\"")]
    [DataRow("\"9:00\"")]
    [DataRow("\"23:60\"")]
    [DataRow("\"09:00\"")]
    [DataRow("\"09:00Z\"")]
    [DataRow("\"09:00:00.\"")]
    [DataRow("\"\"")]
    [DataRow("900")]
    [DataRow("null")]
    public void RequiredClockTimes_RejectInvalidOrUnsupportedRepresentations(string value)
    {
        Assert.ThrowsExactly<JsonException>(() =>
            JsonSerializer.Deserialize<DailyPlanningSettings>(
                $$"""{"sleepStart":{{value}}}""",
                JsonSerializerOptions.Web
            )
        );
    }

    [TestMethod]
    [DataRow("{}")]
    [DataRow("{\"start\":\"09:00:00\"}")]
    [DataRow("{\"end\":\"18:00:00\"}")]
    public void MissingOpeningTimes_DoNotSilentlyBecomeMidnight(string json)
    {
        Assert.ThrowsExactly<JsonException>(() =>
            JsonSerializer.Deserialize<ActivityOpeningWindow>(json, JsonSerializerOptions.Web)
        );
    }

    [TestMethod]
    public void UnspecifiedOptionalTimes_RemainUnknown_AndSettingsRetainDefaults()
    {
        var rule = JsonSerializer.Deserialize<ActivityPlanRule>("{}", JsonSerializerOptions.Web)!;
        Assert.IsNull(rule.FixedStart);
        var defaults = JsonSerializer.Deserialize<DailyPlanningSettings>(
            "{}",
            JsonSerializerOptions.Web
        )!;
        Assert.AreEqual(new TimeOnly(23, 0), defaults.SleepStart);
        Assert.AreEqual(new TimeOnly(7, 0), defaults.SleepEnd);
    }

    [TestMethod]
    public void SubMinuteValues_RetainIsoPrecision_ButFailPlanningValidation()
    {
        var time = new TimeOnly(9, 30, 1);
        Assert.IsFalse(new ClockTimeAttribute().IsValid(time));
        var json = JsonSerializer.SerializeToElement(
            new DailyPlanningSettings { SleepStart = time },
            JsonSerializerOptions.Web
        );
        Assert.AreEqual("09:30:01", json.GetProperty("sleepStart").GetString());
    }
}
