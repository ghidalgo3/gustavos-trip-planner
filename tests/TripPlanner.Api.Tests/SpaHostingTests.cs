using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace TripPlanner.Api.Tests;

[TestClass]
public class SpaHostingTests
{
    [TestMethod]
    [DataRow(true, "GET", "/mcp", HttpStatusCode.MethodNotAllowed)]
    [DataRow(true, "HEAD", "/mcp", HttpStatusCode.MethodNotAllowed)]
    [DataRow(true, "GET", "/mcp/", HttpStatusCode.MethodNotAllowed)]
    [DataRow(true, "DELETE", "/mcp", HttpStatusCode.MethodNotAllowed)]
    [DataRow(true, "PUT", "/mcp", HttpStatusCode.MethodNotAllowed)]
    [DataRow(true, "OPTIONS", "/mcp", HttpStatusCode.MethodNotAllowed)]
    [DataRow(true, "GET", "/mcp/unknown", HttpStatusCode.NotFound)]
    [DataRow(true, "HEAD", "/mcp/unknown", HttpStatusCode.NotFound)]
    [DataRow(true, "POST", "/mcp/unknown", HttpStatusCode.NotFound)]
    [DataRow(false, "GET", "/mcp", HttpStatusCode.NotFound)]
    [DataRow(false, "POST", "/mcp", HttpStatusCode.NotFound)]
    public async Task McpPathsNeverServeTheWebsite(
        bool mcpEnabled,
        string method,
        string path,
        HttpStatusCode expectedStatus
    )
    {
        string root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        Directory.CreateDirectory(root);
        try
        {
            const string entryPage = "<html>Published website</html>";
            await File.WriteAllTextAsync(Path.Combine(root, "index.html"), entryPage);
            using var baseFactory = new TestApplicationFactory { McpEnabled = mcpEnabled };
            using var factory = baseFactory.WithWebHostBuilder(builder => builder.UseWebRoot(root));
            using var client = factory.CreateClient(
                new WebApplicationFactoryClientOptions
                {
                    BaseAddress = new Uri("https://localhost"),
                    AllowAutoRedirect = false,
                }
            );
            using var request = new HttpRequestMessage(new HttpMethod(method), path);
            request.Headers.Accept.ParseAdd("text/html");
            using var response = await client.SendAsync(request);

            Assert.AreEqual(expectedStatus, response.StatusCode);
            Assert.AreNotEqual("text/html", response.Content.Headers.ContentType?.MediaType);
            Assert.AreNotEqual(entryPage, await response.Content.ReadAsStringAsync());
            if (expectedStatus == HttpStatusCode.MethodNotAllowed)
                CollectionAssert.AreEquivalent(
                    new[] { "POST" },
                    response.Content.Headers.Allow.ToArray()
                );
            // Keep the SPA fallback for real website routes outside the reserved MCP namespace.
            Assert.AreEqual(entryPage, await client.GetStringAsync("/mcp-status"));
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }

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
