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
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class TripImportExportTests
{
    [TestMethod]
    public async Task SnapshotImportRequiresAuthenticationButNotHomeCityAndUsesAuthenticatedOwner()
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
        var id = Guid.NewGuid();
        var snapshot = TripSnapshotFixture.Create(
            1,
            id,
            "Local trip",
            "",
            JsonSerializer.SerializeToElement(new { budget = 400 })
        );
        string url = $"/trips/{id}/snapshot";
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await client.PutAsJsonAsync(url, snapshot)).StatusCode
        );
        client.DefaultRequestHeaders.Add("X-Test-Subject", "subject-local@example.com");
        client.DefaultRequestHeaders.Add("X-Test-Provider", "google");
        client.DefaultRequestHeaders.Add("X-Test-Name", "Local traveler");
        client.DefaultRequestHeaders.Add("X-Test-Email", "local@example.com");
        var user = await client.GetFromJsonAsync<CurrentUserResponse>("/user");
        Assert.IsNotNull(user);
        var result = await client.PutAsJsonAsync(url, snapshot);
        Assert.AreEqual(HttpStatusCode.Created, result.StatusCode);
        var trip = await result.Content.ReadFromJsonAsync<TripResponse>();
        Assert.AreEqual(user.Id, trip!.OwnerUserId);
        Assert.AreEqual(id, trip.Id);
        Assert.AreEqual(id, imports.TransferId);
        Assert.AreEqual(url, result.Headers.Location?.ToString());
        Assert.IsNotNull(trip.Etag);
    }

    [TestMethod]
    [DataRow("visits")]
    [DataRow("activities")]
    [DataRow("reservations")]
    [DataRow("version")]
    [DataRow("identity")]
    [DataRow("origin")]
    [DataRow("extension")]
    public void UnsupportedSnapshotContentIsRejectedInsteadOfSilentlyLost(string change)
    {
        var id = Guid.NewGuid();
        var snapshot = TripSnapshotFixture.Create(
            1,
            id,
            "Trip",
            "",
            JsonSerializer.SerializeToElement(new { })
        );
        switch (change)
        {
            case "visits":
                snapshot.Itinerary["itemListElement"]!.AsArray().Add(new JsonObject());
                break;
            case "activities":
                snapshot.Plan["entries"]!.AsArray().Add(new JsonObject());
                break;
            case "reservations":
                snapshot = snapshot with { Reservations = [new JsonObject()] };
                break;
            case "version":
                snapshot = snapshot with { SchemaVersion = 2 };
                break;
            case "identity":
                id = Guid.NewGuid();
                break;
            case "origin":
                snapshot.TripOrigin["@id"] = "urn:uuid:missing";
                break;
            case "extension":
                snapshot.Extensions.Add("custom", JsonSerializer.SerializeToElement(new { }));
                break;
        }
        Assert.IsNotNull(TripImportExport.ValidateImport(id, snapshot));
    }

    [TestMethod]
    public void SharedSnapshotDtoRoundTripsSupportedImportDocument()
    {
        var id = Guid.NewGuid();
        var snapshot = TripSnapshotFixture.Create(
            1,
            id,
            "Trip",
            "",
            JsonSerializer.SerializeToElement(new { budget = 500 })
        );
        var json = JsonSerializer.Serialize(snapshot, JsonSerializerOptions.Web);
        var decoded = JsonSerializer.Deserialize<TripSnapshotResponse>(
            json,
            JsonSerializerOptions.Web
        )!;
        Assert.IsNull(TripImportExport.ValidateImport(id, decoded));
        Assert.AreEqual(500, decoded.Planning["trip"]!["constraints"]!["budget"]!.GetValue<int>());
    }

    private sealed class RecordingImports : ITripImportStore
    {
        public Guid TransferId { get; private set; }

        public Task<TripImportResult> ImportAsync(
            Guid ownerId,
            Guid transferId,
            TripSnapshotResponse request,
            CancellationToken cancellationToken
        )
        {
            TransferId = transferId;
            var trip = new Trip(
                Guid.Parse(request.Id["urn:uuid:".Length..]),
                ownerId,
                request.Name,
                request.Description,
                JsonSerializer.SerializeToElement(request.Planning["trip"]!["constraints"]),
                DateTimeOffset.UtcNow,
                DateTimeOffset.UtcNow
            );
            return Task.FromResult(new TripImportResult(201, trip));
        }

        public Task<TripImportResult> GetAsync(
            Guid ownerId,
            Guid transferId,
            CancellationToken cancellationToken
        ) => Task.FromResult(new TripImportResult(404));
    }
}
