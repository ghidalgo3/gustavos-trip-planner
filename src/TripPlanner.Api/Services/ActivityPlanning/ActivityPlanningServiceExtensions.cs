using TripPlanner.Api.Options;

namespace TripPlanner.Api.Services.ActivityPlanning;

public static class ActivityPlanningServiceExtensions
{
    public static void AddActivityPlanning(this WebApplicationBuilder builder)
    {
        builder.Services.Configure<ActivityPlanningOptions>(
            builder.Configuration.GetSection(ActivityPlanningOptions.SectionName)
        );
        builder.Services.AddSingleton<ActivityFlightAvailability>();
        builder.Services.AddSingleton<ActivityPlanningService>();
        builder.Services.AddSingleton<IActivityPlanOptimizer, ActivityPlanOptimizer>();
        builder.Services.AddSingleton<ActivityPlanningProviders>();
        builder.Services.AddSingleton<IActivityRoutingProvider>(s =>
            s.GetRequiredService<ActivityPlanningProviders>()
        );
        builder.Services.AddSingleton<ActivityPlanningEnrichment>();
        builder.Services.AddSingleton<ActivityPlanningJobProcessor>();
        if (
            (
                builder.Configuration.GetSection(PlanningOptions.SectionName).Get<PlanningOptions>()
                ?? new()
            ).WorkerEnabled
        )
        {
            builder.Services.AddHostedService<ActivityPlanningWorker>();
        }
        // Bearer calendar URLs must never enter automatic request-path diagnostics.
        builder.Logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.None);
        builder.Logging.AddFilter(
            "Microsoft.AspNetCore.Routing.EndpointMiddleware",
            LogLevel.Warning
        );
    }
}
