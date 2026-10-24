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
using TripPlanner.Api.Services.Activities;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Services.Destinations;
using TripPlanner.Api.Services.Flights;
using TripPlanner.Api.Services.Maps;
using TripPlanner.Api.Services.TripForms;
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
builder.Services.AddSingleton<AirportCatalog>();
builder.Services.AddSingleton<DestinationService>();
builder.Services.AddTransient<IStayAddressResearch, StayAddressResearch>();
builder.Services.AddTransient<IActivityPlaceResearch, ActivityPlaceResearch>();
builder.Services.AddTransient<VenueAddressLookup>();
builder.Services.AddSingleton<DestinationFlightPlanning>();
builder.Services.AddHttpClient<ICityPlaceResolver, AzureCityPlaceResolver>();
builder.Services.AddHttpClient<AzureDestinationTimeZoneResolver>();
builder.Services.AddSingleton<IDestinationTimeZoneResolver, DestinationTimeZoneResolver>();
builder.Services.AddHttpClient<IActivityPlaceResolver, AzureActivityPlaceResolver>();
builder.Services.AddHttpClient<IAddressGeocoder, AzureAddressGeocoder>();
builder.Services.AddHttpClient<IActivityDetailsResearch, OpenAiActivityDetailsResearch>(client =>
    client.Timeout = TimeSpan.FromSeconds(30)
);
builder.Services.AddHttpClient<IActivityCoordinateResearch, OpenAiActivityCoordinateResearch>(
    client => client.Timeout = TimeSpan.FromSeconds(20)
);
builder.Services.AddHttpClient<IActivityAssistant, OpenAiActivityAssistant>(client =>
    client.Timeout = TimeSpan.FromSeconds(120)
);
builder.Services.AddHttpClient<IActivityVenueSearch, OpenAiActivityVenueResearch>(client =>
    client.Timeout = TimeSpan.FromSeconds(20)
);
builder.Services.AddHttpClient<IStayVenueSearch, OpenAiActivityVenueResearch>(client =>
    client.Timeout = TimeSpan.FromSeconds(20)
);
builder.Services.AddHttpClient<IActivityVenueResearch, OpenAiActivityVenueResearch>(client =>
    client.Timeout = TimeSpan.FromSeconds(20)
);
builder.Services.Configure<OpenAiOptions>(
    builder.Configuration.GetSection(OpenAiOptions.SectionName)
);
builder.Services.AddHttpClient<ITripFormAssistant, OpenAiTripFormAssistant>(client =>
    client.Timeout = TimeSpan.FromSeconds(90)
);
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
    )
);

var app = builder.Build();
await app.Services.GetRequiredService<IDatabaseMigrator>().MigrateAsync();
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
api.MapFlightPlanningEndpoints();
api.MapSelectedFlightsEndpoints();
api.MapDestinationsEndpoints();
api.MapActivityEndpoints();
api.MapPartyEndpoints();
api.MapTripFormEndpoints();
api.MapOperationsEndpoints();
api.MapActivityPlanEndpoints();
app.MapActivityCalendarEndpoints(api);

app.MapFallbackToFile("index.html", SpaHosting.StaticFiles());
app.Run();

public partial class Program;
