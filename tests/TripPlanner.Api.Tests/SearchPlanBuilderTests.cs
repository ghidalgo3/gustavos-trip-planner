using System.Text.Json;
using Microsoft.Extensions.Options;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Tests;

[TestClass]
public class SearchPlanBuilderTests
{
    private static readonly Guid UserId = Guid.NewGuid();
    private static readonly Guid PartyId = Guid.NewGuid();
    private static Party[] Parties => [new(PartyId, Guid.NewGuid(), [UserId])];

    [TestMethod]
    public void Preview_CapsDistinctProviderPairsWithStableOrdering()
    {
        var document = Document() with
        {
            Constraints =
            [
                Window("departureWindow", new(2030, 1, 1), new(2030, 1, 9), new(2030, 1, 5)),
                Window("returnHomeWindow", new(2030, 1, 15), new(2030, 1, 23), new(2030, 1, 19)),
            ],
        };
        var result = Builder().Build(document, Parties);
        Assert.IsTrue(result.Ready);
        var party = result.Parties.Single();
        Assert.IsGreaterThan(20, party.EligibleDatePairs);
        Assert.HasCount(20, party.Requests);
        Assert.AreEqual(
            20,
            party.Requests.Select(r => (r.Body.DepartureDate, r.Body.ReturnDate)).Distinct().Count()
        );
        Assert.AreEqual(new DateOnly(2030, 1, 5), party.Requests[0].Body.DepartureDate);
        CollectionAssert.AreEqual(
            party.Requests.Select(r => r.CacheKey).ToArray(),
            Builder()
                .Build(document, Parties)
                .Parties.Single()
                .Requests.Select(r => r.CacheKey)
                .ToArray()
        );
        Assert.HasCount(3, Builder(3).Build(document, Parties).Parties.Single().Requests);
    }

    [TestMethod]
    public void ReturnFlightDate_MapsDirectlyToTheProviderReturnDate()
    {
        var result = Builder().Build(Document(), Parties);
        Assert.IsTrue(result.Ready);
        var requests = result.Parties.Single().Requests;
        CollectionAssert.AreEquivalent(
            new[] { new DateOnly(2030, 1, 15) },
            requests.Select(r => r.Body.ReturnDate).Distinct().ToArray()
        );
        StringAssert.Contains(string.Join(" ", result.Parties.Single().PendingChecks), "48 hours");
    }

    [TestMethod]
    public void CrossDateLine_PresenceUsesDestinationCalendarInsteadOfDepartureDate()
    {
        var document = Document();
        document = document with
        {
            Destination = new("LAX", "America/Los_Angeles"),
            Parties = [document.Parties[0] with { Origin = new("HND", "Asia/Tokyo") }],
            Constraints =
            [
                Window("departureWindow", new(2030, 1, 10), new(2030, 1, 10)),
                Window("returnHomeWindow", new(2030, 1, 15), new(2030, 1, 15)),
                new()
                {
                    Id = Guid.NewGuid(),
                    UserId = UserId,
                    Type = "presence",
                    StartDate = new(2030, 1, 9),
                    EndDate = new(2030, 1, 12),
                },
            ],
        };
        Assert.IsTrue(
            Builder().Build(document, Parties).Ready,
            "Leaving Tokyo Jan 10 can arrive in Los Angeles Jan 9; a calendar-only comparison would wrongly reject it."
        );
        var impossible = document with
        {
            Destination = new("HND", "Asia/Tokyo"),
            Parties = [document.Parties[0] with { Origin = new("LAX", "America/Los_Angeles") }],
        };
        Assert.IsFalse(Builder().Build(impossible, Parties).Ready);
    }

    [TestMethod]
    public void ReturnFlightDate_DoesNotProjectThroughDaylightSavingTime()
    {
        var document = Document() with
        {
            Constraints =
            [
                Window("departureWindow", new(2030, 3, 1), new(2030, 3, 1)),
                Window("returnHomeWindow", new(2030, 3, 10), new(2030, 3, 10)),
            ],
        };
        var result = Builder().Build(document, Parties);
        Assert.IsTrue(result.Ready);
        Assert.HasCount(1, result.Parties.Single().Requests);
        Assert.IsTrue(
            result
                .Parties.Single()
                .Requests.All(r => r.Body.ReturnDate == new DateOnly(2030, 3, 10))
        );
    }

    [TestMethod]
    public void DisjointMemberWindows_ReturnAnExplainedConflict()
    {
        Guid other = Guid.NewGuid();
        var document = Document();
        var additional = Window("departureWindow", new(2030, 1, 6), new(2030, 1, 6)) with
        {
            UserId = other,
        };
        document = document with { Constraints = [.. document.Constraints, additional] };
        var result = Builder().Build(document, [new(PartyId, Guid.NewGuid(), [UserId, other])]);
        Assert.IsFalse(result.Ready);
        var issue = result.Issues.Single();
        Assert.AreEqual("conflict", issue.Code);
        CollectionAssert.AreEquivalent(
            new[] { document.Constraints[0].Id, additional.Id },
            issue.ConstraintIds
        );
        Assert.IsEmpty(result.Parties);
    }

    [TestMethod]
    public void TravelTogether_DoesNotSilentlyReassignPartyMembership()
    {
        Guid other = Guid.NewGuid();
        Guid otherParty = Guid.NewGuid();
        var document = Document();
        document = document with
        {
            Parties = [.. document.Parties, document.Parties[0] with { PartyId = otherParty }],
            Constraints =
            [
                .. document.Constraints,
                document.Constraints[0] with
                {
                    Id = Guid.NewGuid(),
                    UserId = other,
                },
                document.Constraints[1] with
                {
                    Id = Guid.NewGuid(),
                    UserId = other,
                },
                new()
                {
                    Id = Guid.NewGuid(),
                    UserId = UserId,
                    Type = "travelTogether",
                    OtherUserId = other,
                },
            ],
        };
        var result = Builder()
            .Build(document, [.. Parties, new(otherParty, Guid.NewGuid(), [other])]);
        Assert.IsFalse(result.Ready);
        Assert.IsTrue(result.Issues.Any(i => i.Code == "membershipConflict"));
    }

    [TestMethod]
    public void PreferencesAndPendingChecks_DoNotChangeIdenticalProviderCacheKeys()
    {
        var document = Document();
        var baseline = Builder().Build(document, Parties).Parties.Single();
        var preferred = document with
        {
            Parties = [document.Parties[0] with { PreferredAirlines = ["DL"] }],
            Constraints =
            [
                .. document.Constraints,
                new()
                {
                    Id = Guid.NewGuid(),
                    UserId = UserId,
                    Type = "avoidLayover",
                    LocationType = "region",
                    Location = "Example region",
                    CountryCodes = ["AE", "QA"],
                },
            ],
        };
        var preview = Builder().Build(preferred, Parties).Parties.Single();
        CollectionAssert.AreEqual(
            baseline.Requests.Select(r => r.CacheKey).ToArray(),
            preview.Requests.Select(r => r.CacheKey).ToArray()
        );
        StringAssert.Contains(string.Join(" ", preview.PendingChecks), "AE, QA");
        Assert.DoesNotContain(
            "airlines_include",
            JsonSerializer.Serialize(preview.Requests[0].Body)
        );
        var nonstop = preferred with
        {
            Constraints =
            [
                .. preferred.Constraints,
                new()
                {
                    Id = Guid.NewGuid(),
                    UserId = UserId,
                    Type = "nonstop",
                },
            ],
        };
        var nonstopRequest = Builder().Build(nonstop, Parties).Parties.Single().Requests[0];
        Assert.AreEqual(0, nonstopRequest.Body.MaxStops);
        Assert.AreNotEqual(preview.Requests[0].CacheKey, nonstopRequest.CacheKey);
        Assert.AreNotEqual(
            nonstopRequest.CacheKey,
            SearchPlanBuilder.CacheKey(nonstopRequest.Body with { Adults = 2 })
        );
    }

    [TestMethod]
    public void MissingInputsAndUnresolvedRegions_BlockRequestsWithoutGuessing()
    {
        var empty = Builder().Build(new(), Parties);
        Assert.IsFalse(empty.Ready);
        Assert.IsEmpty(empty.Parties);
        Assert.IsTrue(
            empty.Issues.Any(issue =>
                issue.Message == "Choose destination from the airport suggestions."
            )
        );
        Assert.IsFalse(empty.Issues.Any(issue => issue.Message.Contains("time zone")));
        var document = Document();
        var region = new PlanningConstraint
        {
            Id = Guid.NewGuid(),
            UserId = UserId,
            Type = "avoidLayover",
            LocationType = "region",
            Location = "Middle East",
        };
        var result = Builder()
            .Build(document with { Constraints = [.. document.Constraints, region] }, Parties);
        Assert.IsFalse(result.Ready);
        Assert.IsTrue(result.Issues.Any(i => i.ConstraintIds.Contains(region.Id)));
        Assert.IsEmpty(
            Builder().Validate(new(), Parties, false),
            "Incomplete drafts can be saved."
        );
    }

    [TestMethod]
    public void PartyMaximumStops_IsSentToIgnavUnlessNonstopOverridesIt()
    {
        var capped = Document() with { Parties = [Document().Parties[0] with { MaxStops = 1 }] };
        Assert.AreEqual(
            1,
            Builder().Build(capped, Parties).Parties.Single().Requests[0].Body.MaxStops
        );

        var nonstop = capped with
        {
            Constraints =
            [
                .. capped.Constraints,
                new()
                {
                    Id = Guid.NewGuid(),
                    UserId = UserId,
                    Type = "nonstop",
                },
            ],
        };
        Assert.AreEqual(
            0,
            Builder().Build(nonstop, Parties).Parties.Single().Requests[0].Body.MaxStops
        );
        Assert.IsFalse(
            Builder()
                .Build(capped with { Parties = [capped.Parties[0] with { MaxStops = 3 }] }, Parties)
                .Ready
        );
    }

    [TestMethod]
    public void SelectedDates_WorkWithoutOptionalConstraints()
    {
        var document = Document() with
        {
            TravelDates = new(new(2030, 1, 5), new(2030, 1, 15)),
            UserTimeZone = "America/New_York",
            Constraints = [],
        };
        var result = Builder().Build(document, Parties);
        Assert.IsTrue(result.Ready);
        Assert.HasCount(1, result.Parties.Single().Requests);
        Assert.IsTrue(
            result
                .Parties.Single()
                .Requests.All(r =>
                    r.Body.DepartureDate == new DateOnly(2030, 1, 5)
                    && r.Body.ReturnDate == new DateOnly(2030, 1, 15)
                )
        );
        Assert.IsFalse(
            Builder()
                .Build(
                    document with
                    {
                        TravelDates = new(new(2030, 1, 15), new(2030, 1, 5)),
                    },
                    Parties
                )
                .Ready
        );
        Assert.IsFalse(
            Builder()
                .Build(document with { TravelDates = new(new(2030, 1, 5), null) }, Parties)
                .Ready
        );
        Assert.IsFalse(Builder().Build(document with { TravelDates = null }, Parties).Ready);
    }

    [TestMethod]
    public void OptionalWindows_AllowIndependentFlexibilityAroundSelectedDates()
    {
        var document = Document() with
        {
            TravelDates = new(new(2030, 1, 5), new(2030, 1, 15)),
            Constraints = [Window("departureWindow", new(2030, 1, 3), new(2030, 1, 7))],
        };
        var result = Builder().Build(document, Parties);
        Assert.IsTrue(result.Ready);
        var requests = result.Parties.Single().Requests;
        Assert.AreEqual(new DateOnly(2030, 1, 5), requests[0].Body.DepartureDate);
        Assert.IsTrue(requests.Any(r => r.Body.DepartureDate == new DateOnly(2030, 1, 3)));
        Assert.IsTrue(requests.All(r => r.Body.ReturnDate == new DateOnly(2030, 1, 15)));
    }

    private static SearchPlanBuilder Builder(int limit = 20) =>
        new(
            Microsoft.Extensions.Options.Options.Create(
                new PlanningOptions { DatePairLimit = limit }
            ),
            new FixedClock()
        );

    private sealed class FixedClock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(2029, 1, 1, 12, 0, 0, TimeSpan.Zero);
    }

    private static PlanningDocument Document() =>
        new()
        {
            Destination = new("CDG", "Europe/Paris"),
            Parties = [new() { PartyId = PartyId, Origin = new("BOS", "America/New_York") }],
            Constraints =
            [
                Window("departureWindow", new(2030, 1, 5), new(2030, 1, 5)),
                Window("returnHomeWindow", new(2030, 1, 15), new(2030, 1, 15)),
            ],
        };

    private static PlanningConstraint Window(
        string type,
        DateOnly start,
        DateOnly end,
        DateOnly? preferred = null
    ) =>
        new()
        {
            Id = Guid.NewGuid(),
            UserId = UserId,
            Type = type,
            Window = new(start, end, preferred),
        };
}
