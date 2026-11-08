using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Services.Documents;

namespace TripPlanner.Api.Endpoints;

// Supplies the same read representation/validator in focused GETs and in views.
public sealed class TripResourceFilter(
    IPlannerDb database,
    ICurrentUser currentUser,
    TripReader reader,
    TripResourceProjection projection,
    ITripDataSession sessions
) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext invocation,
        EndpointFilterDelegate next
    )
    {
        var context = invocation.HttpContext;
        var path = CanonicalPath(context.Request.Path.Value ?? "");
        if (
            !Guid.TryParse(
                context.Request.RouteValues.GetValueOrDefault("tripId")?.ToString(),
                out var tripId
            )
            || path.EndsWith("/document", StringComparison.Ordinal)
            || !(
                HttpMethods.IsGet(context.Request.Method)
                || HttpMethods.IsPut(context.Request.Method)
                || HttpMethods.IsDelete(context.Request.Method)
            )
        )
        {
            return await next(invocation);
        }
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
        if (
            context.Request.RouteValues.TryGetValue("userId", out var aliasUser)
            && (!Guid.TryParse(aliasUser?.ToString(), out var aliasId) || aliasId != user!.Id)
        )
        {
            return Results.StatusCode(403);
        }
        if (
            HttpMethods.IsGet(context.Request.Method)
            && (
                path.Contains("/activity-plan", StringComparison.Ordinal)
                || path.EndsWith("/activity-preferences", StringComparison.Ordinal)
            )
        )
        {
            return await next(invocation);
        }
        if (HttpMethods.IsGet(context.Request.Method))
        {
            var data = await reader.ReadAsync(user!.Id, tripId, context.RequestAborted);
            if (data is null)
            {
                return Results.NotFound();
            }
            var view = projection.Project(data);
            var key = path + context.Request.QueryString;
            if (!view.Resources.TryGetValue(key, out var resource))
            {
                return await next(invocation);
            }
            SetHeaders(context, resource);
            return resource.Status == 204
                ? Results.NoContent()
                : Results.Json(
                    resource.Data,
                    statusCode: resource.Status,
                    contentType: resource.ContentType
                );
        }
        // Match registered endpoint identities, not caller-controlled path text.
        // Versioned plan/activity handlers retain their own store preconditions.
        var writePath = WriteResourcePath(context, tripId);
        if (writePath is null)
        {
            return await next(invocation);
        }

        try
        {
            return await sessions.WriteAsync(
                tripId,
                async () =>
                {
                    var data = await reader.ReadAsync(user!.Id, tripId, context.RequestAborted);
                    if (data is null)
                    {
                        return Results.NotFound();
                    }
                    if (
                        !data.CanPlan
                        || (
                            RequiresOwner(path, tripId, context.Request.Method)
                            && data.Trip.OwnerUserId != user.Id
                        )
                    )
                    {
                        return await next(invocation);
                    }
                    var view = projection.Project(data);
                    string key = writePath;
                    if (!view.Resources.TryGetValue(key, out var resource))
                    {
                        if (
                            (
                                key.Contains("/members/", StringComparison.Ordinal)
                                || key.Contains("/travellers/", StringComparison.Ordinal)
                            )
                        )
                        {
                            resource = new(
                                key,
                                TripResourceProjection.ETag<object?>(null),
                                System.Text.Json.JsonSerializer.SerializeToElement<object?>(null)
                            );
                        }
                        else
                        {
                            return await next(invocation);
                        }
                    }
                    if (
                        context.Request.Headers.IfNoneMatch == "*"
                        && (
                            key.Contains("/members/", StringComparison.Ordinal)
                            || key.Contains("/travellers/", StringComparison.Ordinal)
                        )
                    )
                    {
                        if (resource.Data.ValueKind != System.Text.Json.JsonValueKind.Null)
                        {
                            return Results.Problem(
                                statusCode: 412,
                                title: "This traveller was already added. Refresh before changing their role."
                            );
                        }
                        return await next(invocation);
                    }
                    if (string.IsNullOrWhiteSpace(context.Request.Headers.IfMatch))
                    {
                        return Results.Problem(
                            statusCode: 428,
                            title: "Read the resource and supply its ETag in If-Match."
                        );
                    }
                    if (
                        !Microsoft.Net.Http.Headers.EntityTagHeaderValue.TryParseList(
                            context.Request.Headers.IfMatch.Select(value => value ?? "").ToArray(),
                            out var tags
                        )
                    )
                    {
                        return Results.BadRequest(
                            new { title = "If-Match must contain a quoted resource ETag." }
                        );
                    }
                    if (
                        tags is null
                        || !tags.Any(t => !t.IsWeak && t.Tag.ToString() == resource.Etag)
                    )
                    {
                        return Results.Problem(
                            statusCode: 412,
                            title: "This resource has changed. Refresh it before editing again.",
                            extensions: new Dictionary<string, object?>
                            {
                                ["code"] = "resource_changed",
                                ["resource"] = key,
                            }
                        );
                    }
                    return await next(invocation);
                },
                context.RequestAborted
            );
        }
        catch (Npgsql.PostgresException exception) when (exception.SqlState is "40001" or "40P01")
        {
            return Results.Problem(
                statusCode: 409,
                title: "The trip changed during this update. Refresh before retrying.",
                extensions: new Dictionary<string, object?> { ["code"] = "resource_changed" }
            );
        }
    }

    private static bool RequiresOwner(string path, Guid tripId, string method) =>
        (
            path.Contains("/members/", StringComparison.Ordinal)
            || path.Contains("/travellers/", StringComparison.Ordinal)
        )
        || HttpMethods.IsDelete(method) && path == $"/trips/{tripId:D}";

    private static string? WriteResourcePath(HttpContext context, Guid tripId)
    {
        var prefix = $"/trips/{tripId:D}";
        string Value(string name) =>
            Uri.EscapeDataString(context.Request.RouteValues[name]!.ToString()!);
        string GuidValue(string name) =>
            Guid.Parse(context.Request.RouteValues[name]!.ToString()!).ToString("D");
        var city = context.Request.RouteValues.ContainsKey("destinationCity")
            ? $"{prefix}/destinations/{Value("destinationCity")}"
            : null;
        return context
            .GetEndpoint()
            ?.Metadata.GetMetadata<Microsoft.AspNetCore.Routing.IEndpointNameMetadata>()
            ?.EndpointName switch
        {
            "ReplaceTrip" or "UpdateUserTrip" or "DeleteTrip" or "DeleteUserTrip" => prefix,
            "ReplaceTripDestination" or "DeleteTripDestination" => city,
            "ReplaceTripDestinationStay" or "DeleteTripDestinationStay" =>
                $"{city}/stays/{GuidValue("stayId")}",
            "SaveDestinationStayLocation" or "DeleteDestinationStayLocation" =>
                $"{city}/stays/{GuidValue("stayId")}/location",
            "SaveTripFlightConstraints" => $"{prefix}/flights/constraints",
            "SetFlightChoices" => $"{prefix}/flights/choices/{GuidValue("partyId")}",
            "SelectTripFlight" or "DeselectTripFlight" or "SetTripFlightPurchases" =>
                $"{prefix}/flights/{GuidValue("partyId")}",
            "AddPartyMember" or "RemovePartyMember" =>
                $"{prefix}/parties/{GuidValue("partyId")}/members/{GuidValue("memberId")}",
            "ReplaceTripTravel" => $"{prefix}/travel",
            "ReplaceTripTraveller" or "DeleteTripTraveller" =>
                $"{prefix}/travellers/{GuidValue("memberId")}",
            _ => null,
        };
    }

    public static string CanonicalPath(string path)
    {
        var parts = path.Trim('/').Split('/').ToList();
        if (
            parts.Count >= 4
            && parts[0].Equals("user", StringComparison.OrdinalIgnoreCase)
            && parts[2].Equals("trips", StringComparison.OrdinalIgnoreCase)
        )
        {
            parts.RemoveRange(0, 2);
        }

        for (int i = 0; i < parts.Count; i++)
        {
            if (Guid.TryParse(parts[i], out var id))
            {
                parts[i] = id.ToString("D");
            }
            else if (i > 0 && parts[i - 1] == "destinations")
            {
                parts[i] = Uri.EscapeDataString(Uri.UnescapeDataString(parts[i]));
            }
            else
            {
                parts[i] = parts[i].ToLowerInvariant();
            }
        }
        return "/" + string.Join('/', parts);
    }

    private static void SetHeaders(HttpContext context, TripResource resource)
    {
        context.Response.Headers.ETag = resource.Etag;
        context.Response.Headers.CacheControl = "private, no-cache";
        if (resource.ContextVersion is not null)
        {
            context.Response.Headers["Destination-Context"] = resource.ContextVersion;
            context.Response.Headers["Planning-Context"] = resource.ContextVersion;
        }
    }
}
