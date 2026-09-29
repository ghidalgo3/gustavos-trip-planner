using Microsoft.Extensions.Options;
using TripPlanner.Api.Options;

namespace TripPlanner.Api.Services;

public static class IgnavServiceExtensions
{
    public static void AddIgnav(this WebApplicationBuilder builder)
    {
        builder.Services.Configure<IgnavOptions>(
            builder.Configuration.GetSection(IgnavOptions.SectionName)
        );
        builder.Services.Configure<PlanningOptions>(
            builder.Configuration.GetSection(PlanningOptions.SectionName)
        );
        PlanningOptions planning =
            builder.Configuration.GetSection(PlanningOptions.SectionName).Get<PlanningOptions>()
            ?? new();

        builder.Services.AddSingleton<ISearchPlanBuilder, SearchPlanBuilder>();
        builder.Services.AddSingleton<FareValidator>();
        builder.Services.AddSingleton<RouteFareComposer>();
        builder
            .Services.AddHttpClient(
                "Ignav",
                client =>
                {
                    client.Timeout = Timeout.InfiniteTimeSpan;
                    client.MaxResponseContentBufferSize = 32 * 1024 * 1024;
                }
            )
            .RedactLoggedHeaders(["X-Api-Key"]);
        builder.Services.AddSingleton<IIgnavClient>(services => new IgnavClient(
            services.GetRequiredService<IHttpClientFactory>().CreateClient("Ignav"),
            services.GetRequiredService<IOptions<IgnavOptions>>(),
            services.GetRequiredService<ILogger<IgnavClient>>()
        ));
        builder.Services.AddSingleton<TripFormJobProcessor>();
        if (planning.WorkerEnabled)
            builder.Services.AddHostedService<PlanningWorker>();
    }
}
