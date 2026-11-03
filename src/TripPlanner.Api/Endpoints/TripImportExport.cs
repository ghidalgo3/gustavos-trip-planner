using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Services.Snapshots;

namespace TripPlanner.Api.Endpoints;

public static class TripImportExport
{
    public static void MapTripImportExport(this RouteGroupBuilder api)
    {
        api.MapPut("/trips/{tripId:guid}/snapshot", ImportSnapshot)
            .WithName("ImportTripSnapshot")
            .WithTags("Trips")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        api.MapGet(
                "/schemas/trip-snapshot-v1.json",
                () =>
                    Results.Stream(
                        typeof(TripImportExport).Assembly.GetManifestResourceStream(
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

    private static async Task<IResult> ImportSnapshot(
        Guid tripId,
        TripSnapshotResponse snapshot,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        ITripImportStore imports
    )
    {
        var (user, error) = await EndpointAuthorization.AuthorizeCurrentUserAsync(
            context,
            database,
            currentUser.Profile!,
            requireOnboarding: false
        );
        if (error is not null)
        {
            return error;
        }
        var validation = ValidateImport(tripId, snapshot);
        if (validation is not null)
        {
            return Results.BadRequest(new { title = validation });
        }
        // Trip identity is also the retry key; importing never overwrites an existing trip.
        // Owner, travellers, revisions, ETags and cached resources do not grant authority.
        var result = await imports.ImportAsync(user!.Id, tripId, snapshot, context.RequestAborted);
        context.Response.Headers.CacheControl = "private, no-store";
        if (result.Trip is { } trip)
        {
            context.Response.Headers.Location = $"/trips/{trip.Id}/snapshot";
            return Results.Json(TripResponse.From(trip, canPlan: true), statusCode: result.Status);
        }
        return Results.Problem(
            statusCode: result.Status,
            title: result.Status switch
            {
                409 => "This trip identity has already been used. No trip was overwritten.",
                410 => "This trip was imported and has since been deleted.",
                _ => "The trip could not be imported.",
            }
        );
    }

    public static string? ValidateImport(Guid tripId, TripSnapshotResponse snapshot)
    {
        if (snapshot.Extensions.Count != 0)
        {
            return "This snapshot contains unsupported extension fields. The trip was not imported.";
        }
        if (
            tripId == Guid.Empty
            || snapshot.Id != TripSnapshotProjection.Id(tripId)
            || snapshot.Type != "Trip"
            || snapshot.SchemaVersion != 1
            || string.IsNullOrWhiteSpace(snapshot.Name)
            || snapshot.Name.Length > 200
            || snapshot.Description is null
            || snapshot.Description.Length > 4000
        )
        {
            return "The snapshot identity, version, or trip metadata is invalid.";
        }
        if (
            snapshot.Itinerary["@type"]?.ToString() != "ItemList"
            || snapshot.Itinerary["itemListElement"] is not JsonArray visits
            || snapshot.Plan["@type"]?.ToString() != "Group"
            || snapshot.Plan["entries"] is not JsonArray entries
            || !Guid.TryParse(snapshot.Plan["uid"]?.ToString(), out _)
            || !DateTimeOffset.TryParse(snapshot.Plan["updated"]?.ToString(), out _)
            || snapshot.Plan["updated"]?.ToString().EndsWith('Z') != true
            || snapshot.Planning["trip"] is not JsonObject settings
            || settings["constraints"] is not JsonObject
            || snapshot.Planning["destinations"] is not JsonArray destinations
            || snapshot.Planning["days"] is not JsonArray days
            || snapshot.Planning["defaultsVersion"]?.ToString() != "1"
        )
        {
            return "The document must use the version 1 trip snapshot schema.";
        }
        // The current native feature set creates metadata-only trips. Fail closed until
        // relational mappings exist for every additional canonical entity being imported.
        if (
            visits.Count != 0
            || entries.Count != 0
            || destinations.Count != 0
            || days.Count != 0
            || snapshot.Services.Length != 0
            || snapshot.Flights.Length != 0
            || snapshot.Reservations.Length != 0
            || snapshot.People.Length != 1
            || snapshot.Travellers.Length != 1
            || snapshot.Places.Length != 1
        )
        {
            return "Importing destinations, activities, bookings, or additional travellers is not supported yet. The trip was not imported.";
        }
        var person = snapshot.People[0];
        var traveller = snapshot.Travellers[0];
        var home = snapshot.Places[0];
        if (
            person["@type"]?.ToString() != "Person"
            || person["@id"]?.ToString() is not { } personId
            || !Uri.IsWellFormedUriString(personId, UriKind.Absolute)
            || snapshot.Owner["@id"]?.ToString() != personId
            || traveller["person"] is not JsonObject travellerPerson
            || travellerPerson["@id"]?.ToString() != personId
            || traveller["role"]?.ToString() is not ("Planner" or "Traveller")
            || home["@type"]?.ToString() != "Place"
            || home["@id"]?.ToString() is not { } homeId
            || !Uri.IsWellFormedUriString(homeId, UriKind.Absolute)
            || snapshot.TripOrigin["@id"]?.ToString() != homeId
        )
        {
            return "The snapshot contains invalid owner or origin references.";
        }
        if (
            home["geo"] is not null
            || home["name"]?.ToString() != "Home"
            || settings.Any(p => p.Key != "constraints" && p.Value is not null)
            || home.Any(p => p.Key is not ("@id" or "@type" or "name"))
        )
        {
            return "This snapshot contains origin or planning settings that cannot yet be imported without data loss.";
        }
        return null;
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
            currentUser.Profile!,
            requireOnboarding: false
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
