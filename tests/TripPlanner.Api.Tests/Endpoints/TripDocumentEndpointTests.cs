using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Endpoints;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Documents;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class TripDocumentEndpointTests
{
    internal static string RepositoryFile(string path)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "AGENTS.md")))
        {
            directory = directory.Parent;
        }
        return Path.Combine(directory!.FullName, path);
    }

    [TestMethod]
    public void JapanExportHasCanonicalEntitiesAndOnlyValidatorMetadata()
    {
        var document = JsonSerializer.Deserialize<TripDocument>(
            File.ReadAllText(RepositoryFile("docs/after.json")),
            TripResourceProjection.JsonOptions
        )!;
        var json = JsonSerializer
            .SerializeToNode(document, TripResourceProjection.JsonOptions)!
            .AsObject();
        foreach (
            var removed in new[]
            {
                "@context",
                "@id",
                "travellers",
                "owner",
                "services",
                "flights",
                "reservations",
                "plan",
                "planning",
                "resources",
                "assessments",
            }
        )
        {
            Assert.IsFalse(json.ContainsKey(removed), removed);
        }
        Assert.HasCount(2, document.People);
        Assert.AreEqual(1, document.People.Count(p => p["isOwner"]!.GetValue<bool>()));
        Assert.HasCount(5, document.Itinerary["visits"]!.AsArray());
        Assert.AreEqual(
            5,
            document.Transportation["legs"]!
                .AsArray()
                .Count(l => l!["kind"]!.GetValue<string>() == "flight")
        );
        Assert.IsNotEmpty(document.Activities);
        var placeIds = document.Places.Select(p => p["id"]!.GetValue<string>()).ToHashSet();
        var itemIds = document
            .Activities.Select(a => a["id"]!.GetValue<string>())
            .Concat(
                document.Transportation["legs"]!.AsArray().Select(l => l!["id"]!.GetValue<string>())
            )
            .ToHashSet();
        foreach (var activity in document.Activities.Where(a => a["placeId"] is not null))
        {
            Assert.Contains(activity["placeId"]!.GetValue<string>(), placeIds);
        }
        foreach (var item in document.Itinerary["schedule"]!.AsArray())
        {
            Assert.Contains(item!["id"]!.GetValue<string>(), itemIds);
        }
        Assert.DoesNotContain("\"", document.Etag!);
        Assert.IsFalse(json.ContainsKey("sync"));
        foreach (var visit in document.Itinerary["visits"]!.AsArray())
        {
            Assert.DoesNotContain("\"", visit!["etag"]!.GetValue<string>());
            Assert.DoesNotContain("\"", visit["accommodationEtag"]!.GetValue<string>());
        }
        foreach (var activity in document.Activities)
        {
            Assert.DoesNotContain("\"", activity["etag"]!.GetValue<string>());
        }
    }

    [TestMethod]
    public async Task DocumentRequiresMembershipAndSupportsConditionalCompressedDownloads()
    {
        await using var factory = new TestApplicationFactory();
        using var owner = factory.CreateClient();
        var user = await TripDocumentFixture.Seed(factory, owner, "document-owner@example.com");
        var trip = await factory.Database.CreateTripAsync(user.Id, "Document", "");
        var url = $"/trips/{trip.Id}/document";
        using var anonymous = factory.CreateClient();
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(url)).StatusCode);
        using var first = await owner.GetAsync(url);
        Assert.AreEqual(
            HttpStatusCode.OK,
            first.StatusCode,
            await first.Content.ReadAsStringAsync()
        );
        Assert.AreEqual("application/json", first.Content.Headers.ContentType!.MediaType);
        Assert.IsTrue(first.Headers.CacheControl!.Private);
        using var conditional = new HttpRequestMessage(HttpMethod.Get, url);
        conditional.Headers.IfNoneMatch.Add(first.Headers.ETag!);
        Assert.AreEqual(
            HttpStatusCode.NotModified,
            (await owner.SendAsync(conditional)).StatusCode
        );
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.AcceptEncoding.ParseAdd("gzip");
        using var compressed = await owner.SendAsync(request);
        Assert.AreEqual("gzip", compressed.Content.Headers.ContentEncoding.Single());
        using var stream = new GZipStream(
            await compressed.Content.ReadAsStreamAsync(),
            CompressionMode.Decompress
        );
        using var reader = new StreamReader(stream);
        Assert.AreEqual(await first.Content.ReadAsStringAsync(), await reader.ReadToEndAsync());
        using var stranger = factory.CreateClient();
        await TripDocumentFixture.Seed(factory, stranger, "document-stranger@example.com");
        Assert.AreEqual(HttpStatusCode.NotFound, (await stranger.GetAsync(url)).StatusCode);
        var schema = await owner.GetFromJsonAsync<JsonElement>("/schemas/trip-document-v1.json");
        Assert.AreEqual("Trip document version 1", schema.GetProperty("title").GetString());
    }

    private static TripDocument LocalDocument(Guid id) =>
        new(
            id,
            "Local trip",
            "",
            "local:1",
            DateTimeOffset.Parse("2026-11-01T00:00:00Z"),
            DateTimeOffset.Parse("2026-11-01T00:00:00Z"),
            TripResourceProjection.LocalId(id, "place", "home"),
            [
                new JsonObject
                {
                    ["id"] = Guid.NewGuid().ToString(),
                    ["name"] = "Me",
                    ["role"] = "Planner",
                    ["isOwner"] = true,
                    ["homeCityName"] = null,
                },
            ],
            [
                new JsonObject
                {
                    ["id"] = TripResourceProjection.LocalId(id, "place", "home"),
                    ["type"] = "Place",
                    ["name"] = "Home",
                    ["location"] = null,
                },
            ],
            [],
            JsonNode.Parse("{\"legs\":[],\"journeys\":[],\"bookings\":[]}")!.AsObject(),
            JsonNode.Parse("{\"visits\":[],\"days\":[],\"schedule\":[]}")!.AsObject(),
            JsonNode
                .Parse(
                    "{\"constraints\":{\"budget\":500},\"activities\":{\"instructions\":\"\",\"defaults\":null},\"destinations\":[],\"groups\":[],\"flightChoices\":[]}"
                )!
                .AsObject()
        );

    [TestMethod]
    [DataRow("activities")]
    [DataRow("transportation")]
    [DataRow("itinerary")]
    [DataRow("settings")]
    [DataRow("unknown")]
    [DataRow("version")]
    [DataRow("participant")]
    public void ImportsRejectUnsupportedDataWithoutDiscardingIt(string change)
    {
        var document = LocalDocument(Guid.NewGuid());
        switch (change)
        {
            case "activities":
                document = document with { Activities = [new JsonObject()] };
                break;
            case "transportation":
                document.Transportation["legs"]!.AsArray().Add(new JsonObject());
                break;
            case "itinerary":
                document.Itinerary["visits"]!.AsArray().Add(new JsonObject());
                break;
            case "settings":
                document.Preferences["activities"]!["instructions"] = "Must preserve this";
                break;
            case "unknown":
                document.Extensions["custom"] = JsonSerializer.SerializeToElement(
                    "must not disappear"
                );
                break;
            case "version":
                document = document with { SchemaVersion = 2 };
                break;
            case "participant":
                document = document with { People = [null!] };
                break;
        }
        Assert.IsNotNull(TripDocumentEndpoints.ValidateImport(document.Id, document));
    }

    [TestMethod]
    public void MetadataImportIgnoresEntityValidatorsWithoutChangingContent()
    {
        var document = LocalDocument(Guid.NewGuid());
        document.People[0]["etag"] = "person-1";
        document.Preferences["activities"]!["etag"] = "preferences-1";
        document.Transportation["connectionsEtag"] = "connections-1";
        document.Transportation["connectionsVersion"] = 1;
        Assert.IsNull(TripDocumentEndpoints.ValidateImport(document.Id, document));
        Assert.IsNotNull(
            document.Preferences["activities"]!["etag"],
            "Validation must not mutate the input."
        );
    }

    [TestMethod]
    public async Task MetadataImportsUseAuthenticatedOwnershipAndRetainExistingPersistenceContract()
    {
        var imports = new RecordingImports();
        await using var factory = new TestApplicationFactory();
        await using var configured = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<ITripImportStore>();
                services.AddSingleton<ITripImportStore>(imports);
            })
        );
        using var client = configured.CreateClient();
        var actor = await TripDocumentFixture.Seed(factory, client, "document-import@example.com");
        var document = LocalDocument(Guid.NewGuid());
        Assert.IsNull(TripDocumentEndpoints.ValidateImport(document.Id, document));
        var url = $"/trips/{document.Id}/document";
        using var response = await client.PutAsJsonAsync(url, document);
        Assert.AreEqual(
            HttpStatusCode.Created,
            response.StatusCode,
            await response.Content.ReadAsStringAsync()
        );
        Assert.AreEqual(url, response.Headers.Location!.ToString());
        Assert.AreEqual(actor.Id, imports.OwnerId);
        Assert.AreEqual(document.Id, imports.TransferId);
        Assert.AreEqual(
            500,
            imports.Request!.Preferences["constraints"]!["budget"]!.GetValue<int>()
        );
        Assert.AreEqual(1, imports.Request.SchemaVersion);
    }

    [TestMethod]
    public async Task DocumentValidatorsSupportSmallWritesAndRejectStaleEdits()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var actor = await TripDocumentFixture.Seed(factory, client, "document-editor@example.com");
        var trip = await factory.Database.CreateTripAsync(actor.Id, "Original", "");
        var document = await client.GetFromJsonAsync<TripDocument>($"/trips/{trip.Id}/document");
        var version = document!.Etag!;
        async Task<HttpResponseMessage> Save(string name)
        {
            using var request = new HttpRequestMessage(HttpMethod.Put, $"/trips/{trip.Id}");
            request.Headers.TryAddWithoutValidation("If-Match", $"\"{version}\"");
            request.Content = JsonContent.Create(new UpdateTripRequest(name, ""));
            return await client.SendAsync(request);
        }
        Assert.IsTrue((await Save("Saved")).IsSuccessStatusCode);
        Assert.AreEqual(HttpStatusCode.PreconditionFailed, (await Save("Stale")).StatusCode);
        var refreshed = await client.GetFromJsonAsync<TripDocument>($"/trips/{trip.Id}/document");
        Assert.AreEqual("Saved", refreshed!.Name);
        Assert.AreNotEqual(version, refreshed.Etag!);
    }

    private sealed class RecordingImports : ITripImportStore
    {
        public Guid OwnerId { get; private set; }
        public Guid TransferId { get; private set; }
        public TripDocument? Request { get; private set; }

        public Task<TripImportResult> ImportAsync(
            Guid ownerId,
            Guid transferId,
            TripDocument request,
            CancellationToken token
        )
        {
            OwnerId = ownerId;
            TransferId = transferId;
            Request = request;
            return Task.FromResult(
                new TripImportResult(
                    201,
                    new Trip(
                        transferId,
                        ownerId,
                        request.Name,
                        request.Description,
                        JsonSerializer.SerializeToElement(request.Preferences["constraints"]),
                        DateTimeOffset.UtcNow,
                        DateTimeOffset.UtcNow
                    )
                )
            );
        }

        public Task<TripImportResult> GetAsync(
            Guid ownerId,
            Guid transferId,
            CancellationToken token
        ) => Task.FromResult(new TripImportResult(404));
    }
}
