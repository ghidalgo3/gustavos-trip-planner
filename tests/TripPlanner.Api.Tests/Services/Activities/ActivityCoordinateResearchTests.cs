using System.Net;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.Activities;

namespace TripPlanner.Api.Tests.Services.Activities;

[TestClass]
public class ActivityCoordinateResearchTests
{
    [TestMethod]
    [DataRow("Meiji Jingu", 35.676111, 139.699167, true, true)]
    [DataRow("Meiji Jingu Stadium", 35.676111, 139.699167, true, false)]
    [DataRow("Meiji Jingu", 48.86, 2.34, true, false)]
    [DataRow("Meiji Jingu", 35.676111, 139.699167, false, false)]
    public async Task Research_RequiresConsultedSourceMatchingVenueAndNearbyPublishedPoint(
        string publishedName,
        double latitude,
        double longitude,
        bool consulted,
        bool expected
    )
    {
        using var handler = new ResearchHandler(publishedName, latitude, longitude, consulted);
        var research = new OpenAiActivityCoordinateResearch(
            new HttpClient(handler),
            Microsoft.Extensions.Options.Options.Create(
                new OpenAiOptions { ApiKey = "test-key", Model = "configured-model" }
            )
        );
        var result = await research.FindAsync(
            new("Meiji Jingu", null, null, "Shrine visit", null, null, null, 0, 0),
            "Tokyo",
            new("Point", GeographyPoint.Create(35.68, 139.69)),
            default
        );
        Assert.AreEqual(expected, result is not null);
        Assert.AreEqual(consulted ? 2 : 1, handler.Calls);
        if (result is not null)
        {
            Assert.AreEqual(latitude, result.Geometry.Position.Latitude);
            Assert.AreEqual(longitude, result.Geometry.Position.Longitude);
            Assert.AreEqual("https://www.wikidata.org/wiki/Q287165", result.Source.Url);
            Assert.AreNotEqual(
                0,
                result.Geometry.Position.Latitude,
                "The model's coordinates must never be used."
            );
        }
    }

    [TestMethod]
    [DataRow("deprecated", "http://www.wikidata.org/entity/Q2", false)]
    [DataRow("normal", "http://www.wikidata.org/entity/Q111", false)]
    [DataRow("normal", "http://www.wikidata.org/entity/Q2", true)]
    public async Task PublishedCoordinates_RejectDeprecatedAndNonEarthClaims(
        string rank,
        string globe,
        bool expected
    )
    {
        using var handler = new ResearchHandler(
            "Meiji Jingū",
            35.676111,
            139.699167,
            true,
            rank,
            globe
        );
        var research = new OpenAiActivityCoordinateResearch(
            new HttpClient(handler),
            Microsoft.Extensions.Options.Options.Create(
                new OpenAiOptions { ApiKey = "test-key", Model = "configured-model" }
            )
        );
        var result = await research.FindAsync(
            new("Visit Meiji Jingu", null, null, null, null, null, null, null, null),
            "Tokyo",
            new("Point", GeographyPoint.Create(35.68, 139.69)),
            default
        );
        Assert.AreEqual(expected, result is not null);
    }

    private static string Entity(
        string name,
        double latitude,
        double longitude,
        string rank = "normal",
        string globe = "http://www.wikidata.org/entity/Q2"
    ) =>
        JsonSerializer.Serialize(
            new
            {
                entities = new
                {
                    Q287165 = new
                    {
                        labels = new { en = new { value = name } },
                        claims = new
                        {
                            P625 = new[]
                            {
                                new
                                {
                                    rank,
                                    mainsnak = new
                                    {
                                        datavalue = new
                                        {
                                            value = new
                                            {
                                                latitude,
                                                longitude,
                                                globe,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            }
        );

    private sealed class ResearchHandler(
        string name,
        double latitude,
        double longitude,
        bool consulted,
        string rank = "normal",
        string globe = "http://www.wikidata.org/entity/Q2"
    ) : HttpMessageHandler
    {
        public int Calls { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        )
        {
            Calls++;
            if (Calls == 1)
            {
                Assert.AreEqual("api.openai.com", request.RequestUri!.Host);
                Assert.AreEqual("test-key", request.Headers.Authorization!.Parameter);
                using var payload = JsonDocument.Parse(
                    await request.Content!.ReadAsStringAsync(cancellationToken)
                );
                Assert.AreEqual(
                    "configured-model",
                    payload.RootElement.GetProperty("model").GetString()
                );
                Assert.IsFalse(payload.RootElement.GetProperty("store").GetBoolean());
                return new(HttpStatusCode.OK)
                {
                    Content = new StringContent(
                        JsonSerializer.Serialize(
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
                                            sources = consulted
                                                ? new[]
                                                {
                                                    new
                                                    {
                                                        url = "https://www.wikidata.org/wiki/Q287165",
                                                    },
                                                }
                                                : [],
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
                                                text = "{\"wikidataId\":\"Q287165\"}",
                                            },
                                        },
                                    },
                                },
                            }
                        )
                    ),
                };
            }
            Assert.AreEqual(
                "https://www.wikidata.org/wiki/Special:EntityData/Q287165.json",
                request.RequestUri!.AbsoluteUri
            );
            Assert.IsNull(
                request.Headers.Authorization,
                "Never send the OpenAI credential to the coordinate source."
            );
            return new(HttpStatusCode.OK)
            {
                Content = new StringContent(Entity(name, latitude, longitude, rank, globe)),
            };
        }
    }
}
