using System.Reflection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Options;
using Scalar.AspNetCore;
using TripPlanner.Api.Database;
using TripPlanner.Api.Endpoints;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services;

var builder = WebApplication.CreateBuilder(args);
WebOptions webOptions = new()
{
    ClientOrigins =
        builder.Configuration.GetSection(WebOptions.ClientOriginsSectionName).Get<string[]>()
        ?? ["http://localhost:5173"],
};
builder.Services.AddOpenApi();
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
builder.Services.AddHttpClient<ICityPlaceResolver, AzureCityPlaceResolver>();
builder.Services.AddHttpClient<IActivityPlaceResolver, AzureActivityPlaceResolver>();
builder.Services.AddHttpClient<IActivityAssistant, OpenAiActivityAssistant>(client =>
    client.Timeout = TimeSpan.FromSeconds(120)
);
builder.Services.Configure<OpenAiOptions>(
    builder.Configuration.GetSection(OpenAiOptions.SectionName)
);
builder.Services.AddHttpClient<ITripFormAssistant, OpenAiTripFormAssistant>(client =>
    client.Timeout = TimeSpan.FromSeconds(90)
);
builder.AddIgnav();
builder.Services.AddSingleton<IMapTokenProvider>(serviceProvider =>
{
    AzureMapsOptions maps = serviceProvider.GetRequiredService<IOptions<AzureMapsOptions>>().Value;
    return !string.IsNullOrWhiteSpace(maps.SasToken)
        ? ActivatorUtilities.CreateInstance<ConfiguredMapTokenProvider>(serviceProvider)
        : ActivatorUtilities.CreateInstance<AzureMapsSasTokenProvider>(serviceProvider);
});
bool authenticationEnabled = builder.AddTripPlannerAuthentication();
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
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapAuthenticationEndpoints(authenticationEnabled);
app.MapHealthChecks("/health");

var api = app.MapGroup("");

// These routes remain here until a broader endpoint organization pattern emerges.
api.MapAirportsEndpoints();
api.MapGet("/airports", (string q, AirportCatalog airports) => Results.Ok(airports.Search(q)))
    .WithName("SearchAirports");
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
                return Results.Problem(
                    title: "Azure Maps token expired. Restart the local development server to renew it.",
                    statusCode: StatusCodes.Status503ServiceUnavailable
                );
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
api.MapTripsEndpoints();
api.MapSelectedFlightsEndpoints();
api.MapActivityEndpoints();
api.MapPartyEndpoints();
api.MapTripFormEndpoints();
api.MapOperationsEndpoints();

app.MapFallbackToFile("index.html");
app.Run();

public partial class Program;
