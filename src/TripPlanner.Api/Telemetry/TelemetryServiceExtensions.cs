using Azure.Monitor.OpenTelemetry.Exporter;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using TripPlanner.Api.Options;

namespace TripPlanner.Api.Telemetry;

public static class TelemetryServiceExtensions
{
    public static void AddTripPlannerTelemetry(this WebApplicationBuilder builder)
    {
        var section = builder.Configuration.GetSection(ApplicationInsightsOptions.SectionName);
        builder
            .Services.AddOptions<ApplicationInsightsOptions>()
            .Bind(section)
            .ValidateDataAnnotations();
        // Export HTTP, MCP tool and job traces. Application logs, request/response bodies,
        // database statements and infrastructure metrics are deliberately excluded.
        var options = section.Get<ApplicationInsightsOptions>() ?? new();
        if (string.IsNullOrWhiteSpace(options.ConnectionString))
        {
            return;
        }
        builder
            .Services.AddOpenTelemetry()
            .ConfigureResource(resource => resource.AddService("TripPlanner.Api"))
            .WithTracing(tracing =>
                tracing
                    .SetSampler(new ParentBasedSampler(new AlwaysOnSampler()))
                    .AddSource(OperationTelemetry.SourceName)
                    .AddAspNetCoreInstrumentation(instrumentation =>
                    {
                        instrumentation.Filter = context =>
                            IsApplicationRequest(context.Request.Path);
                        instrumentation.RecordException = false;
                    })
                    .AddHttpClientInstrumentation(instrumentation =>
                    {
                        instrumentation.FilterHttpRequestMessage = _ =>
                            System.Diagnostics.Activity.Current?.Parent
                                is { IsAllDataRequested: true };
                        instrumentation.RecordException = false;
                    })
                    .AddProcessor(new SanitizeHttpTelemetryProcessor())
                    .AddAzureMonitorTraceExporter(exporter =>
                    {
                        exporter.ConnectionString = options.ConnectionString;
                        exporter.SamplingRatio = 1.0F;
                        exporter.DisableOfflineStorage = true;
                    })
            );
    }

    public static bool IsApplicationRequest(PathString path) =>
        (path.StartsWithSegments("/user") && path != "/user/avatar")
        || path.StartsWithSegments("/users")
        || path.StartsWithSegments("/trips")
        || path.StartsWithSegments("/operations")
        || path.StartsWithSegments("/airports")
        || path == "/service"
        || path.StartsWithSegments("/mcp");
}
