using System.Net;
using System.Net.Http.Json;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Documents;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class HotelsEndpointTests
{
    [TestMethod]
    public async Task HotelsAreVersionedResourcesAndDeletingThemPreservesJourneys()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await TripDocumentFixture.Seed(factory, client);
        var trip = await factory.Database.CreateTripAsync(user.Id, "Hotels", "");
        var request = new HotelRequest(
            "Hotel",
            new("Point", GeographyPoint.Create(35, 139)),
            "Hotel address",
            "Asia/Tokyo"
        );
        using var created = await client.PostAsJsonAsync(
            $"/trips/{trip.Id}/hotels",
            request,
            TripResourceProjection.JsonOptions
        );
        Assert.AreEqual(HttpStatusCode.Created, created.StatusCode);
        var hotel = (
            await created.Content.ReadFromJsonAsync<Hotel>(TripResourceProjection.JsonOptions)
        )!;
        var path = created.Headers.Location!.ToString();
        Assert.AreEqual(
            (HttpStatusCode)428,
            (
                await client.PutAsJsonAsync(path, request, TripResourceProjection.JsonOptions)
            ).StatusCode
        );
        using var update = new HttpRequestMessage(HttpMethod.Put, path)
        {
            Content = JsonContent.Create(
                request with
                {
                    Name = "Hotel updated",
                },
                options: TripResourceProjection.JsonOptions
            ),
        };
        update.Headers.IfMatch.Add(created.Headers.ETag!);
        using var updated = await client.SendAsync(update);
        Assert.AreEqual(HttpStatusCode.OK, updated.StatusCode);
        using var journey = await client.PostAsJsonAsync(
            $"/trips/{trip.Id}/transportation",
            TransportationFixture.Journey(
                to: TransportationFixture.Reference("to", "hotel", hotel.Id)
            ),
            TripResourceProjection.JsonOptions
        );
        Assert.AreEqual(HttpStatusCode.Created, journey.StatusCode);
        using var delete = new HttpRequestMessage(HttpMethod.Delete, path);
        delete.Headers.IfMatch.Add(updated.Headers.ETag!);
        Assert.AreEqual(HttpStatusCode.NoContent, (await client.SendAsync(delete)).StatusCode);
        var retained = (await factory.Database.GetTransportationAsync(user.Id, trip.Id)).Single();
        var endpoint = retained.Features.Single(f => f.Id == "to");
        Assert.IsNull(endpoint.Properties.Reference);
        Assert.AreEqual("Hotel updated", endpoint.Properties.Name);
        Assert.IsNotNull(endpoint.Geometry);
    }
}
