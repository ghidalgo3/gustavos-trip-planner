using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Activities;
using TripPlanner.Api.Services.Maps;

namespace TripPlanner.Api.Tests.Services.Activities;

[TestClass]
public sealed class AzureActivityPlaceResolverTests
{
    [TestMethod]
    [DataRow("Address", "High", "Good", "JP", 139.7, true)]
    [DataRow("Address", "High", null, "JP", 139.7, true)]
    [DataRow("Address", "Medium", "Good", "JP", 139.7, false)]
    [DataRow("Address", "High", "Ambiguous", "JP", 139.7, false)]
    [DataRow("Address", "High", "UpHierarchy", "JP", 139.7, false)]
    [DataRow("PopulatedPlace", "High", "Good", "JP", 139.7, false)]
    [DataRow("RoadBlock", "High", "Good", "JP", 139.7, false)]
    [DataRow("Address", "High", "Good", "US", 139.7, false)]
    [DataRow("Address", "High", "Good", "JP", 135.5, false)]
    public async Task ResearchedAddress_RequiresPreciseNearbyGeocoding(
        string type,
        string confidence,
        string? matchCode,
        string country,
        double longitude,
        bool accepted
    )
    {
        var properties = new Dictionary<string, object>
        {
            ["type"] = type,
            ["confidence"] = confidence,
            ["address"] = new
            {
                countryRegion = new { ISO = country },
                formattedAddress = "東京都渋谷区代々木神園町1-1",
            },
        };
        if (matchCode is not null)
        {
            properties["matchCodes"] = new[] { matchCode };
        }
        var response = JsonSerializer.Serialize(
            new
            {
                features = new[]
                {
                    new
                    {
                        properties,
                        geometry = new { type = "Point", coordinates = new[] { longitude, 35.67 } },
                    },
                },
            }
        );
        using var handler = new OpenAiActivityAssistantTests.ResponseHandler(response);
        var resolver = new AzureActivityPlaceResolver(
            new HttpClient(handler),
            new Tokens(),
            new AzureAddressGeocoder(
                new HttpClient(handler),
                new Tokens(),
                Microsoft.Extensions.Logging.Abstractions.NullLogger<AzureAddressGeocoder>.Instance
            )
        );
        const string address = "1-1 Yoyogikamizonocho, Shibuya, Tokyo 151-8557, Japan";
        var point = await resolver.ResolveAddressAsync(
            address,
            "Tokyo",
            "JP",
            default,
            new("Point", GeographyPoint.Create(35.68, 139.69))
        );
        Assert.AreEqual(accepted, point is not null);
        Assert.HasCount(1, handler.Urls);
        StringAssert.Contains(handler.Url!, "/geocode?");
        StringAssert.Contains(Uri.UnescapeDataString(handler.Url!), $"query={address}&");
        Assert.DoesNotContain("/search/poi", handler.Url!);
        if (accepted)
        {
            Assert.AreEqual(GeographyPoint.Create(35.67, longitude), point!.Position);
        }
    }

    [TestMethod]
    public async Task ResearchedAddress_DoesNotChooseBetweenDifferentPreciseMatches()
    {
        var response = JsonSerializer.Serialize(
            new
            {
                features = new[] { 139.70, 139.72 }.Select(longitude => new
                {
                    properties = new
                    {
                        type = "Address",
                        confidence = "High",
                        matchCodes = new[] { "Good" },
                        address = new
                        {
                            countryRegion = new { ISO = "JP" },
                            formattedAddress = "1 Main Street",
                        },
                    },
                    geometry = new { type = "Point", coordinates = new[] { longitude, 35.67 } },
                }),
            }
        );
        using var handler = new OpenAiActivityAssistantTests.ResponseHandler(response);
        var resolver = new AzureActivityPlaceResolver(
            new HttpClient(handler),
            new Tokens(),
            new AzureAddressGeocoder(
                new HttpClient(handler),
                new Tokens(),
                Microsoft.Extensions.Logging.Abstractions.NullLogger<AzureAddressGeocoder>.Instance
            )
        );
        Assert.IsNull(
            await resolver.ResolveAddressAsync(
                "1 Main Street, Tokyo, Japan",
                "Tokyo",
                "JP",
                default,
                new("Point", GeographyPoint.Create(35.68, 139.69))
            )
        );
    }

    private sealed class Tokens : IMapTokenProvider
    {
        public Task<MapToken> GetTokenAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(
                new MapToken(
                    "test-sas",
                    "https://atlas.example.test",
                    DateTimeOffset.UtcNow.AddHours(1)
                )
            );
    }
}
