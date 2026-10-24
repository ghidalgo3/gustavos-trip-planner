using System.Net;
using System.Net.Http.Json;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Flights;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Services.Flights;

[TestClass]
public class DestinationFlightPlanningTests
{
    [TestMethod]
    [DataRow(6, 0, true)]
    [DataRow(12, 0, true)]
    [DataRow(12, 1, false)]
    [DataRow(13, 0, false)]
    public void PastArrivalWindowIdentifiesTheDestination(
        int arrivalDay,
        int flexibility,
        bool expired
    )
    {
        var airports = new TripPlanner.Api.Services.Flights.AirportCatalog();
        var partyId = Guid.NewGuid();
        var visit = new PlannedVisit
        {
            Id = Guid.NewGuid(),
            Location = airports.Resolve("HND")! with { Label = "Tokyo" },
            PresentFrom = new(2026, 10, arrivalDay),
            PresentThrough = new(2026, 10, 20),
            ArrivalFlexibilityDays = flexibility,
            DepartureFlexibilityDays = 0,
        };
        var document = new PlanningDocument
        {
            Visits = [visit],
            Parties = [new() { PartyId = partyId, Origin = airports.Resolve("ATL") }],
        };
        var issues = new TripPlanner.Api.Services.Flights.MultiCityPlanner(
            airports,
            new FixedClock()
        ).Validate(document, [new Party(partyId, Guid.NewGuid(), [Guid.NewGuid()])], true);
        Assert.AreEqual(expired, issues.Any(issue => issue.Message.Contains("in the past")));
        if (expired)
        {
            var issue = issues.Single(item => item.Message.Contains("in the past"));
            StringAssert.Contains(issue.Message, "Tokyo");
            StringAssert.Contains(issue.Message, "Overview");
            CollectionAssert.Contains(issue.ConstraintIds, visit.Id);
        }
        else
        {
            Assert.IsEmpty(issues);
        }
    }

    private sealed class FixedClock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => DateTimeOffset.Parse("2026-10-13T04:00:00Z");
    }

    [TestMethod]
    [DataRow(0, true)]
    [DataRow(2, false)]
    public async Task SearchUsesCurrentDestinationStaysConstraintsAndOwnerHome(
        int flex,
        bool ordered
    )
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Subject", "destination-flights");
        client.DefaultRequestHeaders.Add("X-Test-Email", "planner@example.com");
        var profile = await client.PutAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Boston", -71.06, 42.36), [], "BOS")
        );
        profile.EnsureSuccessStatusCode();
        var owner = (await profile.Content.ReadFromJsonAsync<CurrentUserResponse>())!;
        var created = await client.PostAsJsonAsync(
            $"/user/{owner.Id}/trips",
            new CreateTripRequest("Destinations", "")
        );
        created.EnsureSuccessStatusCode();
        var trip = (await created.Content.ReadFromJsonAsync<Trip>())!;
        var collection = $"/trips/{trip.Id}/destinations";
        async Task<GeoJsonFeature<DestinationProperties>> Add(
            string name,
            string country,
            double longitude,
            double latitude,
            int start,
            int end
        )
        {
            var response = await client.PostAsJsonAsync(
                collection,
                new
                {
                    type = "Feature",
                    geometry = new GeoJsonPoint(
                        "Point",
                        GeographyPoint.Create(latitude: latitude, longitude: longitude)
                    ),
                    properties = new
                    {
                        name,
                        countryCode = country,
                        arrivalDate = $"2030-06-{start:00}",
                        departureDate = $"2030-06-{end:00}",
                        constraints = new
                        {
                            arrivalFlexibilityDays = flex,
                            departureFlexibilityDays = flex,
                            keepAfterPrevious = ordered,
                        },
                    },
                }
            );
            response.EnsureSuccessStatusCode();
            return (
                await response.Content.ReadFromJsonAsync<GeoJsonFeature<DestinationProperties>>()
            )!;
        }
        var paris = await Add("Paris", "FR", 2.35, 48.86, 10, 14);
        var tokyo = await Add("Tokyo", "JP", 139.69, 35.69, 14, 18);
        await Add("Paris", "FR", 2.35, 48.86, 18, 20);
        string constraintsUrl = $"/trips/{trip.Id}/flights/constraints";
        var document = (await client.GetFromJsonAsync<PlanningDocument>(constraintsUrl))!;
        Assert.HasCount(3, document.Visits);
        Assert.AreEqual(paris.Properties.Stays[0].Id, document.Visits[0].Id);
        Assert.AreEqual(tokyo.Properties.Stays[0].Id, document.Visits[1].Id);
        Assert.AreEqual(flex, document.Visits[0].ArrivalFlexibilityDays);
        Assert.AreEqual(flex, document.Visits[0].DepartureFlexibilityDays);
        CollectionAssert.AreEqual(
            ordered ? new[] { document.Visits[0].Id } : [],
            document.Visits[1].AfterVisitIds
        );
        Assert.IsTrue(document.Parties.Single().Origin!.AirportCodes.Contains("BOS"));
        Assert.IsTrue(document.Visits[0].Location!.AirportCodes.Contains("CDG"));
        Assert.IsNull(document.TravelDates);
        Assert.IsNull(document.Destination);
        var preview = new TripPlanner.Api.Services.Flights.MultiCityPlanner(
            new(),
            TimeProvider.System,
            200
        ).Build(document, factory.Database.Parties.ToArray(), default);
        Assert.IsTrue(
            preview.Ready,
            string.Join("; ", preview.Issues.Select(issue => issue.Message))
        );
        var returns = preview
            .Parties.Single()
            .Requests.Where(query =>
                query.Body.SearchKind == "oneWay" && query.Body.Destination == "BOS"
            )
            .ToArray();
        Assert.IsNotEmpty(returns);
        Assert.IsTrue(
            returns.All(query =>
                query.Body.DepartureDate >= new DateOnly(2030, 6, 20).AddDays(-flex)
                && query.Body.DepartureDate <= new DateOnly(2030, 6, 20).AddDays(flex)
            )
        );
        var dates = await client.PutAsJsonAsync(
            $"{collection}/{paris.Id}/stays/{document.Visits[0].Id}",
            new { arrivalDate = "2030-06-09", departureDate = "2030-06-13" }
        );
        dates.EnsureSuccessStatusCode();
        var updated = (await client.GetFromJsonAsync<PlanningDocument>(constraintsUrl))!;
        Assert.AreEqual(new DateOnly(2030, 6, 9), updated.Visits[0].PresentFrom);
        var search = await client.PostAsJsonAsync(
            $"/trips/{trip.Id}/flights:search",
            new StartFlightSearchRequest(Guid.NewGuid())
        );
        Assert.AreEqual(
            HttpStatusCode.Accepted,
            search.StatusCode,
            await search.Content.ReadAsStringAsync()
        );
    }

    [TestMethod]
    [DataRow(-1)]
    [DataRow(6)]
    public void PerDestinationFlexibilityIsBounded(int days)
    {
        var planner = new TripPlanner.Api.Services.Flights.MultiCityPlanner(
            new(),
            TimeProvider.System
        );
        var document = new PlanningDocument
        {
            Visits = [new() { Id = Guid.NewGuid(), ArrivalFlexibilityDays = days }],
        };
        Assert.IsTrue(
            planner
                .Validate(document, [], false)
                .Any(issue => issue.Message.Contains("flexibility"))
        );
    }
}
