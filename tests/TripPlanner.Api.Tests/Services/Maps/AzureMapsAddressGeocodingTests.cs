using System.Net;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Maps;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Services.Maps;

[TestClass]
public sealed class AzureMapsAddressGeocodingTests
{
    private static readonly GeoJsonPoint Center = new(
        "Point",
        GeographyPoint.Create(43.0618, 141.3545)
    );
    private static readonly StructuredAddress Components = new(
        "南4条西4丁目1番1",
        "札幌市中央区",
        "北海道",
        "064-0804"
    );

    [TestMethod]
    public async Task SapporoBeerMuseum_IndividualMailingPostcodeAllowsReviewableStreetCandidates()
    {
        using var handler = new Responses(
            Fixture("sapporo-beer-museum-freeform"),
            Fixture("sapporo-beer-museum-structured")
        );
        var candidates = await Geocoder(handler)
            .GeocodeAddressAsync(
                "〒065-8633 北海道札幌市東区北7条東9丁目1-1, Japan",
                "Sapporo",
                "JP",
                default,
                Center,
                new("北7条東9丁目1-1", "札幌市東区", "北海道", "065-8633")
            );
        Assert.IsNotEmpty(candidates);
        StringAssert.Contains(candidates[0].FormattedAddress, "Kita7johigashi");
        StringAssert.Contains(candidates[0].FormattedAddress, "065-0007");
        Assert.IsTrue(
            candidates.All(candidate =>
                candidate.PostalCodeMismatch
                && candidate.Ambiguous
                && candidate.Confidence == AddressMatchConfidence.Medium
            )
        );
        Assert.IsFalse(
            candidates.Any(candidate =>
                candidate.FormattedAddress.Contains("060-", StringComparison.Ordinal)
            )
        );
        Assert.HasCount(2, handler.Urls);
    }

    [TestMethod]
    [DataRow("JP", "065-8633", "065-0007", true)]
    [DataRow("JP", "０６５－８６３３", "065-0007", true)]
    [DataRow("jp", "065-8501", "065-0007", true)]
    [DataRow("JP", "065-8701", "065-0007", true)]
    [DataRow("JP", "065-8633", "064-0007", false)]
    [DataRow("JP", "065-8633", "065-8701", false)]
    [DataRow("JP", "065-8633", "", false)]
    [DataRow("JP", "065-0007", "065-0009", false)]
    [DataRow("JP", "065-8901", "065-0007", false)]
    [DataRow("US", "065-8633", "065-0007", false)]
    public async Task PostcodeAlternatives_OnlyRelaxKnownJapaneseIndividualDeliveryRanges(
        string country,
        string expected,
        string actual,
        bool accepted
    )
    {
        var response = JsonSerializer.SerializeToNode(
            new { features = new[] { Feature("Address", "High", "Good", country, 141.3524) } }
        )!;
        response["features"]![0]!["properties"]!["address"]!["postalCode"] = actual;
        using var handler = new Responses(response.ToJsonString());
        var candidates = await Geocoder(handler)
            .GeocodeAddressAsync(
                "Address",
                "Sapporo",
                country,
                default,
                Center,
                Components with
                {
                    PostalCode = expected,
                }
            );
        Assert.AreEqual(accepted, candidates.Count == 1);
        if (accepted)
        {
            Assert.IsTrue(candidates[0].PostalCodeMismatch);
            Assert.IsTrue(
                candidates[0].Ambiguous,
                "A postcode alternative must never be auto-accepted by activity enrichment."
            );
            Assert.AreEqual(AddressMatchConfidence.Medium, candidates[0].Confidence);
        }
    }

    [TestMethod]
    public async Task SapporoHotel_UsesStructuredFallbackAndPreservesAmbiguousAddressChoices()
    {
        using var handler = new Responses(Neighborhood(), Fixture());
        var candidates = await Geocoder(handler)
            .GeocodeAddressAsync(
                "〒064-0804 北海道札幌市中央区南4条西4丁目1番1, Japan",
                "Sapporo",
                "JP",
                default,
                Center,
                Components
            );
        Assert.HasCount(2, candidates);
        Assert.IsTrue(
            candidates.All(candidate =>
                candidate.Confidence == AddressMatchConfidence.Medium && candidate.Ambiguous
            )
        );
        Assert.IsTrue(
            candidates.Any(candidate =>
                candidate.Geometry.Position.Equals(GeographyPoint.Create(43.0552182, 141.3524322))
            )
        );
        Assert.IsTrue(
            candidates.All(candidate =>
                candidate.FormattedAddress.Contains("064-0804", StringComparison.Ordinal)
            )
        );
        Assert.HasCount(2, handler.Urls);
        string structured = Uri.UnescapeDataString(handler.Urls[1]);
        Assert.DoesNotContain("query=", structured);
        StringAssert.Contains(structured, "addressLine=南4条西4丁目1番1");
        StringAssert.Contains(structured, "locality=札幌市中央区");
        StringAssert.Contains(structured, "adminDistrict=北海道");
        StringAssert.Contains(structured, "postalCode=064-0804");
        StringAssert.Contains(structured, "countryRegion=JP");
        StringAssert.Contains(structured, "coordinates=141.3545,43.0618");
        Assert.IsTrue(handler.Urls.All(url => !url.Contains("test-sas", StringComparison.Ordinal)));
    }

    [TestMethod]
    public async Task PreciseMatch_DeduplicatesPointsAndSkipsAnotherProviderCall()
    {
        var feature = Feature("Address", "High", "Good", "JP", 141.3524);
        using var handler = new Responses(
            JsonSerializer.Serialize(new { features = new[] { feature, feature } })
        );
        var candidates = await Geocoder(handler)
            .GeocodeAddressAsync("Address", "Sapporo", "JP", default, Center, Components);
        Assert.HasCount(1, candidates);
        Assert.HasCount(1, handler.Urls);
        Assert.IsFalse(candidates[0].Ambiguous);
        Assert.AreEqual(AddressMatchConfidence.High, candidates[0].Confidence);
    }

    [TestMethod]
    [DataRow("Address", "High", "Good", "JP", 141.3524, true)]
    [DataRow("Address", "Medium", "Ambiguous", "JP", 141.3524, true)]
    [DataRow("Address", "Low", "Good", "JP", 141.3524, false)]
    [DataRow("Address", "High", "UpHierarchy", "JP", 141.3524, false)]
    [DataRow("Neighborhood", "High", "Good", "JP", 141.3524, false)]
    [DataRow("Postcode1", "High", "Good", "JP", 141.3524, false)]
    [DataRow("Address", "High", "Good", "US", 141.3524, false)]
    [DataRow("Address", "High", "Good", "JP", 139.7, true)]
    [DataRow("Address", "High", "Good", "JP", 181.0, false)]
    public async Task Candidates_RequireStreetAddressQualityAndCountryButNotProximity(
        string type,
        string confidence,
        string code,
        string country,
        double longitude,
        bool accepted
    )
    {
        using var handler = new Responses(
            JsonSerializer.Serialize(
                new { features = new[] { Feature(type, confidence, code, country, longitude) } }
            )
        );
        var candidates = await Geocoder(handler)
            .GeocodeAddressAsync("Address", "Sapporo", "JP", default, Center);
        Assert.AreEqual(accepted, candidates.Count == 1);
    }

    [TestMethod]
    [DataRow("{\"features\":[null,1,{}]}")]
    [DataRow("{\"features\":[{\"properties\":null}]}")]
    [DataRow("{\"features\":{}}")]
    [DataRow("{}")]
    public async Task MalformedOrMissingFeatures_DoNotBecomePins(string response)
    {
        using var handler = new Responses(response);
        Assert.IsEmpty(
            await Geocoder(handler).GeocodeAddressAsync("Address", "Sapporo", "JP", default, Center)
        );
    }

    [TestMethod]
    public async Task FailedStructuredLookup_PreservesAUsableFreeformCandidate()
    {
        using var handler = new Responses(
            JsonSerializer.Serialize(
                new
                {
                    features = new[] { Feature("Address", "Medium", "Ambiguous", "JP", 141.3524) },
                }
            )
        );
        handler.FailAfterFirst = true;
        var candidates = await Geocoder(handler)
            .GeocodeAddressAsync("Address", "Sapporo", "JP", default, Center, Components);
        Assert.HasCount(1, candidates);
        Assert.HasCount(2, handler.Urls);
        Assert.AreEqual(AddressMatchConfidence.Medium, candidates[0].Confidence);
    }

    [TestMethod]
    public async Task Cancellation_DoesNotStartAStructuredFallback()
    {
        using var cancellation = new CancellationTokenSource();
        using var handler = new Responses(Neighborhood()) { AfterFirst = cancellation.Cancel };
        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            Geocoder(handler)
                .GeocodeAddressAsync(
                    "Address",
                    "Sapporo",
                    "JP",
                    cancellation.Token,
                    Center,
                    Components
                )
        );
        Assert.HasCount(1, handler.Urls);
    }

    [TestMethod]
    public async Task AsahiyamaZoo_AreaCentresDoNotBecomeVenuePins()
    {
        var freeform = JsonSerializer.Serialize(
            new
            {
                features = new[]
                {
                    new
                    {
                        properties = new
                        {
                            type = "Neighborhood",
                            confidence = "High",
                            address = new
                            {
                                formattedAddress = "Higashiasahikawacho-kuranuma, Japan",
                                countryRegion = new { ISO = "JP" },
                            },
                        },
                        geometry = new
                        {
                            type = "Point",
                            coordinates = new[] { 142.48712158203125, 43.773460388183594 },
                        },
                    },
                },
            }
        );
        var structured = JsonSerializer.Serialize(
            new
            {
                features = new[]
                {
                    new
                    {
                        properties = new
                        {
                            type = "Postcode1",
                            confidence = "Medium",
                            matchCodes = new[] { "UpHierarchy" },
                            address = new
                            {
                                formattedAddress = "078-8205, Japan",
                                postalCode = "078-8205",
                                countryRegion = new { ISO = "JP" },
                            },
                        },
                        geometry = new
                        {
                            type = "Point",
                            coordinates = new[] { 142.4862823486328, 43.76129150390625 },
                        },
                    },
                },
            }
        );
        using var handler = new Responses(freeform, structured);
        var candidates = await Geocoder(handler)
            .GeocodeAddressAsync(
                "〒078-8205 北海道旭川市東旭川町倉沼, Japan",
                "Sapporo",
                "JP",
                default,
                Center,
                new("東旭川町倉沼", "旭川市", "北海道", "078-8205")
            );
        Assert.IsEmpty(
            candidates,
            "A neighbourhood or postcode centre is not the zoo's precise location."
        );
        Assert.HasCount(2, handler.Urls);
    }

    private static string Neighborhood() =>
        JsonSerializer.Serialize(
            new
            {
                features = new[] { Feature("Neighborhood", "Medium", "Good", "JP", 141.3227844) },
            }
        );

    private static object Feature(
        string type,
        string confidence,
        string code,
        string country,
        double longitude
    ) =>
        new
        {
            properties = new
            {
                type,
                confidence,
                matchCodes = new[] { code },
                address = new
                {
                    countryRegion = new { ISO = country },
                    postalCode = "064-0804",
                    formattedAddress = "4 Chome 1-1, Sapporo, 064-0804, Japan",
                },
            },
            geometry = new { type = "Point", coordinates = new[] { longitude, 43.0552182 } },
        };

    private static string Fixture(string name = "sapporo-structured")
    {
        using var stream =
            typeof(AzureMapsAddressGeocodingTests).Assembly.GetManifestResourceStream(
                $"TripPlanner.Api.Tests.Services.Maps.Fixtures.{name}.json"
            )!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private static AzureMapsClient Geocoder(HttpMessageHandler handler) =>
        AzureMapsTestClient.Create(new HttpClient(handler), new Tokens());

    private sealed class Tokens : IMapTokenProvider
    {
        public Task<MapToken> GetTokenAsync(CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(
                new MapToken(
                    "test-sas",
                    "https://atlas.example.test",
                    DateTimeOffset.UtcNow.AddHours(1)
                )
            );
        }
    }

    private sealed class Responses(params string[] responses) : HttpMessageHandler
    {
        public List<string> Urls { get; } = [];
        public bool FailAfterFirst { get; set; }
        public Action? AfterFirst { get; init; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        )
        {
            cancellationToken.ThrowIfCancellationRequested();
            Urls.Add(request.RequestUri!.ToString());
            if (Urls.Count == 1)
            {
                AfterFirst?.Invoke();
            }
            return Task.FromResult(
                new HttpResponseMessage(
                    FailAfterFirst && Urls.Count > 1
                        ? HttpStatusCode.ServiceUnavailable
                        : HttpStatusCode.OK
                )
                {
                    Content = new StringContent(
                        responses[Math.Min(Urls.Count - 1, responses.Length - 1)]
                    ),
                }
            );
        }
    }
}
