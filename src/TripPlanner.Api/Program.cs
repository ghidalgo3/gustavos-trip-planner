using System.Reflection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Options;
using Scalar.AspNetCore;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.Endpoints;
using TripPlanner.Api.Hosting;
using TripPlanner.Api.Mcp;
using TripPlanner.Api.Options;
using TripPlanner.Api.Serialization;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Services.Destinations;
using TripPlanner.Api.Services.Documents;
using TripPlanner.Api.Services.Flights;
using TripPlanner.Api.Services.Maps;
using TripPlanner.Api.Telemetry;
using TripPlanner.Api.Validation;

var builder = WebApplication.CreateBuilder(args);
builder.AddTripPlannerTelemetry();
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new IsoTimeOnlyConverter());
    options.SerializerOptions.Converters.Add(new IsoDurationConverter());
});
WebOptions webOptions = new()
{
    ClientOrigins =
        builder.Configuration.GetSection(WebOptions.ClientOriginsSectionName).Get<string[]>()
        ?? ["http://localhost:5173"],
};
builder.Services.AddOpenApi(options =>
    options.AddSchemaTransformer<InputOpenApiSchemaTransformer>()
);
builder.Services.AddHealthChecks();
builder.Services.AddHttpClient();
builder.Services.Configure<AzureMapsOptions>(
    builder.Configuration.GetSection(AzureMapsOptions.SectionName)
);
builder.Services.Configure<WebOptions>(options => options.ClientOrigins = webOptions.ClientOrigins);
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders =
        ForwardedHeaders.XForwardedFor
        | ForwardedHeaders.XForwardedHost
        | ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});
builder.AddPostgres();
builder.Services.AddScoped<TripReader>();
builder.Services.AddScoped<TripResourceProjection>();
builder.Services.AddSingleton<AirportCatalog>();
builder.Services.AddSingleton<DestinationService>();
builder.Services.AddSingleton<DestinationFlightPlanning>();
builder.Services.AddHttpClient<IAzureMapsClient, AzureMapsClient>();
builder.AddIgnav();
builder.AddActivityPlanning();
builder.Services.AddSingleton<IMapTokenProvider>(serviceProvider =>
{
    AzureMapsOptions maps = serviceProvider.GetRequiredService<IOptions<AzureMapsOptions>>().Value;
    return !string.IsNullOrWhiteSpace(maps.SasToken)
        ? ActivatorUtilities.CreateInstance<ConfiguredMapTokenProvider>(serviceProvider)
        : ActivatorUtilities.CreateInstance<AzureMapsSasTokenProvider>(serviceProvider);
});
bool authenticationEnabled = builder.AddTripPlannerAuthentication();
bool mcpEnabled = builder.AddTripPlannerMcp();
builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy =>
        policy
            .WithOrigins(webOptions.ClientOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials()
            .WithExposedHeaders(
                "ETag",
                "Planning-Context",
                "Destination-Context",
                "Location",
                "Retry-After",
                "Link",
                "WWW-Authenticate"
            )
    )
);

var app = builder.Build();
await app.Services.GetRequiredService<IDatabaseMigrator>().MigrateAsync();
var airportCatalog = app.Services.GetRequiredService<AirportCatalog>();
airportCatalog.Replace(
    (
        await app.Services.GetRequiredService<IPlannerDb>().RefreshAirportsAsync(airportCatalog.All)
    ).ToArray()
);
if (mcpEnabled)
{
    await app.InitializeMcpAsync();
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

// No UseHttpsRedirection: the container serves HTTP and App Service terminates TLS.
app.UseForwardedHeaders();
app.Use(
    async (context, next) =>
    {
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
        context.Response.Headers["X-Frame-Options"] = "DENY";
        await next();
    }
);
app.UseSpaNavigation();
app.UseDefaultFiles();
app.UseStaticFiles(SpaHosting.StaticFiles());
app.UseCors();
if (mcpEnabled)
{
    app.UseMcpSecurity();
}

app.UseAuthentication();
app.UseAuthorization();
if (mcpEnabled)
{
    app.MapOAuthEndpoints();
}

app.MapMcpEndpoints(mcpEnabled);

app.MapAuthenticationEndpoints(authenticationEnabled);
app.MapTelemetryEndpoints();
app.MapHealthChecks("/health");

var api = app.MapGroup("");
api.AddEndpointFilterFactory(ApiInputValidation.CreateFilter);
api.AddEndpointFilter<TripResourceFilter>();

// These routes remain here until a broader endpoint organization pattern emerges.
api.MapAirportsEndpoints();
api.MapGet(
        "/service",
        () =>
            Results.Ok(
                new
                {
                    name = "TripPlanner.Api",
                    version = Assembly.GetExecutingAssembly().GetName().Version?.ToString()
                        ?? "unknown",
                    environment = app.Environment.EnvironmentName,
                }
            )
    )
    .WithName("GetServiceInfo");
api.MapGet(
        "/mapToken",
        async (HttpContext context, IMapTokenProvider tokenProvider, TimeProvider clock) =>
        {
            MapToken token = await tokenProvider.GetTokenAsync(context.RequestAborted);
            context.Response.Headers.CacheControl = "no-store";
            if (token.ExpiresAt <= clock.GetUtcNow().AddMinutes(1))
            {
                return Results.Problem(
                    title: "Azure Maps token expired. Restart the local development server to renew it.",
                    statusCode: StatusCodes.Status503ServiceUnavailable
                );
            }

            return Results.Ok(
                new
                {
                    token = token.Token,
                    endpoint = token.Endpoint,
                    expiresAt = token.ExpiresAt,
                }
            );
        }
    )
    .WithName("GetMapToken")
    .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);

api.MapUserEndpoints();
api.MapActivityLogEndpoints();
api.MapMcpAccessEndpoints();
api.MapTripsEndpoints();
api.MapTripDocumentEndpoints();
api.MapTransportationEndpoints();
api.MapHotelsEndpoints();
api.MapFlightPlanningEndpoints();
api.MapSelectedFlightsEndpoints();
api.MapDestinationsEndpoints();
api.MapActivityEndpoints();
api.MapActivityKindEndpoints();
api.MapPartyEndpoints();
api.MapTravellersEndpoints();
api.MapOperationsEndpoints();
api.MapActivityPlanEndpoints();
api.MapActivityRouteEndpoints();
app.MapActivityCalendarEndpoints(api);

app.MapFallbackToFile("index.html", SpaHosting.StaticFiles());
app.Run();

public partial class Program;
