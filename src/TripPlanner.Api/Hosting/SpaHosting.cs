using System.Text.RegularExpressions;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.FileProviders.Physical;

namespace TripPlanner.Api.Hosting;

public static partial class SpaHosting
{
    public static void UseSpaNavigation(this WebApplication app)
    {
        app.Use(
            async (context, next) =>
            {
                string[] parts = (context.Request.Path.Value ?? "").Trim('/').Split('/');
                bool sharedRoute =
                    parts.Length is 2 or 3
                    && parts[0] == "trips"
                    && Guid.TryParse(parts[1], out _)
                    && (parts.Length == 2 || parts[2] == "flights");
                if (
                    !sharedRoute
                    || !(
                        HttpMethods.IsGet(context.Request.Method)
                        || HttpMethods.IsHead(context.Request.Method)
                    )
                )
                {
                    await next(context);
                    return;
                }

                // The same URL has HTML and API representations; caches must distinguish them.
                context.Response.Headers.Append("Vary", "Accept");
                bool wantsHtml =
                    context
                        .Request.GetTypedHeaders()
                        .Accept?.Any(value =>
                            value.MediaType.Equals("text/html", StringComparison.OrdinalIgnoreCase)
                            && value.Quality.GetValueOrDefault(1) > 0
                        ) == true;
                if (!wantsHtml)
                {
                    await next(context);
                    return;
                }

                PathString originalPath = context.Request.Path;
                Endpoint? originalEndpoint = context.GetEndpoint();
                // Routing has already selected the API endpoint. Let static files handle HTML instead.
                context.SetEndpoint(null);
                context.Request.Path = "/index.html";
                try
                {
                    await next(context);
                }
                finally
                {
                    context.Request.Path = originalPath;
                    context.SetEndpoint(originalEndpoint);
                }
            }
        );
    }

    public static string? PreviewWebRoot(string? revision)
    {
        if (
            Environment.GetEnvironmentVariable("WEBSITE_SLOT_NAME") != "preview"
            || revision is null
            || !Regex.IsMatch(revision, "^[a-f0-9]{40}$")
        )
        {
            return null;
        }

        return $"/home/site/tripplanner-web/{revision}";
    }

    public static StaticFileOptions StaticFiles(
        IFileProvider? bundledFiles = null,
        string? previewRoot = null
    ) =>
        new()
        {
            FileProvider =
                previewRoot is not null && bundledFiles is not null
                    ? new CompositeFileProvider(new PreviewFiles(previewRoot), bundledFiles)
                    : bundledFiles,
            OnPrepareResponse = context =>
            {
                string path = context.Context.Request.Path.Value ?? "";
                context.Context.Response.Headers.CacheControl =
                    context.File.Name.Equals("index.html", StringComparison.OrdinalIgnoreCase)
                        ? "no-store"
                    : HashedAsset().IsMatch(path) ? "public, max-age=31536000, immutable"
                    : "no-cache";
            },
        };

    private sealed class PreviewFiles(string root) : IFileProvider
    {
        public IFileInfo GetFileInfo(string subpath)
        {
            string path = "/" + subpath.TrimStart('/');
            if (path == "/index.html" || OverlayAsset().IsMatch(path))
            {
                var file = new FileInfo(root + path);
                if (file.Exists)
                {
                    return new PhysicalFileInfo(file);
                }
            }

            return new NotFoundFileInfo(subpath);
        }

        public IDirectoryContents GetDirectoryContents(string subpath) =>
            NotFoundDirectoryContents.Singleton;

        public Microsoft.Extensions.Primitives.IChangeToken Watch(string filter) =>
            NullChangeToken.Singleton;
    }

    [GeneratedRegex(@"^/assets/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$")]
    private static partial Regex OverlayAsset();

    [GeneratedRegex(@"^/assets/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$")]
    private static partial Regex HashedAsset();
}
