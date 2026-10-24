using Azure.Core;
using Azure.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.Activities;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Services.Destinations;
using TripPlanner.Api.Services.Maps;

namespace TripPlanner.Api.Tests.Verification;

// Explicit smoke-test commands live in the test executable, never in API startup.
public static class VerificationProgram
{
    public static async Task<int> Main(string[] args)
    {
        if (args is ["--verify-solver"])
        {
            ActivitySolverVerification.Run();
            return 0;
        }
        bool verifyStay = args is ["--verify-stay-address"];
        if (!verifyStay && args is not ["--verify-planning-providers"])
        {
            Console.Error.WriteLine(
                "Use dotnet test, --verify-solver, --verify-planning-providers, or --verify-stay-address."
            );
            return 1;
        }

        var builder = Host.CreateApplicationBuilder();
        builder.Services.Configure<AzureMapsOptions>(
            builder.Configuration.GetSection(AzureMapsOptions.SectionName)
        );
        builder.Services.Configure<OpenAiOptions>(
            builder.Configuration.GetSection(OpenAiOptions.SectionName)
        );
        builder.Services.Configure<ActivityPlanningOptions>(
            builder.Configuration.GetSection(ActivityPlanningOptions.SectionName)
        );
        builder.Services.AddSingleton<TimeProvider>(TimeProvider.System);
        builder.Services.AddSingleton<TokenCredential>(
            new ManagedIdentityCredential(new ManagedIdentityCredentialOptions())
        );
        builder.Services.AddHttpClient();
        builder.Services.AddHttpClient<ActivityPlanningProviders>().RemoveAllLoggers();
        builder.Services.AddHttpClient<IAddressGeocoder, AzureAddressGeocoder>().RemoveAllLoggers();
        builder
            .Services.AddHttpClient<IStayVenueSearch, OpenAiActivityVenueResearch>(client =>
                client.Timeout = TimeSpan.FromSeconds(20)
            )
            .RemoveAllLoggers();
        builder.Services.AddTransient<IStayAddressResearch, StayAddressResearch>();
        builder.Services.AddSingleton<IMapTokenProvider>(services =>
            !string.IsNullOrWhiteSpace(
                services.GetRequiredService<IOptions<AzureMapsOptions>>().Value.SasToken
            )
                ? ActivatorUtilities.CreateInstance<ConfiguredMapTokenProvider>(services)
                : ActivatorUtilities.CreateInstance<AzureMapsSasTokenProvider>(services)
        );
        using var host = builder.Build();
        if (verifyStay)
        {
            return await StayAddressVerification.RunAsync(
                host.Services.GetRequiredService<IStayAddressResearch>()
            )
                ? 0
                : 1;
        }
        return await ActivityPlanningProviderVerification.RunAsync(
            host.Services.GetRequiredService<ActivityPlanningProviders>()
        )
            ? 0
            : 1;
    }
}
