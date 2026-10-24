using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Activities;
using TripPlanner.Api.Services.Destinations;

namespace TripPlanner.Api.Tests.Services.Destinations;

[TestClass]
public sealed class StayAddressResearchTests
{
    private static readonly GeoJsonFeature<DestinationProperties> Destination = new(
        "Feature",
        "tokyo-jp",
        new("Point", GeographyPoint.Create(35.68, 139.69)),
        new(
            "Tokyo",
            "JP",
            "Asia/Tokyo",
            "context",
            null,
            null,
            [new(Guid.NewGuid(), 0, new(2027, 6, 10), new(2027, 6, 12), "", "")]
        )
    );

    [TestMethod]
    [DataRow("located")]
    [DataRow("unknown")]
    [DataRow("failure")]
    [DataRow("timeout")]
    public async Task ResearchUsesExactHotelAndDestinationThenGeocodesOnlyTheSourcedAddress(
        string outcome
    )
    {
        var venue = new VenueResearch();
        var places = new Places(outcome);
        var result = await new StayAddressResearch(
            venue,
            places,
            NullLogger<StayAddressResearch>.Instance
        ).FindAsync("JR-East Hotel Mets Shibuya", Destination, default);
        Assert.AreEqual("JR-East Hotel Mets Shibuya", venue.Candidate!.Name);
        Assert.AreEqual(venue.Candidate.Name, venue.Candidate.PlaceName);
        Assert.AreEqual("Tokyo", venue.City);
        Assert.AreEqual("JP", venue.Country);
        CollectionAssert.AreEqual(Destination.Properties.Stays.ToArray(), venue.Stays!.ToArray());
        Assert.AreEqual("3-29-17 Shibuya, Tokyo", places.Address);
        Assert.AreEqual(Destination.Geometry, places.Center);
        Assert.IsNotNull(result);
        Assert.AreEqual(venue.Result!.Address, result.Address);
        Assert.AreEqual(venue.Result.Source, result.Source);
        if (outcome == "located")
        {
            Assert.AreEqual(Places.Point, result.Geometry);
            Assert.IsNull(result.Warning);
        }
        else
        {
            Assert.IsNull(result.Geometry);
            Assert.IsNotNull(result.Warning);
        }
    }

    [TestMethod]
    public async Task NoSourcedAddressSkipsGeocoding()
    {
        var places = new Places("located");
        var result = await new StayAddressResearch(
            new VenueResearch { Result = null },
            places,
            NullLogger<StayAddressResearch>.Instance
        ).FindAsync("Ambiguous hotel", Destination, default);
        Assert.IsNull(result);
        Assert.IsNull(places.Address);
    }

    [TestMethod]
    public async Task UserCancellationStopsResearchRatherThanReturningAPartialResult()
    {
        using var cancellation = new CancellationTokenSource();
        var places = new Places("timeout", cancellation);
        var research = new StayAddressResearch(
            new VenueResearch(),
            places,
            NullLogger<StayAddressResearch>.Instance
        );
        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            research.FindAsync("Hotel", Destination, cancellation.Token)
        );
    }

    private sealed class VenueResearch : IActivityVenueResearch
    {
        public ActivityVenue? Result { get; init; } =
            new(
                "Hotel Mets Shibuya",
                "3-29-17 Shibuya, Tokyo",
                new("https://www.hotelmets.jp/en/shibuya/access.html", "Venue source")
            );
        public ActivityCandidate? Candidate { get; private set; }
        public string? City { get; private set; }
        public string? Country { get; private set; }
        public IReadOnlyList<DestinationStay>? Stays { get; private set; }

        public Task<ActivityVenue?> FindAsync(
            ActivityCandidate activity,
            string city,
            string countryCode,
            IReadOnlyList<DestinationStay> stays,
            CancellationToken cancellationToken,
            string userPrompt = ""
        )
        {
            Candidate = activity;
            City = city;
            Country = countryCode;
            Stays = stays;
            return Task.FromResult(Result);
        }
    }

    private sealed class Places(string outcome, CancellationTokenSource? cancel = null)
        : IActivityPlaceResolver
    {
        public static readonly GeoJsonPoint Point = new(
            "Point",
            GeographyPoint.Create(35.655, 139.703)
        );
        public string? Address { get; private set; }
        public GeoJsonPoint? Center { get; private set; }

        public Task<GeoJsonPoint?> ResolveAddressAsync(
            string address,
            string city,
            string countryCode,
            CancellationToken cancellationToken,
            GeoJsonPoint? center = null
        )
        {
            Address = address;
            Center = center;
            cancel?.Cancel();
            return outcome switch
            {
                "failure" => throw new HttpRequestException("Geocoder unavailable"),
                "timeout" => throw new OperationCanceledException(),
                "unknown" => Task.FromResult<GeoJsonPoint?>(null),
                _ => Task.FromResult<GeoJsonPoint?>(Point),
            };
        }

        public Task<GeoJsonPoint?> ResolveAsync(
            string placeName,
            string city,
            string countryCode,
            CancellationToken cancellationToken,
            GeoJsonPoint? center = null
        ) =>
            throw new AssertFailedException(
                "Never use fuzzy POI results for a researched street address."
            );
    }
}
