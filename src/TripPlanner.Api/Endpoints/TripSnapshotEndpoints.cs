using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Services.Snapshots;

namespace TripPlanner.Api.Endpoints;

public static class TripSnapshotEndpoints
{
    public static void MapTripSnapshotEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet(
                "/schemas/trip-snapshot-v1.json",
                () =>
                    Results.Stream(
                        typeof(TripSnapshotEndpoints).Assembly.GetManifestResourceStream(
                            "TripPlanner.Api.Schemas.TripSnapshotV1.json"
                        )!,
                        "application/schema+json"
                    )
            )
            .WithName("GetTripSnapshotSchema");
        api.MapGet("/trips/{tripId:guid}/snapshot", GetSnapshot)
            .WithName("GetTripSnapshot")
            .WithTags("Trips")
            .Produces<TripSnapshotResponse>(contentType: "application/ld+json")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        // These resources previously had only write routes. Native callers can read
        // their representations and validators without first obtaining a snapshot.
        api.MapGet(
                "/trips/{tripId:guid}/destinations/{destinationCity}/stays/{stayId:guid}",
                GetResource
            )
            .WithName("GetDestinationVisit")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        api.MapGet("/trips/{tripId:guid}/flights/choices/{partyId:guid}", GetResource)
            .WithName("GetPartyFlightChoices")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        api.MapGet("/trips/{tripId:guid}/flights/{partyId:guid}", GetResource)
            .WithName("GetPartySelectedFlights")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
    }

    internal static async Task<IResult> GetSnapshot(
        Guid tripId,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        TripSnapshotReader reader,
        TripSnapshotProjection projection
    )
    {
        var (user, error) = await EndpointAuthorization.AuthorizeCurrentUserAsync(
            context,
            database,
            currentUser.Profile!
        );
        if (error is not null)
        {
            return error;
        }
        var data = await reader.ReadAsync(user!.Id, tripId, context.RequestAborted);
        if (data is null)
        {
            return Results.NotFound();
        }
        if (data.Parties.Length > 1)
        {
            return Results.Conflict(
                new
                {
                    code = "multiple_parties_unsupported",
                    title = "This trip has multiple travel parties. Consolidate them before using the version 1 snapshot.",
                }
            );
        }
        var response = projection.Project(data);
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(
            response,
            TripSnapshotProjection.JsonOptions
        );
        IList<Microsoft.Net.Http.Headers.StringWithQualityHeaderValue>? encodings = null;
        if (
            !string.IsNullOrEmpty(context.Request.Headers.AcceptEncoding)
            && !Microsoft.Net.Http.Headers.StringWithQualityHeaderValue.TryParseList(
                context.Request.Headers.AcceptEncoding.Select(v => v ?? "").ToArray(),
                out encodings
            )
        )
        {
            return Results.BadRequest(new { title = "Accept-Encoding is malformed." });
        }
        double? Quality(string name) =>
            encodings
                ?.FirstOrDefault(e => e.Value.Equals(name, StringComparison.OrdinalIgnoreCase))
                ?.Quality.GetValueOrDefault(1);
        var wildcard = Quality("*");
        bool gzip = (Quality("gzip") ?? wildcard ?? 0) > 0;
        var identity = Quality("identity") ?? (wildcard == 0 ? 0 : 1);
        if (!gzip && identity == 0)
        {
            return Results.StatusCode(StatusCodes.Status406NotAcceptable);
        }
        IList<Microsoft.Net.Http.Headers.EntityTagHeaderValue>? cachedTags = null;
        if (
            !string.IsNullOrEmpty(context.Request.Headers.IfNoneMatch)
            && !Microsoft.Net.Http.Headers.EntityTagHeaderValue.TryParseList(
                context.Request.Headers.IfNoneMatch.Select(v => v ?? "").ToArray(),
                out cachedTags
            )
        )
        {
            return Results.BadRequest(new { title = "If-None-Match is malformed." });
        }
        if (gzip)
        {
            using var compressed = new MemoryStream();
            await using (
                var stream = new GZipStream(compressed, CompressionLevel.Fastest, leaveOpen: true)
            )
            {
                await stream.WriteAsync(bytes, context.RequestAborted);
            }
            bytes = compressed.ToArray();
            context.Response.Headers.ContentEncoding = "gzip";
        }
        string etag = $"\"{Convert.ToHexStringLower(SHA256.HashData(bytes))}\"";
        context.Response.Headers.ETag = etag;
        context.Response.Headers.CacheControl = "private, no-cache";
        context.Response.Headers.Vary = "Accept-Encoding";
        context.Response.Headers.Link =
            "</schemas/trip-snapshot-v1.json>; rel=\"describedby\"; type=\"application/schema+json\"";
        if (cachedTags?.Any(t => t.Tag == "*" || t.Tag.ToString() == etag) == true)
        {
            return Results.StatusCode(StatusCodes.Status304NotModified);
        }
        return Results.Bytes(bytes, "application/ld+json");
    }

    private static IResult GetResource() => Results.NotFound(); // Served by TripResourceFilter.
}
