using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TripPlanner.Api.Database;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Tests;

public sealed class TestApplicationFactory : WebApplicationFactory<Program>
{
    public InMemoryPlannerDb Database { get; } = new();
    public ITripFormAssistant? FormAssistant { get; set; }
    public IActivityAssistant? ActivityAssistant { get; set; }
    public ICityPlaceResolver? CityResolver { get; set; }
    public IActivityPlaceResolver? ActivityPlaceResolver { get; set; }
    public IActivityVenueResearch? ActivityVenueResearch { get; set; }
    public MapToken? MapTokenOverride { get; set; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Planning:WorkerEnabled", "false");
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
            services.RemoveAll<IDatabaseMigrator>();
            services.RemoveAll<IPlannerDb>();
            services.RemoveAll<IMapTokenProvider>();
            services.RemoveAll<ICityPlaceResolver>();
            services.RemoveAll<IActivityPlaceResolver>();
            services.RemoveAll<IActivityVenueResearch>();
            services.AddSingleton<IActivityVenueResearch>(
                ActivityVenueResearch ?? new NoVenueResearch()
            );
            services.AddSingleton<ICityPlaceResolver>(CityResolver ?? new TestCityPlaceResolver());
            services.AddSingleton<IActivityPlaceResolver>(
                ActivityPlaceResolver ?? new TestActivityPlaceResolver()
            );
            if (ActivityAssistant is not null)
            {
                services.RemoveAll<IActivityAssistant>();
                services.AddSingleton(ActivityAssistant);
            }
            if (FormAssistant is not null)
            {
                services.RemoveAll<ITripFormAssistant>();
                services.AddSingleton(FormAssistant);
            }
            services.AddSingleton<IDatabaseMigrator, NoOpDatabaseMigrator>();
            services.AddSingleton<IPlannerDb>(Database);
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
                options.DefaultAuthenticateScheme = "Test";
                options.DefaultChallengeScheme = "Test";
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

    private sealed class TestCityPlaceResolver : ICityPlaceResolver
    {
        public Task<TripPlanner.Api.Models.GeoJsonPoint?> ResolveAsync(
            string city,
            string countryCode,
            CancellationToken cancellationToken
        ) =>
            Task.FromResult<TripPlanner.Api.Models.GeoJsonPoint?>(
                new("Point", city == "Paris" ? [2.3522, 48.8566] : [12.4964, 41.9028])
            );
    }

    private sealed class NoVenueResearch : IActivityVenueResearch
    {
        public Task<ActivityVenue?> FindAsync(
            TripPlanner.Api.Models.ActivityCandidate activity,
            string city,
            string countryCode,
            IReadOnlyList<TripPlanner.Api.Models.DestinationStay> stays,
            CancellationToken cancellationToken,
            string userPrompt = ""
        ) => Task.FromResult<ActivityVenue?>(null);
    }

    private sealed class TestActivityPlaceResolver : IActivityPlaceResolver
    {
        public Task<TripPlanner.Api.Models.GeoJsonPoint?> ResolveAsync(
            string placeName,
            string city,
            string countryCode,
            CancellationToken cancellationToken,
            TripPlanner.Api.Models.GeoJsonPoint? center = null
        ) => Task.FromResult<TripPlanner.Api.Models.GeoJsonPoint?>(new("Point", [2.3364, 48.8606]));
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
