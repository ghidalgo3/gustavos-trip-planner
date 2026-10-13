using System.Net;
using Microsoft.AspNetCore.Hosting;

namespace TripPlanner.Api.Tests;

[TestClass]
public class SpaHostingTests
{
    [TestMethod]
    [DataRow("/", "no-store")]
    [DataRow("/index.html", "no-store")]
    [DataRow("/trips/example/activities", "no-store")]
    [DataRow("/trips/00000000-0000-0000-0000-000000000001", "no-store")]
    [DataRow("/trips/00000000-0000-0000-0000-000000000001/flights", "no-store")]
    [DataRow("/assets/index-AbCd1234.js", "public, max-age=31536000, immutable")]
    [DataRow("/assets/index-AbCd1234.css", "public, max-age=31536000, immutable")]
    [DataRow("/assets/settings.js", "no-cache")]
    public async Task EntryPagesAndAssetsHaveExplicitCachePolicies(string path, string policy)
    {
        string root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        Directory.CreateDirectory(Path.Combine(root, "assets"));
        try
        {
            await File.WriteAllTextAsync(
                Path.Combine(root, "index.html"),
                "<html>Current build</html>"
            );
            foreach (
                string name in new[] { "index-AbCd1234.js", "index-AbCd1234.css", "settings.js" }
            )
                await File.WriteAllTextAsync(Path.Combine(root, "assets", name), "/* asset */");
            using var baseFactory = new TestApplicationFactory();
            using var factory = baseFactory.WithWebHostBuilder(builder => builder.UseWebRoot(root));
            using var client = factory.CreateClient();
            client.DefaultRequestHeaders.Accept.ParseAdd("text/html");
            using var response = await client.GetAsync(path);
            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            Assert.AreEqual(policy, response.Headers.CacheControl?.ToString());
            if (policy == "no-store")
                Assert.AreEqual(
                    "<html>Current build</html>",
                    await response.Content.ReadAsStringAsync()
                );
            if (path.Contains("00000000"))
            {
                Assert.AreEqual("text/html", response.Content.Headers.ContentType?.MediaType);
                CollectionAssert.Contains(response.Headers.Vary.ToArray(), "Accept");
                using var apiRequest = new HttpRequestMessage(HttpMethod.Get, path);
                apiRequest.Headers.Accept.ParseAdd("application/json");
                using var apiResponse = await client.SendAsync(apiRequest);
                Assert.AreNotEqual("text/html", apiResponse.Content.Headers.ContentType?.MediaType);
                Assert.AreNotEqual(
                    "<html>Current build</html>",
                    await apiResponse.Content.ReadAsStringAsync()
                );
                CollectionAssert.Contains(apiResponse.Headers.Vary.ToArray(), "Accept");
            }
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }
}
