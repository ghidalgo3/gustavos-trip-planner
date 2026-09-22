using TripPlanner.Api.Models;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Tests;

[TestClass]
public sealed class AirportCatalogTests
{
    private readonly AirportCatalog _catalog = new();

    [TestMethod]
    public void Search_HandlesCodesCitiesNamesAndAccents()
    {
        Assert.AreEqual("LHR", _catalog.Search("lhr")[0].Code);
        Assert.IsTrue(_catalog.Search("London").Any(a => a.Code == "LHR"));
        Assert.IsTrue(_catalog.Search("Heathrow").Any(a => a.Code == "LHR"));
        Assert.IsTrue(_catalog.Search("Sao Paulo").Any(a => a.Code == "GRU"));
        Assert.IsEmpty(_catalog.Search("x"));
        Assert.IsEmpty(_catalog.Search(new string('a', 101)));
        Assert.AreEqual("Europe/London", _catalog.Search("LHR")[0].Location.TimeZone);
    }

    [TestMethod]
    public void HomeAirport_UsesCoordinatesAndLeavesMixedHomeCitiesUnresolved()
    {
        var boston = new User(
            Guid.NewGuid(),
            "google",
            "a@example.com",
            "Ada",
            "Boston",
            new(-71.0589, 42.3601),
            default,
            default
        );
        Assert.AreEqual("BOS", _catalog.SuggestOrigin([boston])?.Code);
        Assert.AreEqual(
            "BOS",
            _catalog.SuggestOrigin([boston, boston with { Id = Guid.NewGuid() }])?.Code
        );
        Assert.IsNull(
            _catalog.SuggestOrigin([
                boston,
                boston with
                {
                    Id = Guid.NewGuid(),
                    HomeCityName = "London",
                    HomeCityLocation = new(-0.12, 51.50),
                },
            ])
        );
        Assert.IsNull(_catalog.SuggestOrigin([boston with { HomeCityLocation = null }]));
        Assert.IsNull(_catalog.SuggestOrigin([boston with { HomeCityLocation = new(0, 0) }]));
    }
}
