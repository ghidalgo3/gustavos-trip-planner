using System.Text.Json;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services;

// Durable image batches use the existing binary job payload and content hash.
// Original single-image jobs remain readable during deployment and retries.
public static class ActivityImagePayload
{
    public const string BatchMimeType = "application/vnd.tripplanner.image-batch+json";
    public const int MaxImages = 10;
    public const long MaxImageBytes = 10_000_000;
    public const long MaxTotalBytes = 25_000_000;

    public static (byte[] Data, string MimeType) Encode(IReadOnlyList<ActivityImage> images) =>
        images.Count == 1
            ? (images[0].Data, images[0].MimeType)
            : (
                JsonSerializer.SerializeToUtf8Bytes(images, JsonSerializerOptions.Web),
                BatchMimeType
            );

    public static IReadOnlyList<ActivityImage> Decode(byte[]? data, string? mimeType) =>
        data is null ? []
        : mimeType == BatchMimeType
            ? JsonSerializer.Deserialize<ActivityImage[]>(data, JsonSerializerOptions.Web)
                ?? throw new InvalidOperationException("The imported images could not be read.")
        : [new(mimeType ?? "application/octet-stream", data)];
}
