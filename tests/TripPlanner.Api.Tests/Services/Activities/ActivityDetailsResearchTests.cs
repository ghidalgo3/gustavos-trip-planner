using System.Text.Json;
using System.Text.Json.Nodes;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.Activities;

namespace TripPlanner.Api.Tests.Services.Activities;

[TestClass]
public class ActivityDetailsResearchTests
{
    [TestMethod]
    [DataRow("valid", true, true)]
    [DataRow("free", true, true)]
    [DataRow("unknown", false, false)]
    [DataRow("invented-duration-source", false, true)]
    [DataRow("unsafe-cost-source", true, false)]
    [DataRow("invalid-duration", false, true)]
    [DataRow("negative-duration", false, true)]
    [DataRow("fractional-minute", false, true)]
    [DataRow("excessive-duration", false, true)]
    [DataRow("missing-duration-notes", false, true)]
    [DataRow("negative-cost", true, false)]
    [DataRow("missing-currency", true, false)]
    [DataRow("invalid-basis", true, false)]
    [DataRow("missing-cost-notes", true, false)]
    [DataRow("incomplete", false, false)]
    [DataRow("malformed", false, false)]
    public async Task Research_RetainsOnlyIndividuallySupportedValidFields(
        string scenario,
        bool hasDuration,
        bool hasCost
    )
    {
        var result = JsonNode.Parse(
            """
            {"duration":"PT1H30M","durationNotes":"Recommended 60–90 minutes; use upper bound.",
             "durationSourceUrl":"https://museum.test/visit","costAmount":20,"costCurrency":"EUR",
             "costBasis":"perPerson","costNotes":"Standard adult admission; current price, future dates unconfirmed.",
             "costSourceUrl":"https://museum.test/tickets"}
            """
        )!;
        switch (scenario)
        {
            case "free":
                result["costAmount"] = 0;
                result["costNotes"] = "Official page explicitly states free entry.";
                break;
            case "unknown":
                result["duration"] = null;
                result["costAmount"] = null;
                break;
            case "invented-duration-source":
                result["durationSourceUrl"] = "https://invented.test";
                break;
            case "unsafe-cost-source":
                result["costSourceUrl"] = "javascript:alert(1)";
                break;
            case "invalid-duration":
                result["duration"] = "90 minutes";
                break;
            case "negative-duration":
                result["duration"] = "-PT1H";
                break;
            case "fractional-minute":
                result["duration"] = "PT30S";
                break;
            case "excessive-duration":
                result["duration"] = "P8D";
                break;
            case "missing-duration-notes":
                result["durationNotes"] = null;
                break;
            case "negative-cost":
                result["costAmount"] = -1;
                break;
            case "missing-currency":
                result["costCurrency"] = null;
                break;
            case "invalid-basis":
                result["costBasis"] = "perHour";
                break;
            case "missing-cost-notes":
                result["costNotes"] = null;
                break;
        }
        string response = JsonSerializer.Serialize(
            new
            {
                status = scenario == "incomplete" ? "incomplete" : "completed",
                output = new object[]
                {
                    new
                    {
                        type = "web_search_call",
                        status = "completed",
                        action = new
                        {
                            sources = new[]
                            {
                                new { url = "https://museum.test/visit" },
                                new { url = "https://museum.test/tickets" },
                                new { url = "javascript:alert(1)" },
                            },
                        },
                    },
                    new
                    {
                        type = "message",
                        content = new[]
                        {
                            new
                            {
                                type = "output_text",
                                text = scenario == "malformed" ? "not json" : result.ToJsonString(),
                            },
                        },
                    },
                },
            }
        );
        using var handler = new OpenAiActivityAssistantTests.ResponseHandler(response);
        var research = new OpenAiActivityDetailsResearch(
            new HttpClient(handler),
            Microsoft.Extensions.Options.Options.Create(
                new OpenAiOptions { ApiKey = "test-key", Model = "configured-model" }
            )
        );
        var now = DateTimeOffset.UtcNow;
        var activity = new Activity(
            Guid.NewGuid(),
            Guid.NewGuid(),
            "paris-fr",
            null,
            new("Museum", null, "Paintings", null, ActivityState.Proposed, [ActivityKind.Culture]),
            now,
            now
        );
        var suggestion = await research.FindAsync(
            activity,
            new(
                "Feature",
                "paris-fr",
                null,
                new(
                    "Paris",
                    "FR",
                    null,
                    "context",
                    null,
                    null,
                    [new(Guid.NewGuid(), 0, new(2027, 6, 10), new(2027, 6, 14), "", "")]
                )
            ),
            default
        );
        Assert.AreEqual(hasDuration, suggestion?.Duration is not null);
        Assert.AreEqual(hasCost, suggestion?.Cost is not null);
        if (hasDuration)
        {
            Assert.AreEqual(TimeSpan.FromMinutes(90), suggestion!.Duration!.Value);
            var serialized = JsonSerializer.SerializeToElement(
                suggestion,
                new JsonSerializerOptions(JsonSerializerDefaults.Web)
            );
            Assert.AreEqual(
                "PT1H30M",
                serialized.GetProperty("duration").GetProperty("value").GetString()
            );
            Assert.AreEqual("https://museum.test/visit", suggestion.Duration.Evidence.Source.Url);
        }
        if (hasCost)
        {
            Assert.AreEqual(scenario == "free" ? 0m : 20m, suggestion!.Cost!.Value.Amount);
            Assert.AreEqual("EUR", suggestion.Cost.Value.Currency);
        }
        using var sent = JsonDocument.Parse(handler.Request!);
        Assert.AreEqual(4, sent.RootElement.GetProperty("max_tool_calls").GetInt32());
        Assert.IsFalse(sent.RootElement.GetProperty("store").GetBoolean());
        Assert.AreEqual(
            "web_search",
            sent.RootElement.GetProperty("tool_choice").GetProperty("type").GetString()
        );
        StringAssert.Contains(sent.RootElement.GetProperty("input").GetString()!, "2027-06-10");
    }
}
