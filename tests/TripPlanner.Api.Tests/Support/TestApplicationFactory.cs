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
using Microsoft.Spatial;
using TripPlanner.Api.Database;
using TripPlanner.Api.Services.Activities;
using TripPlanner.Api.Services.Destinations;
using TripPlanner.Api.Services.Flights;
using TripPlanner.Api.Services.Maps;
using TripPlanner.Api.Services.TripForms;
using TripPlanner.Api.Tests.Database;

namespace TripPlanner.Api.Tests.Support;

public sealed class TestApplicationFactory : WebApplicationFactory<Program>
{
    public InMemoryPlannerDb Database { get; } = new();
    public bool McpEnabled { get; set; }
    public IIgnavClient? FlightClient { get; set; }
    public ITripFormAssistant? FormAssistant { get; set; }
    public IActivityAssistant? ActivityAssistant { get; set; }
    public ICityPlaceResolver? CityResolver { get; set; }
    public IDestinationTimeZoneResolver? TimeZoneResolver { get; set; }
    public IActivityPlaceResolver? ActivityPlaceResolver { get; set; }
    public IActivityVenueResearch? ActivityVenueResearch { get; set; }
    public IStayVenueSearch? StayVenueSearch { get; set; }
    public IActivityDetailsResearch? ActivityDetailsResearch { get; set; }
    public IActivityCoordinateResearch? ActivityCoordinateResearch { get; set; }
    public MapToken? MapTokenOverride { get; set; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("Mcp:Enabled", McpEnabled.ToString());
        builder.UseSetting("Mcp:Issuer", "https://localhost/");
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
            services.RemoveAll<ICityPlaceResolver>();
            services.RemoveAll<IDestinationTimeZoneResolver>();
            services.AddSingleton<IDestinationTimeZoneResolver>(
                TimeZoneResolver ?? new TestDestinationTimeZoneResolver()
            );
            services.RemoveAll<IActivityPlaceResolver>();
            services.RemoveAll<IActivityDetailsResearch>();
            services.AddSingleton<IActivityDetailsResearch>(
                ActivityDetailsResearch ?? new NoDetailsResearch()
            );
            services.RemoveAll<IActivityCoordinateResearch>();
            services.AddSingleton<IActivityCoordinateResearch>(
                ActivityCoordinateResearch ?? new NoCoordinateResearch()
            );
            services.RemoveAll<IStayVenueSearch>();
            services.AddSingleton<IStayVenueSearch>(StayVenueSearch ?? new NoStayVenueSearch());
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
                new(
                    "Point",
                    city == "Paris"
                        ? GeographyPoint.Create(48.8566, 2.3522)
                        : GeographyPoint.Create(41.9028, 12.4964)
                )
            );
    }

    private sealed class TestDestinationTimeZoneResolver : IDestinationTimeZoneResolver
    {
        public Task<string?> ResolveAsync(
            GeographyPoint point,
            CancellationToken cancellationToken
        ) => Task.FromResult<string?>(point.Longitude < 5 ? "Europe/Paris" : "Europe/Rome");
    }

    private sealed class NoDetailsResearch : IActivityDetailsResearch
    {
        public Task<TripPlanner.Api.DTO.ActivityDetailsSuggestion?> FindAsync(
            TripPlanner.Api.Models.Activity activity,
            TripPlanner.Api.Models.GeoJsonFeature<TripPlanner.Api.Models.DestinationProperties> destination,
            CancellationToken cancellationToken
        ) => Task.FromResult<TripPlanner.Api.DTO.ActivityDetailsSuggestion?>(null);
    }

    private sealed class NoCoordinateResearch : IActivityCoordinateResearch
    {
        public Task<TripPlanner.Api.Models.ActivityLocationSuggestion?> FindAsync(
            TripPlanner.Api.Models.ActivityCandidate activity,
            string city,
            TripPlanner.Api.Models.GeoJsonPoint center,
            CancellationToken cancellationToken
        ) => Task.FromResult<TripPlanner.Api.Models.ActivityLocationSuggestion?>(null);
    }

    private sealed class NoStayVenueSearch : IStayVenueSearch
    {
        public Task<IReadOnlyList<ActivityVenue>> SearchAsync(
            string query,
            string city,
            string countryCode,
            IReadOnlyList<TripPlanner.Api.Models.DestinationStay> stays,
            CancellationToken cancellationToken
        ) => Task.FromResult<IReadOnlyList<ActivityVenue>>([]);
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
        public Task<TripPlanner.Api.Models.GeoJsonPoint?> ResolveAddressAsync(
            string address,
            string city,
            string countryCode,
            CancellationToken cancellationToken,
            TripPlanner.Api.Models.GeoJsonPoint? center = null
        ) => ResolveAsync(address, city, countryCode, cancellationToken, center);

        public Task<TripPlanner.Api.Models.GeoJsonPoint?> ResolveAsync(
            string placeName,
            string city,
            string countryCode,
            CancellationToken cancellationToken,
            TripPlanner.Api.Models.GeoJsonPoint? center = null
        ) =>
            Task.FromResult<TripPlanner.Api.Models.GeoJsonPoint?>(
                new("Point", GeographyPoint.Create(latitude: 48.8606, longitude: 2.3364))
            );
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
