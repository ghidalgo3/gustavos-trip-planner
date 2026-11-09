using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TripPlanner.Api.Database;
using TripPlanner.Api.Services.Destinations;
using TripPlanner.Api.Services.Flights;
using TripPlanner.Api.Services.Maps;
using TripPlanner.Api.Tests.Database;

namespace TripPlanner.Api.Tests.Support;

public sealed class TestApplicationFactory : WebApplicationFactory<Program>
{
    public InMemoryPlannerDb Database { get; } = new();
    public bool McpEnabled { get; set; }
    public bool UseNativeAuthentication { get; set; }
    public IIgnavClient? FlightClient { get; set; }
    public IAzureMapsClient? MapsClient { get; set; }
    public MapToken? MapTokenOverride { get; set; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("ApplicationInsights:ConnectionString", "");
        builder.UseSetting("Mcp:Enabled", McpEnabled.ToString());
        builder.UseSetting("Mcp:Issuer", "https://localhost/");
        if (UseNativeAuthentication)
        {
            builder.UseSetting("Mcp:NativeClients:0:ClientId", "tripplanner-mobile");
            builder.UseSetting("Mcp:NativeClients:0:DisplayName", "TripPlanner mobile");
            builder.UseSetting(
                "Mcp:NativeClients:0:RedirectUris:0",
                "com.example.tripplanner:/oauth/callback"
            );
        }
        builder.UseSetting("Planning:WorkerEnabled", "false");
        builder.UseSetting("ActivityPlanning:PublicBaseUrl", "https://localhost/");
        builder.UseSetting("ActivityPlanning:SolverSeconds", "3");
        builder.UseSetting(
            "ConnectionStrings:TripPlanner",
            "Host=localhost;Database=tripplanner_tests;Username=test;Password=test"
        );
        builder
            .UseSetting("Authentication:Google:ClientId", "google-client-id")
            .UseSetting("Authentication:Google:ClientSecret", "google-client-secret")
            .UseSetting("Authentication:Microsoft:ClientId", "microsoft-client-id")
            .UseSetting("Authentication:Microsoft:ClientSecret", "microsoft-client-secret");
        builder.ConfigureTestServices(services =>
        {
            if (FlightClient is not null)
            {
                services.AddSingleton(FlightClient);
            }
            services.RemoveAll<IDatabaseMigrator>();
            services.RemoveAll<IPlannerDb>();
            services.RemoveAll<ITripDataSession>();
            services.AddSingleton<ITripDataSession>(new TestTripDataSession(Database));
            services.RemoveAll<IActivityLogStore>();
            services.AddSingleton<IActivityLogStore>(new InMemoryActivityLogStore(Database));
            if (McpEnabled)
            {
                services.Configure<OpenIddict.EntityFrameworkCore.OpenIddictEntityFrameworkCoreOptions>(
                    options => options.DisableBulkOperations = true
                );
                services.RemoveAll<DbContextOptions<OAuthDbContext>>();
                services.RemoveAll<IDbContextOptionsConfiguration<OAuthDbContext>>();
                string oauthDatabase = Guid.NewGuid().ToString();
                services.AddDbContext<OAuthDbContext>(options =>
                    options.UseInMemoryDatabase(oauthDatabase).UseOpenIddict()
                );
            }
            services.RemoveAll<IMapTokenProvider>();
            services.RemoveAll<IAzureMapsClient>();
            services.AddSingleton<IAzureMapsClient>(MapsClient ?? new AzureMapsStub());
            services.AddSingleton<IDatabaseMigrator, NoOpDatabaseMigrator>();
            services.AddSingleton<IPlannerDb>(provider =>
                AuditedPlannerDb.Create(
                    Database,
                    provider.GetRequiredService<IActivityLogStore>(),
                    provider.GetRequiredService<IHttpContextAccessor>(),
                    provider.GetRequiredService<TimeProvider>()
                )
            );
            services.AddSingleton<IMapTokenProvider>(
                new TestMapTokenProvider(
                    MapTokenOverride
                        ?? new MapToken(
                            "test-map-token",
                            "https://atlas.example.test",
                            DateTimeOffset.Parse("2030-01-01T02:00:00Z")
                        )
                )
            );
            services
                .AddAuthentication()
                .AddScheme<AuthenticationSchemeOptions, TestAuthenticationHandler>(
                    "Test",
                    _ => { }
                );
            services.PostConfigure<AuthenticationOptions>(options =>
            {
                options.DefaultAuthenticateScheme = UseNativeAuthentication
                    ? "TripPlannerClient"
                    : "Test";
                options.DefaultChallengeScheme = UseNativeAuthentication
                    ? "TripPlannerClient"
                    : "Test";
            });
        });
    }

    private sealed class NoOpDatabaseMigrator : IDatabaseMigrator
    {
        public Task MigrateAsync(CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    private sealed class TestMapTokenProvider(MapToken token) : IMapTokenProvider
    {
        public Task<MapToken> GetTokenAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(token);
    }

    private sealed class TestAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder
    ) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            string? subject = Request.Headers["X-Test-Subject"].FirstOrDefault();
            if (string.IsNullOrWhiteSpace(subject))
            {
                return Task.FromResult(AuthenticateResult.NoResult());
            }

            string provider = Request.Headers["X-Test-Provider"].FirstOrDefault() ?? "google";
            var claims = new List<Claim>
            {
                new("provider", provider),
                new("sub", subject),
                new(ClaimTypes.NameIdentifier, subject),
            };
            AddOptionalClaim(claims, ClaimTypes.Name, Request.Headers["X-Test-Name"]);
            AddOptionalClaim(claims, ClaimTypes.Email, Request.Headers["X-Test-Email"]);

            var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name));
            var ticket = new AuthenticationTicket(principal, Scheme.Name);
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }

        private static void AddOptionalClaim(ICollection<Claim> claims, string type, string? value)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                claims.Add(new Claim(type, value));
            }
        }
    }
}
