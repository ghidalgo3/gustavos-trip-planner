using System.Text.Json;
using System.Text.Json.Nodes;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Tests;

[TestClass]
public sealed class FareValidatorTests
{
    private static readonly Guid UserId = Guid.NewGuid();
    private static readonly Guid PartyId = Guid.NewGuid();
    private static readonly Party Party = new(PartyId, Guid.NewGuid(), [UserId]);
    private static readonly FareValidator Validator = new(new AirportCatalog());
    private static readonly IgnavFareRequest Request = new(
        "BOS",
        "CDG",
        new(2030, 1, 5),
        new(2030, 1, 15),
        1,
        "economy",
        "US",
        null
    );

    private const string ResponseJson = """
        {"itineraries":[{"ignav_id":"fare-1","price":{"amount":350,"currency":"USD"},
        "outbound":{"duration_minutes":300,"segments":[
        {"departure_airport":"BOS","arrival_airport":"AMS","departure_time_local":"2030-01-05T08:00:00","arrival_time_local":"2030-01-05T10:00:00"},
        {"departure_airport":"AMS","arrival_airport":"CDG","departure_time_local":"2030-01-05T11:00:00","arrival_time_local":"2030-01-05T13:00:00"}]},
        "inbound":{"duration_minutes":360,"segments":[
        {"departure_airport":"CDG","arrival_airport":"BOS","departure_time_local":"2030-01-15T09:00:00","arrival_time_local":"2030-01-15T12:00:00"}]}}]}
        """;

    private static PlanningDocument Document(params PlanningConstraint[] constraints) =>
        new()
        {
            Destination = new("CDG", "Europe/Paris"),
            TravelDates = new(new(2030, 1, 5), new(2030, 1, 15)),
            Parties = [new() { PartyId = PartyId, Origin = new("BOS", "America/New_York") }],
            Constraints = constraints,
        };

    private static FareSearchResult Fare(JsonNode? response = null) =>
        new(
            PartyId,
            "cache",
            Request,
            JsonSerializer.SerializeToElement(response ?? JsonNode.Parse(ResponseJson)!),
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow.AddHours(1)
        );

    private static PlanningConstraint Requirement(string type) =>
        new()
        {
            Id = Guid.NewGuid(),
            UserId = UserId,
            Type = type,
        };

    [TestMethod]
    public void RequiredStay_UsesDestinationArrivalAndReturnDepartureLocalDates()
    {
        var stay = Requirement("presence") with
        {
            StartDate = new(2030, 1, 5),
            EndDate = new(2030, 1, 15),
        };
        Assert.AreEqual("Eligible", Validator.Evaluate(Fare(), Document(stay), Party)[0].Status);

        var late = JsonNode.Parse(ResponseJson)!;
        late["itineraries"]![0]!["outbound"]!["segments"]![1]!["arrival_time_local"] =
            "2030-01-06T01:00:00";
        var evaluation = Validator.Evaluate(Fare(late), Document(stay), Party)[0];
        Assert.AreEqual("Rejected", evaluation.Status);
        Assert.AreEqual("presence", evaluation.Issues.Single().Code);
        CollectionAssert.AreEqual(new[] { stay.Id }, evaluation.Issues.Single().ConstraintIds);

        var earlyReturn = JsonNode.Parse(ResponseJson)!;
        earlyReturn["itineraries"]![0]!["inbound"]!["segments"]![0]!["departure_time_local"] =
            "2030-01-14T23:30:00";
        evaluation = Validator.Evaluate(Fare(earlyReturn), Document(stay), Party)[0];
        Assert.AreEqual("Rejected", evaluation.Status);
        CollectionAssert.Contains(evaluation.Issues.Select(i => i.Code).ToArray(), "presence");
    }

    [TestMethod]
    public void MandatoryStopsDurationAndAirportExclusion_RejectMatchingFare()
    {
        var nonstop = Requirement("nonstop");
        var avoid = Requirement("avoidLayover") with { LocationType = "airport", Location = "AMS" };
        var document = Document(nonstop, avoid) with
        {
            Parties = [Document().Parties[0] with { MaxStops = 0, MaxJourneyHours = 4 }],
        };
        var evaluation = Validator.Evaluate(Fare(), document, Party)[0];
        Assert.AreEqual("Rejected", evaluation.Status);
        CollectionAssert.IsSubsetOf(
            new[] { "nonstop", "stops", "duration", "layover" },
            evaluation.Issues.Select(i => i.Code).ToArray()
        );
    }

    [TestMethod]
    [DataRow("city", "Amsterdam")]
    [DataRow("country", "NL")]
    [DataRow("region", "Northwest Europe")]
    public void GeographicLayoverExclusions_UseAirportCatalog(string locationType, string location)
    {
        var avoid = Requirement("avoidLayover") with
        {
            LocationType = locationType,
            Location = location,
            CountryCodes = locationType == "region" ? ["NL", "BE"] : [],
        };
        var evaluation = Validator.Evaluate(Fare(), Document(avoid), Party)[0];
        Assert.AreEqual("Rejected", evaluation.Status);
        Assert.AreEqual("layover", evaluation.Issues.Single().Code);
    }

    [TestMethod]
    public void MissingProviderData_RemainsUnverifiableAndConstraintEditsReevaluateCachedFare()
    {
        var fare = Fare();
        Assert.AreEqual("Eligible", Validator.Evaluate(fare, Document(), Party)[0].Status);
        Assert.AreEqual(
            "Rejected",
            Validator.Evaluate(fare, Document(Requirement("nonstop")), Party)[0].Status
        );

        var incomplete = JsonNode.Parse(ResponseJson)!;
        incomplete["itineraries"]![0]!.AsObject().Remove("inbound");
        var evaluation = Validator.Evaluate(Fare(incomplete), Document(), Party)[0];
        Assert.AreEqual("Unverifiable", evaluation.Status);
        Assert.AreEqual("missingData", evaluation.Issues.Single().Code);

        var unknownAirport = JsonNode.Parse(ResponseJson)!;
        unknownAirport["itineraries"]![0]!["outbound"]!["segments"]![0]!["arrival_airport"] = "ZZZ";
        unknownAirport["itineraries"]![0]!["outbound"]!["segments"]![1]!["departure_airport"] =
            "ZZZ";
        var avoidCity = Requirement("avoidLayover") with
        {
            LocationType = "city",
            Location = "Amsterdam",
        };
        evaluation = Validator.Evaluate(Fare(unknownAirport), Document(avoidCity), Party)[0];
        Assert.AreEqual("Unverifiable", evaluation.Status);
        StringAssert.Contains(evaluation.Issues.Single().Message, "not in the catalog");
    }
}
