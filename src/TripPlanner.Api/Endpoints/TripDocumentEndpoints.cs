using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Services.Documents;

namespace TripPlanner.Api.Endpoints;

public static class TripDocumentEndpoints
{
    public static void MapTripDocumentEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet(
            "/schemas/trip-document-v1.json",
            () =>
                Results.Stream(
                    typeof(TripDocumentEndpoints).Assembly.GetManifestResourceStream(
                        "TripPlanner.Api.Schemas.TripDocumentV1.json"
                    )!,
                    "application/schema+json"
                )
        );
        // These resources previously had only write routes. Native callers can read
        // their representations and validators without downloading the complete trip document.
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
        api.MapGet("/trips/{tripId:guid}/document", GetDocument)
            .WithName("GetTripDocument")
            .WithTags("Trips")
            .Produces<TripDocument>()
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        api.MapPut("/trips/{tripId:guid}/document", ImportDocument)
            .WithName("ImportTripDocument")
            .WithTags("Trips")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
    }

    internal static async Task<IResult> GetDocument(
        Guid tripId,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        TripReader reader,
        TripResourceProjection projection
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
                    title = "Consolidate the trip's travel parties before exporting its document.",
                }
            );
        }
        var document = projection.Project(data).Document;
        return await ExportAsync(context, document, "trip-document-v1", "application/json");
    }

    private static async Task<IResult> ImportDocument(
        Guid tripId,
        TripDocument document,
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
        var validation = ValidateImport(tripId, document);
        if (validation is not null)
        {
            return Results.BadRequest(new { title = validation });
        }
        // Import receipts make repeated submissions idempotent.
        // Imported ownership and synchronization metadata never grant permissions.
        var result = await imports.ImportAsync(user!.Id, tripId, document, context.RequestAborted);
        context.Response.Headers.CacheControl = "private, no-store";
        if (result.Trip is { } trip)
        {
            context.Response.Headers.Location = $"/trips/{trip.Id}/document";
            return Results.Json(TripResponse.From(trip, true), statusCode: result.Status);
        }
        return Results.Problem(
            statusCode: result.Status,
            title: result.Status == 410
                ? "This trip was imported and has since been deleted."
                : "This trip identity has already been used. No trip was overwritten."
        );
    }

    public static string? ValidateImport(Guid tripId, TripDocument document)
    {
        if (
            document.People is null
            || document.Places is null
            || document.Itinerary is null
            || document.Preferences is null
            || document.Id != tripId
            || tripId == Guid.Empty
            || document.SchemaVersion != 1
            || string.IsNullOrWhiteSpace(document.Name)
            || document.Name.Length > 200
            || document.Description is null
            || document.Description.Length > 4000
            || string.IsNullOrWhiteSpace(document.Revision)
            || document.Extensions.Count != 0
        )
        {
            return "The trip document identity, version, or metadata is invalid.";
        }
        // Server metadata never changes the portable content being imported.
        document = document with
        {
            People = document
                .People.Select(value => value is null ? null! : Content(value).AsObject())
                .ToArray(),
            Places = document
                .Places.Select(value => value is null ? null! : Content(value).AsObject())
                .ToArray(),
            Itinerary = Content(document.Itinerary).AsObject(),
            Preferences = Content(document.Preferences).AsObject(),
        };
        // Preserve the existing metadata-only import capability. Reject every richer
        // section rather than silently discarding destinations, fares, or settings.
        if (
            document.People.Length != 1
            || document.Places.Length != 1
            || document.People[0] is null
            || document.Places[0] is null
            || !JsonNode.DeepEquals(document.Itinerary, JsonNode.Parse("{\"items\":[]}"))
        )
        {
            return "Importing destinations, activities, or transportation is not supported yet. The trip was not imported.";
        }
        var homeId = TripResourceProjection.LocalId(tripId, "place", "home");
        if (
            document.OriginPlaceId != homeId
            || !JsonNode.DeepEquals(
                document.Places[0],
                new JsonObject
                {
                    ["id"] = homeId,
                    ["type"] = "Place",
                    ["name"] = "Home",
                    ["location"] = null,
                }
            )
            || document.People[0]["id"] is not JsonValue personId
            || !personId.TryGetValue<string>(out var person)
            || !Guid.TryParse(person, out _)
            || !JsonNode.DeepEquals(
                document.People[0],
                new JsonObject
                {
                    ["id"] = person,
                    ["name"] = "Me",
                    ["role"] = "Planner",
                    ["isOwner"] = true,
                    ["homeCityName"] = null,
                }
            )
        )
        {
            return "The document contains an unsupported participant or origin.";
        }
        var preferences = document.Preferences.DeepClone().AsObject();
        if (preferences["constraints"] is not JsonObject)
        {
            return "Trip constraints must be an object.";
        }
        preferences.Remove("constraints");
        return JsonNode.DeepEquals(
            preferences,
            JsonNode.Parse(
                "{\"activities\":{\"instructions\":\"\",\"defaults\":null},\"destinations\":[],\"groups\":[],\"flightChoices\":[]}"
            )
        )
            ? null
            : "The document contains planning settings that cannot yet be imported without data loss.";
    }

    private static JsonNode Content(JsonNode node)
    {
        if (node is JsonObject value)
        {
            return new JsonObject(
                value
                    .Where(property =>
                        property.Key
                            is not (
                                "etag"
                                or "contextVersion"
                                or "version"
                                or "canPlan"
                                or "activitiesEtag"
                                or "accommodationEtag"
                                or "connectionsEtag"
                                or "connectionsVersion"
                                or "flightPlanningEtag"
                                or "flightChoicesEtag"
                                or "bookingEtag"
                                or "memberEtags"
                            )
                    )
                    .Select(property => new KeyValuePair<string, JsonNode?>(
                        property.Key,
                        property.Value is null ? null : Content(property.Value)
                    ))
            );
        }
        if (node is JsonArray array)
        {
            return new JsonArray(
                array.Select(value => value is null ? null : Content(value)).ToArray()
            );
        }
        return node.DeepClone();
    }

    internal static async Task<IResult> ExportAsync(
        HttpContext context,
        object response,
        string schema,
        string contentType
    )
    {
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(
            response,
            TripResourceProjection.JsonOptions
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
            $"</schemas/{schema}.json>; rel=\"describedby\"; type=\"application/schema+json\"";
        if (cachedTags?.Any(t => t.Tag == "*" || t.Tag.ToString() == etag) == true)
        {
            return Results.StatusCode(StatusCodes.Status304NotModified);
        }
        return Results.Bytes(bytes, contentType);
    }

    private static IResult GetResource() => Results.NotFound();
}
