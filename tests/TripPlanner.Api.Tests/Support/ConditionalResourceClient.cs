using System.Net.Http.Json;
using System.Text.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Endpoints;
using TripPlanner.Api.Services.Snapshots;

namespace TripPlanner.Api.Tests.Support;

// Existing behavior tests act as read-before-write clients. Protocol tests use
// ordinary SendAsync to explicitly exercise missing/stale preconditions.
public static class ConditionalResourceClient
{
    public static async Task<HttpResponseMessage> PutResourceAsJsonAsync<T>(
        this HttpClient client,
        string path,
        T value,
        JsonSerializerOptions? options = null
    )
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, path)
        {
            Content = JsonContent.Create(value, options: options),
        };
        await AddPrecondition(client, request);
        return await client.SendAsync(request);
    }

    public static async Task<HttpResponseMessage> PutResourceAsync(
        this HttpClient client,
        string path,
        HttpContent? content
    )
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, path) { Content = content };
        await AddPrecondition(client, request);
        return await client.SendAsync(request);
    }

    public static async Task<HttpResponseMessage> DeleteResourceAsync(
        this HttpClient client,
        string path
    )
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, path);
        await AddPrecondition(client, request);
        return await client.SendAsync(request);
    }

    private static async Task AddPrecondition(HttpClient client, HttpRequestMessage request)
    {
        string path = TripResourceFilter.CanonicalPath(request.RequestUri!.OriginalString);
        string[] parts = path.Split('/');
        if (
            parts.Length < 3
            || parts[1] != "trips"
            || !Guid.TryParse(parts[2], out var id)
            || path.Contains("/activity-plan")
            || path.EndsWith("/activity-preferences")
            || path.Contains("/activities/")
        )
        {
            return;
        }
        using var response = await client.GetAsync($"/trips/{id}/snapshot");
        if (!response.IsSuccessStatusCode)
        {
            return;
        }
        var snapshot = await response.Content.ReadFromJsonAsync<TripSnapshotResponse>(
            TripSnapshotProjection.JsonOptions
        );
        string key = path.EndsWith("/purchases") ? path[..^10] : path;
        if (snapshot!.Resources.TryGetValue(key, out var resource))
        {
            request.Headers.TryAddWithoutValidation("If-Match", resource.Etag);
        }
        else if (path.Contains("/members/"))
        {
            request.Headers.TryAddWithoutValidation(
                "If-Match",
                TripSnapshotProjection.ETag<object?>(null)
            );
        }
    }
}
