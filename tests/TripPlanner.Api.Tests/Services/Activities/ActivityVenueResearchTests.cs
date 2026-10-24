using System.Text.Json;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.Activities;

namespace TripPlanner.Api.Tests.Services.Activities;

[TestClass]
public class ActivityVenueResearchTests
{
    [TestMethod]
    [DataRow("南4条西4丁目1番1", true, false)]
    [DataRow(null, false, false)]
    [DataRow("6-1-16 豊洲", true, true)]
    [DataRow(null, false, true)]
    public async Task ResearchRetainsSourcedAddressComponentsWithoutInventingMissingParts(
        string? street,
        bool hasComponents,
        bool activitySearch
    )
    {
        string source = activitySearch
            ? "https://www.teamlab.art/e/planets/"
            : "https://www.tokyuhotels.co.jp/sapporostream/access/index.html";
        string locality = activitySearch ? "江東区" : "札幌市中央区";
        string district = activitySearch ? "東京都" : "北海道";
        string postalCode = activitySearch ? "135-0061" : "064-0804";
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
                        action = new { sources = new[] { new { url = source } } },
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
                                        places = new[]
                                        {
                                            new
                                            {
                                                placeName = activitySearch
                                                    ? "teamLab Planets TOKYO"
                                                    : "Sapporo Stream Hotel",
                                                address = activitySearch
                                                    ? "〒135-0061 東京都江東区豊洲6-1-16"
                                                    : "〒064-0804 北海道札幌市中央区南4条西4丁目1番1",
                                                sourceUrl = source,
                                                addressComponents = new
                                                {
                                                    addressLine = street,
                                                    locality,
                                                    adminDistrict = district,
                                                    postalCode,
                                                },
                                            },
                                        },
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
            Microsoft.Extensions.Options.Options.Create(new OpenAiOptions { ApiKey = "test" })
        );
        var venues = activitySearch
            ? await ((IActivityVenueSearch)research).SearchActivitiesAsync(
                "teamlabs planets",
                "Tokyo",
                "JP",
                [],
                default
            )
            : await research.SearchAsync("Sapporo Stream Hotel", "Sapporo", "JP", [], default);
        using var sent = JsonDocument.Parse(handler.Request!);
        if (activitySearch)
        {
            StringAssert.Contains(
                sent.RootElement.GetProperty("instructions").GetString()!,
                "physical activity venues"
            );
            using var input = JsonDocument.Parse(
                sent.RootElement.GetProperty("input").GetString()!
            );
            Assert.AreEqual("teamlabs planets", input.RootElement.GetProperty("query").GetString());
        }
        Assert.HasCount(1, venues);
        Assert.AreEqual(hasComponents, venues[0].AddressComponents is not null);
        if (hasComponents)
        {
            Assert.AreEqual(
                new StructuredAddress(street!, locality, district, postalCode),
                venues[0].AddressComponents
            );
        }
        using var request = JsonDocument.Parse(handler.Request!);
        var schema = request
            .RootElement.GetProperty("text")
            .GetProperty("format")
            .GetProperty("schema")
            .GetProperty("properties")
            .GetProperty("places")
            .GetProperty("items")
            .GetProperty("properties")
            .GetProperty("addressComponents");
        CollectionAssert.AreEquivalent(
            new[] { "addressLine", "locality", "adminDistrict", "postalCode" },
            schema
                .GetProperty("required")
                .EnumerateArray()
                .Select(value => value.GetString())
                .ToArray()
        );
    }

    [TestMethod]
    public async Task StaySearchReturnsDistinctSourcedMatchesInOrderAndDiscardsInvalidEntries()
    {
        const string source = "https://hotel.test/locations";
        var places = new[]
        {
            new
            {
                placeName = "Hotel East",
                address = "1 East Street",
                sourceUrl = source,
            },
            new
            {
                placeName = "Hotel West",
                address = "2 West Street",
                sourceUrl = source,
            },
            new
            {
                placeName = "Hotel East",
                address = "1 East Street",
                sourceUrl = source,
            },
            new
            {
                placeName = "Invented source",
                address = "3 Street",
                sourceUrl = "https://not-consulted.test",
            },
            new
            {
                placeName = "Missing address",
                address = "",
                sourceUrl = source,
            },
            new
            {
                placeName = "Beyond provider budget",
                address = "6 Street",
                sourceUrl = source,
            },
        };
        string response = JsonSerializer.Serialize(
            new
            {
                status = "completed",
                output = new object[]
                {
                    new
                    {
                        type = "web_search_call",
                        status = "completed",
                        action = new { sources = new[] { new { url = source } } },
                    },
                    new
                    {
                        type = "message",
                        content = new[]
                        {
                            new
                            {
                                type = "output_text",
                                text = JsonSerializer.Serialize(new { places }),
                            },
                        },
                    },
                },
            }
        );
        using var handler = new OpenAiActivityAssistantTests.ResponseHandler(response);
        using var client = new HttpClient(handler);
        var research = new OpenAiActivityVenueResearch(
            client,
            Microsoft.Extensions.Options.Options.Create(
                new OpenAiOptions { ApiKey = "test", Model = "configured-model" }
            )
        );
        var results = await research.SearchAsync("Hotel", "Tokyo", "JP", [], default);
        CollectionAssert.AreEqual(
            new[] { "Hotel East", "Hotel West" },
            results.Select(result => result.PlaceName).ToArray()
        );
        Assert.IsTrue(results.All(result => result.Source.Url == source));
        using var request = JsonDocument.Parse(handler.Request!);
        Assert.AreEqual(
            "web_search",
            request.RootElement.GetProperty("tool_choice").GetProperty("type").GetString()
        );
        using var input = JsonDocument.Parse(request.RootElement.GetProperty("input").GetString()!);
        Assert.AreEqual("Hotel", input.RootElement.GetProperty("query").GetString());
        Assert.AreEqual("Tokyo", input.RootElement.GetProperty("city").GetString());
        Assert.AreEqual("JP", input.RootElement.GetProperty("countryCode").GetString());
    }

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
