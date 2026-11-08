using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Activities;
using TripPlanner.Api.Services.Destinations;
using TripPlanner.Api.Services.Maps;
using TripPlanner.Api.Tests.Support;

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
        var matches = await new StayAddressResearch(
            venue,
            new VenueAddressLookup(places, NullLogger<VenueAddressLookup>.Instance)
        ).FindAsync("JR-East Hotel Mets Shibuya", Destination, default);
        Assert.AreEqual("JR-East Hotel Mets Shibuya", venue.Query);
        Assert.AreEqual("Tokyo", venue.City);
        Assert.AreEqual("JP", venue.Country);
        CollectionAssert.AreEqual(Destination.Properties.Stays.ToArray(), venue.Stays!.ToArray());
        Assert.AreEqual("3-29-17 Shibuya, Tokyo", places.Address);
        Assert.AreEqual(Destination.Geometry, places.Center);
        Assert.AreEqual(venue.Result![0].AddressComponents, places.Components);
        Assert.HasCount(1, matches);
        var result = matches[0];
        Assert.AreEqual(venue.Result![0].Address, result.Address);
        Assert.AreEqual(venue.Result[0].Source, result.Source);
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
            new VenueResearch { Result = [] },
            new VenueAddressLookup(places, NullLogger<VenueAddressLookup>.Instance)
        ).FindAsync("Ambiguous hotel", Destination, default);
        Assert.IsEmpty(result);
        Assert.IsNull(places.Address);
    }

    [TestMethod]
    public async Task UserCancellationStopsResearchRatherThanReturningAPartialResult()
    {
        using var cancellation = new CancellationTokenSource();
        var places = new Places("timeout", cancellation);
        var research = new StayAddressResearch(
            new VenueResearch(),
            new VenueAddressLookup(places, NullLogger<VenueAddressLookup>.Instance)
        );
        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            research.FindAsync("Hotel", Destination, cancellation.Token)
        );
    }

    [TestMethod]
    public async Task MultipleMatchesPreserveOrderAndPartialResultsWithBoundedGeocoding()
    {
        var matches = Enumerable
            .Range(0, 8)
            .Select(i => new ActivityVenue(
                $"Hotel {i}",
                $"{i} Main Street",
                new("https://hotel.test/locations", "Hotel website")
            ))
            .ToList();
        matches.Insert(1, matches[0]);
        var places = new BatchPlaces();
        var results = await new StayAddressResearch(
            new VenueResearch { Result = matches },
            new VenueAddressLookup(places, NullLogger<VenueAddressLookup>.Instance)
        ).FindAsync("Hotel", Destination, default);
        Assert.HasCount(5, results);
        CollectionAssert.AreEqual(
            new[] { "Hotel 0", "Hotel 1", "Hotel 2", "Hotel 3", "Hotel 4" },
            results.Select(result => result.Name).ToArray()
        );
        Assert.AreEqual(5, places.Calls);
        Assert.AreEqual(2, places.MaxConcurrent);
        Assert.IsNull(results[1].Geometry);
        Assert.IsNotNull(results[1].Warning);
        Assert.IsNotNull(results[0].Geometry);
        Assert.IsNotNull(results[2].Geometry);
        Assert.AreEqual(matches[0].Source, results[0].Source);
    }

    [TestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public async Task AmbiguousStreetAddressesBecomeDistinctReviewableStayOptions(
        bool postalMismatch
    )
    {
        var venue = new VenueResearch();
        var candidates = new[]
        {
            new AddressLocationCandidate(
                Places.Point,
                "3-29-17 Shibuya, Tokyo",
                AddressMatchConfidence.Medium,
                true
            )
            {
                PostalCodeMismatch = postalMismatch,
            },
            new AddressLocationCandidate(
                new("Point", GeographyPoint.Create(35.656, 139.704)),
                "3-29 Shibuya, Tokyo",
                AddressMatchConfidence.Medium,
                true
            )
            {
                PostalCodeMismatch = postalMismatch,
            },
        };
        var results = await new StayAddressResearch(
            venue,
            new VenueAddressLookup(
                new CandidateGeocoder(candidates),
                NullLogger<VenueAddressLookup>.Instance
            )
        ).FindAsync("Hotel", Destination, default);
        Assert.HasCount(2, results);
        if (postalMismatch)
        {
            Assert.IsTrue(
                results.All(result =>
                    result.Warning!.Contains("postcodes differ", StringComparison.Ordinal)
                )
            );
        }
        CollectionAssert.AreEqual(
            candidates.Select(candidate => candidate.FormattedAddress).ToArray(),
            results.Select(result => result.MapAddress).ToArray()
        );
        Assert.IsTrue(
            results.All(result => result.Warning is not null && result.Geometry is not null)
        );
        Assert.IsTrue(
            results.All(result =>
                result.Address == venue.Result[0].Address && result.Source == venue.Result[0].Source
            )
        );
    }

    private sealed class CandidateGeocoder(AddressLocationCandidate[] candidates) : AzureMapsStub
    {
        public override Task<IReadOnlyList<AddressLocationCandidate>> GeocodeAddressAsync(
            string address,
            string city,
            string countryCode,
            CancellationToken cancellationToken,
            GeoJsonPoint? center = null,
            StructuredAddress? structuredAddress = null
        ) => Task.FromResult<IReadOnlyList<AddressLocationCandidate>>(candidates);
    }

    private sealed class BatchPlaces : AzureMapsStub
    {
        private int active;
        private int calls;
        public int Calls => calls;
        public int MaxConcurrent { get; private set; }

        public override async Task<IReadOnlyList<AddressLocationCandidate>> GeocodeAddressAsync(
            string address,
            string city,
            string countryCode,
            CancellationToken cancellationToken,
            GeoJsonPoint? center = null,
            StructuredAddress? structuredAddress = null
        )
        {
            Interlocked.Increment(ref calls);
            int concurrent = Interlocked.Increment(ref active);
            MaxConcurrent = Math.Max(MaxConcurrent, concurrent);
            try
            {
                await Task.Delay(10, cancellationToken);
                if (address.StartsWith("1 ", StringComparison.Ordinal))
                {
                    throw new HttpRequestException("One result is unavailable");
                }
                return [new(Places.Point, address, AddressMatchConfidence.High, false)];
            }
            finally
            {
                Interlocked.Decrement(ref active);
            }
        }
    }

    private sealed class VenueResearch : IStayVenueSearch
    {
        public IReadOnlyList<ActivityVenue> Result { get; init; } =
        [
            new(
                "Hotel Mets Shibuya",
                "3-29-17 Shibuya, Tokyo",
                new("https://www.hotelmets.jp/en/shibuya/access.html", "Venue source")
            )
            {
                AddressComponents = new("3-29-17 Shibuya", "Shibuya", "Tokyo", "150-0002"),
            },
        ];
        public string? Query { get; private set; }
        public string? City { get; private set; }
        public string? Country { get; private set; }
        public IReadOnlyList<DestinationStay>? Stays { get; private set; }

        public Task<IReadOnlyList<ActivityVenue>> SearchAsync(
            string query,
            string city,
            string countryCode,
            IReadOnlyList<DestinationStay> stays,
            CancellationToken cancellationToken
        )
        {
            Query = query;
            City = city;
            Country = countryCode;
            Stays = stays;
            return Task.FromResult(Result);
        }
    }

    private sealed class Places(string outcome, CancellationTokenSource? cancel = null)
        : AzureMapsStub
    {
        public static readonly GeoJsonPoint Point = new(
            "Point",
            GeographyPoint.Create(35.655, 139.703)
        );
        public string? Address { get; private set; }
        public GeoJsonPoint? Center { get; private set; }
        public StructuredAddress? Components { get; private set; }

        public override Task<IReadOnlyList<AddressLocationCandidate>> GeocodeAddressAsync(
            string address,
            string city,
            string countryCode,
            CancellationToken cancellationToken,
            GeoJsonPoint? center = null,
            StructuredAddress? structuredAddress = null
        )
        {
            Address = address;
            Center = center;
            Components = structuredAddress;
            cancel?.Cancel();
            return outcome switch
            {
                "failure" => throw new HttpRequestException("Geocoder unavailable"),
                "timeout" => throw new OperationCanceledException(),
                "unknown" => Task.FromResult<IReadOnlyList<AddressLocationCandidate>>([]),
                _ => Task.FromResult<IReadOnlyList<AddressLocationCandidate>>([
                    new(Point, address, AddressMatchConfidence.High, false),
                ]),
            };
        }
    }
}
