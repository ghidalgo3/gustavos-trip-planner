using System.Net;

namespace TripPlanner.Api.Tests;

[TestClass]
public class HealthEndpointTests
{
    private static TestApplicationFactory _factory = null!;

    [ClassInitialize]
    public static void ClassInitialize(TestContext context) =>
        _factory = new TestApplicationFactory();

    [ClassCleanup]
    public static void ClassCleanup() => _factory.Dispose();

    [TestMethod]
    public async Task Health_ReturnsHealthy()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual("Healthy", await response.Content.ReadAsStringAsync());
    }

    [TestMethod]
    public async Task Service_ReturnsServiceInfo()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync("/service");

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        StringAssert.Contains(await response.Content.ReadAsStringAsync(), "TripPlanner.Api");
    }

    [TestMethod]
    public async Task Scalar_RendersInteractiveApiReference()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync("/scalar");

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual("text/html", response.Content.Headers.ContentType?.MediaType);
        StringAssert.Contains(await response.Content.ReadAsStringAsync(), "scalar");
    }
}
