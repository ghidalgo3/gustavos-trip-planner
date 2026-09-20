using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Http.HttpResults;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services;

var builder = WebApplication.CreateBuilder(args);
string? googleClientId = builder.Configuration["Authentication:Google:ClientId"];
string? googleClientSecret = builder.Configuration["Authentication:Google:ClientSecret"];
string? microsoftClientId = builder.Configuration["Authentication:Microsoft:ClientId"];
string? microsoftClientSecret = builder.Configuration["Authentication:Microsoft:ClientSecret"];
bool localAuthenticationEnabled =
    builder.Environment.IsDevelopment()
    && !string.IsNullOrWhiteSpace(googleClientId)
    && !string.IsNullOrWhiteSpace(googleClientSecret)
    && !string.IsNullOrWhiteSpace(microsoftClientId)
    && !string.IsNullOrWhiteSpace(microsoftClientSecret);

// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks();
builder.Services.AddSingleton<ITripStore, InMemoryTripStore>();
if (localAuthenticationEnabled)
{
    builder
        .Services.AddAuthentication(options =>
        {
            options.DefaultAuthenticateScheme = CookieAuthenticationDefaults.AuthenticationScheme;
            options.DefaultSignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        })
        .AddCookie(options =>
        {
            options.Cookie.Name = "tripplanner.local.auth";
            options.Cookie.HttpOnly = true;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        })
        .AddGoogle(
            "google",
            options =>
            {
                options.ClientId = googleClientId!;
                options.ClientSecret = googleClientSecret!;
                options.CallbackPath = "/.auth/callback/google";
                options.CorrelationCookie.SameSite = SameSiteMode.Lax;
                options.CorrelationCookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
                options.Events.OnCreatingTicket = context =>
                {
                    if (context.Principal?.Identity is ClaimsIdentity identity)
                    {
                        identity.AddClaim(new Claim("provider", "google"));
                    }

                    return Task.CompletedTask;
                };
            }
        )
        .AddOpenIdConnect(
            "aad",
            options =>
            {
                options.Authority =
                    "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0";
                options.ClientId = microsoftClientId!;
                options.ClientSecret = microsoftClientSecret!;
                options.CallbackPath = "/.auth/callback/microsoft";
                options.ResponseType = "code";
                options.ResponseMode = "query";
                options.CorrelationCookie.SameSite = SameSiteMode.Lax;
                options.CorrelationCookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
                options.NonceCookie.SameSite = SameSiteMode.Lax;
                options.NonceCookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
                options.Scope.Add("email");
                options.TokenValidationParameters.NameClaimType = "name";
                options.Events.OnTokenValidated = context =>
                {
                    if (context.Principal?.Identity is ClaimsIdentity identity)
                    {
                        identity.AddClaim(new Claim("provider", "aad"));
                    }

                    return Task.CompletedTask;
                };
            }
        );
}
builder.Services.AddCors(options =>
{
    string[] clientOrigins =
        builder.Configuration.GetSection("ClientOrigins").Get<string[]>()
        ?? ["http://localhost:5173"];

    options.AddDefaultPolicy(policy =>
        policy.WithOrigins(clientOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()
    );
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// No UseHttpsRedirection: in the container the app serves plain HTTP on 8080 and
// App Service terminates TLS in front of it (the Web App is created with httpsOnly).
app.UseCors();
if (localAuthenticationEnabled)
{
    app.UseAuthentication();

    app.MapGet(
        "/.auth/login/{provider}",
        IResult (string provider, string? post_login_redirect_uri) =>
        {
            string? scheme = provider switch
            {
                "google" => "google",
                "aad" => "aad",
                _ => null,
            };

            return scheme is null
                ? Results.NotFound()
                : Results.Challenge(
                    new AuthenticationProperties
                    {
                        RedirectUri = LocalRedirect(post_login_redirect_uri),
                    },
                    [scheme]
                );
        }
    );

    app.MapGet(
        "/.auth/logout",
        async (HttpContext context, string? post_logout_redirect_uri) =>
        {
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.Redirect(LocalRedirect(post_logout_redirect_uri));
        }
    );
}

// Probed by App Service (healthCheckPath) and by scripts/deploy/deploy.sh.
app.MapHealthChecks("/health");

var api = app.MapGroup("/api");

api.MapGet(
        "/",
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
        "/user",
        (HttpContext context) =>
        {
            ClientPrincipal? principal = ClientPrincipal.FromHeader(
                context.Request.Headers["X-MS-CLIENT-PRINCIPAL"].FirstOrDefault()
            );
            bool locallyAuthenticated =
                localAuthenticationEnabled && context.User.Identity?.IsAuthenticated == true;

            string? name = principal?.FindFirst(
                "name",
                "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"
            );
            string? email = principal?.FindFirst(
                "email",
                "emails",
                "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
            );
            string? provider = principal?.AuthType;

            if (principal is null && locallyAuthenticated)
            {
                name =
                    context.User.FindFirstValue(ClaimTypes.Name)
                    ?? context.User.FindFirstValue("name");
                email =
                    context.User.FindFirstValue(ClaimTypes.Email)
                    ?? context.User.FindFirstValue("email")
                    ?? context.User.FindFirstValue("preferred_username");
                provider = context.User.FindFirstValue("provider");
            }

            return Results.Ok(
                new
                {
                    isAuthenticated = principal is not null || locallyAuthenticated,
                    name,
                    email,
                    provider,
                }
            );
        }
    )
    .WithName("GetCurrentUser");

var trips = api.MapGroup("/trips").WithTags("Trips");

trips.MapGet("/", (ITripStore store) => store.GetAll()).WithName("ListTrips");

trips
    .MapGet(
        "/{id:guid}",
        Results<Ok<Trip>, NotFound> (Guid id, ITripStore store) =>
            store.Get(id) is { } trip ? TypedResults.Ok(trip) : TypedResults.NotFound()
    )
    .WithName("GetTrip");

trips
    .MapPost(
        "/",
        Results<Created<Trip>, ValidationProblem> (CreateTripRequest request, ITripStore store) =>
        {
            var errors = new Dictionary<string, string[]>();

            if (string.IsNullOrWhiteSpace(request.Destination))
            {
                errors[nameof(request.Destination)] = ["Destination is required."];
            }

            if (request.EndDate < request.StartDate)
            {
                errors[nameof(request.EndDate)] = ["EndDate must be on or after StartDate."];
            }

            if (errors.Count > 0)
            {
                return TypedResults.ValidationProblem(errors);
            }

            var trip = store.Add(request);
            return TypedResults.Created($"/api/trips/{trip.Id}", trip);
        }
    )
    .WithName("CreateTrip");

trips
    .MapDelete(
        "/{id:guid}",
        Results<NoContent, NotFound> (Guid id, ITripStore store) =>
            store.Delete(id) ? TypedResults.NoContent() : TypedResults.NotFound()
    )
    .WithName("DeleteTrip");

app.Run();

static string LocalRedirect(string? candidate)
{
    if (
        !string.IsNullOrWhiteSpace(candidate)
        && Uri.TryCreate(candidate, UriKind.Absolute, out Uri? uri)
        && uri.Scheme == Uri.UriSchemeHttp
        && uri.Host == "localhost"
        && uri.Port == 5173
    )
    {
        return uri.ToString();
    }

    if (
        !string.IsNullOrWhiteSpace(candidate)
        && candidate.StartsWith('/')
        && !candidate.StartsWith("//")
    )
    {
        return candidate;
    }

    return "http://localhost:5173/";
}

// Exposed so WebApplicationFactory<Program> in the test project can boot this app.
public partial class Program;
