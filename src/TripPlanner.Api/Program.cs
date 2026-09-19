using System.Reflection;
using Microsoft.AspNetCore.Http.HttpResults;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks();
builder.Services.AddSingleton<ITripStore, InMemoryTripStore>();
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

            return Results.Ok(
                principal is null
                    ? new
                    {
                        isAuthenticated = false,
                        name = (string?)null,
                        email = (string?)null,
                        provider = (string?)null,
                    }
                    : new
                    {
                        isAuthenticated = true,
                        name = principal.FindFirst(
                            "name",
                            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"
                        ),
                        email = principal.FindFirst(
                            "email",
                            "emails",
                            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
                        ),
                        provider = principal.AuthType,
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

// Exposed so WebApplicationFactory<Program> in the test project can boot this app.
public partial class Program;
