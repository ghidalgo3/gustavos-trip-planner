using Azure.Core;
using Azure.Identity;
using Microsoft.Extensions.Options;
using Npgsql;
using TripPlanner.Api.Database;
using TripPlanner.Api.Options;

namespace TripPlanner.Api.Database;

public static class PostgresServiceExtensions
{
    public static void AddPostgres(this WebApplicationBuilder builder)
    {
        builder.Services.Configure<DatabaseOptions>(options =>
        {
            builder.Configuration.GetSection(DatabaseOptions.SectionName).Bind(options);
            options.ConnectionString = builder.Configuration.GetConnectionString("TripPlanner");
        });
        DatabaseOptions options =
            builder.Configuration.GetSection(DatabaseOptions.SectionName).Get<DatabaseOptions>()
            ?? new();
        options.ConnectionString = builder.Configuration.GetConnectionString("TripPlanner");
        if (string.IsNullOrWhiteSpace(options.ConnectionString))
        {
            throw new InvalidOperationException(
                "ConnectionStrings:TripPlanner must contain a PostgreSQL connection string."
            );
        }

        builder.Services.AddSingleton<TimeProvider>(TimeProvider.System);
        builder.Services.AddSingleton<TokenCredential>(
            new ManagedIdentityCredential(new ManagedIdentityCredentialOptions())
        );
        builder.Services.AddSingleton(serviceProvider =>
        {
            DatabaseOptions database = serviceProvider
                .GetRequiredService<IOptions<DatabaseOptions>>()
                .Value;
            var dataSourceBuilder = new NpgsqlDataSourceBuilder(database.ConnectionString);
            dataSourceBuilder.ConnectionStringBuilder.SearchPath = "gustavo_planner,public";
            if (database.UseAzureManagedIdentity)
            {
                TokenCredential credential = serviceProvider.GetRequiredService<TokenCredential>();
                var tokenRequest = new TokenRequestContext([
                    "https://ossrdbms-aad.database.windows.net/.default",
                ]);
                dataSourceBuilder.UsePeriodicPasswordProvider(
                    async (_, cancellationToken) =>
                        (await credential.GetTokenAsync(tokenRequest, cancellationToken)).Token,
                    TimeSpan.FromMinutes(50),
                    TimeSpan.FromSeconds(5)
                );
            }

            return dataSourceBuilder.Build();
        });
        builder.Services.AddSingleton<IDatabaseMigrator, DatabaseMigrator>();
        builder.Services.AddSingleton<PostgresPlannerDb>();
        builder.Services.AddSingleton<IActivityLogStore, PostgresActivityLogStore>();
        builder.Services.AddSingleton<IPlannerDb>(services =>
            AuditedPlannerDb.Create(
                services.GetRequiredService<PostgresPlannerDb>(),
                services.GetRequiredService<IActivityLogStore>(),
                services.GetRequiredService<IHttpContextAccessor>(),
                services.GetRequiredService<TimeProvider>()
            )
        );
    }
}
