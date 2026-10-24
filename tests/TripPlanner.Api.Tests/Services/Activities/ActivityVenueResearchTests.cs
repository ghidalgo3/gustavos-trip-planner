using System.Text.Json;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.Activities;

namespace TripPlanner.Api.Tests.Services.Activities;

[TestClass]
public class ActivityVenueResearchTests
{
    [TestMethod]
    [DataRow("Grand Museum", "1 Main Street", "https://venue.test/event", true, true)]
    [DataRow("Grand Museum", null, "https://venue.test/event", true, false)]
    [DataRow("Grand Museum", " ", "https://venue.test/event", true, false)]
    [DataRow(null, null, null, true, false)]
    [DataRow("Grand Museum", "1 Main Street", "https://invented.test", false, false)]
    [DataRow("Grand Museum", "1 Main Street", "javascript:alert(1)", true, false)]
    public async Task Research_RequiresConsultedSourceAndDoesNotGenerateActivities(
        string? place,
        string? address,
        string? source,
        bool consulted,
        bool resolves
    )
    {
        var response = JsonSerializer.Serialize(
            new
            {
                status = "completed",
                output = new object[]
                {
                    new
                    {
                        type = "web_search_call",
                        status = "completed",
                        action = new
                        {
                            type = "search",
                            sources = consulted ? new[] { new { type = "url", url = source } } : [],
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
                                text = JsonSerializer.Serialize(
                                    new
                                    {
                                        placeName = place,
                                        address,
                                        sourceUrl = source,
                                    }
                                ),
                            },
                        },
                    },
                },
            }
        );
        using var handler = new OpenAiActivityAssistantTests.ResponseHandler(response);
        var research = new OpenAiActivityVenueResearch(
            new HttpClient(handler),
            Microsoft.Extensions.Options.Options.Create(
                new OpenAiOptions { ApiKey = "test-key", Model = "configured-model" }
            )
        );
        var result = await research.FindAsync(
            new("Activity A", null, null, "Event details from image", null, null, null, null, null),
            "Paris",
            "FR",
            [],
            default,
            "The art museum inside the old railway station"
        );
        Assert.AreEqual(resolves, result is not null);
        if (resolves)
        {
            Assert.AreEqual(place, result!.PlaceName);
            Assert.AreEqual(address, result.Address);
            Assert.AreEqual(source, result.Source.Url);
        }
        using var request = JsonDocument.Parse(handler.Request!);
        Assert.AreEqual(
            "web_search",
            request.RootElement.GetProperty("tools")[0].GetProperty("type").GetString()
        );
        Assert.AreEqual(
            "web_search",
            request.RootElement.GetProperty("tool_choice").GetProperty("type").GetString()
        );
        StringAssert.Contains(
            request.RootElement.GetProperty("instructions").GetString()!,
            "Do not suggest or create other activities"
        );
        using var input = JsonDocument.Parse(request.RootElement.GetProperty("input").GetString()!);
        Assert.AreEqual(
            "Activity A",
            input.RootElement.GetProperty("activity").GetProperty("Name").GetString()
        );
        Assert.AreEqual("Paris", input.RootElement.GetProperty("city").GetString());
        Assert.AreEqual(
            "The art museum inside the old railway station",
            input.RootElement.GetProperty("userPrompt").GetString()
        );
    }
}
