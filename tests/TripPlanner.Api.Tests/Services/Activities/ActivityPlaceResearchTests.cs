using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Activities;
using TripPlanner.Api.Services.Maps;

namespace TripPlanner.Api.Tests.Services.Activities;

[TestClass]
public sealed class ActivityPlaceResearchTests
{
    [TestMethod]
    [DataRow("published")]
    [DataRow("address")]
    [DataRow("missing")]
    [DataRow("failure")]
    public async Task WebSearch_ResolvesDistantVenueWithoutChangingItsAddressOrSources(
        string outcome
    )
    {
        var coordinates = new Coordinates(outcome);
        var geocoder = new Geocoder(outcome);
        var research = new ActivityPlaceResearch(
            new Venues(),
            new VenueAddressLookup(geocoder, NullLogger<VenueAddressLookup>.Instance),
            coordinates,
            NullLogger<ActivityPlaceResearch>.Instance
        );
        var destination = new GeoJsonFeature<DestinationProperties>(
            "Feature",
            "sapporo-jp",
            new("Point", GeographyPoint.Create(43.0618, 141.3545)),
            new("Sapporo", "JP", "Asia/Tokyo", "context", null, null, [])
        );
        var matches = await research.FindAsync("Asahiyama Zoo", destination, default);
        var result = matches.Single();
        Assert.AreEqual("旭川市旭山動物園", result.Name);
        Assert.AreEqual(Venues.Address, result.Address);
        Assert.AreEqual(Venues.Source, result.Source);
        Assert.AreEqual(outcome == "address" ? 0 : 1, coordinates.Calls);
        if (outcome is "published" or "address")
        {
            Assert.AreEqual(43.76805114, result.Geometry!.Position.Latitude);
            Assert.AreEqual(142.4797823, result.Geometry.Position.Longitude);
        }
        else
        {
            Assert.IsNull(result.Geometry);
        }
        if (outcome == "published")
        {
            Assert.AreEqual("https://www.wikidata.org/wiki/Q993926", result.LocationSource!.Url);
            Assert.IsNotNull(result.Warning);
            Assert.AreEqual(Venues.Address, coordinates.Request!.Description);
        }
    }

    private static readonly GeoJsonPoint Zoo = new(
        "Point",
        GeographyPoint.Create(43.76805114, 142.4797823)
    );

    private sealed class Venues : IActivityVenueSearch
    {
        public const string Address = "〒078-8205 北海道旭川市東旭川町倉沼, Japan";
        public static readonly ActivityLink Source = new(
            "https://www.city.asahikawa.hokkaido.jp/asahiyamazoo/2200/d053772.html",
            "Zoo address"
        );

        public Task<IReadOnlyList<ActivityVenue>> SearchActivitiesAsync(
            string query,
            string city,
            string country,
            IReadOnlyList<DestinationStay> stays,
            CancellationToken ct
        ) =>
            Task.FromResult<IReadOnlyList<ActivityVenue>>([
                new("旭川市旭山動物園", Address, Source),
            ]);
    }

    private sealed class Geocoder(string outcome) : IAddressGeocoder
    {
        public Task<IReadOnlyList<AddressLocationCandidate>> FindAsync(
            string address,
            string city,
            string country,
            CancellationToken ct,
            GeoJsonPoint? center = null,
            StructuredAddress? structuredAddress = null
        ) =>
            Task.FromResult<IReadOnlyList<AddressLocationCandidate>>(
                outcome == "address" ? [new(Zoo, address, AddressMatchConfidence.High, false)] : []
            );
    }

    private sealed class Coordinates(string outcome) : IActivityCoordinateResearch
    {
        public int Calls { get; private set; }
        public ActivityCandidate? Request { get; private set; }

        public Task<ActivityLocationSuggestion?> FindAsync(
            ActivityCandidate candidate,
            string city,
            GeoJsonPoint center,
            CancellationToken ct
        )
        {
            Calls++;
            Request = candidate;
            if (outcome == "failure")
            {
                throw new HttpRequestException("Source unavailable");
            }
            return Task.FromResult<ActivityLocationSuggestion?>(
                outcome == "missing"
                    ? null
                    : new(
                        "Asahiyama Zoo",
                        Zoo,
                        new("https://www.wikidata.org/wiki/Q993926", "Published coordinates"),
                        DateTimeOffset.UtcNow
                    )
            );
        }
    }
}
