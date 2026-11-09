using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Instructions;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Documents;
using TripPlanner.Api.Services.Maps;
using TripPlanner.Api.Tests.Mcp;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Verification;

internal static class McpEvalServer
{
    internal sealed class Session(
        TestApplicationFactory factory,
        HttpClient agent,
        Guid userId,
        Guid tripId,
        string destinationCity = "paris-fr"
    ) : IAsyncDisposable
    {
        internal TestApplicationFactory Factory { get; } = factory;
        internal HttpClient Agent { get; } = agent;
        internal Guid UserId { get; } = userId;
        internal Guid TripId { get; } = tripId;
        internal string DestinationCity { get; } = destinationCity;

        public async ValueTask DisposeAsync()
        {
            Agent.Dispose();
            await Factory.DisposeAsync();
        }
    }

    internal static async Task<Session> CreateSession(string scenario)
    {
        if (
            scenario
            is not (
                "known_dates"
                or "missing_dates"
                or "preferences"
                or "event_unknown"
                or "save_activity"
            )
        )
        {
            throw new InvalidOperationException("Unknown harness scenario.");
        }
        var factory = new TestApplicationFactory { McpEnabled = true };
        try
        {
            using var browser = McpEndpointTests.CreateClient(factory);
            var user = await McpEndpointTests.SeedAndSetCookie(factory, browser);
            var (trip, _, place, _) = await ActivityPlanningFixture.SeedDatabase(
                factory.Database,
                user
            );
            if (scenario == "missing_dates")
            {
                var visit = (
                    await factory.Database.GetDestinationVisitsAsync(user.Id, trip.Id)
                ).Single();
                await factory.Database.ReplaceDestinationVisitAsync(
                    user.Id,
                    trip.Id,
                    place.CityId,
                    visit.StayId,
                    new(null, null)
                );
            }
            await factory.Database.SaveActivityPreferencesAsync(
                user.Id,
                null,
                "profile",
                "",
                new("I enjoy art and quiet afternoons. I prefer inexpensive meals."),
                0
            );
            await factory.Database.SaveActivityPreferencesAsync(
                user.Id,
                trip.Id,
                "trip",
                "",
                new("Focus on nature for this trip."),
                0
            );
            await factory.Database.SaveActivityPreferencesAsync(
                user.Id,
                trip.Id,
                "destination",
                place.CityId,
                new("For Paris, focus on music rather than nature."),
                0
            );
            return await Connect(factory, browser, user.Id, trip.Id, place.CityId);
        }
        catch
        {
            await factory.DisposeAsync();
            throw;
        }
    }

    internal static async Task<Session> CreateSession(
        TripDocument document,
        IAzureMapsClient? maps = null
    )
    {
        var factory = new TestApplicationFactory { McpEnabled = true, MapsClient = maps };
        try
        {
            using var browser = McpEndpointTests.CreateClient(factory);
            var user = await McpEndpointTests.SeedAndSetCookie(factory, browser);
            var trip = factory.Database.SeedEvalDocument(user, document);
            var visits = await factory.Database.GetDestinationVisitsAsync(user.Id, trip.Id);
            return await Connect(
                factory,
                browser,
                user.Id,
                trip.Id,
                visits.OrderBy(v => v.Order).First().CityId
            );
        }
        catch
        {
            await factory.DisposeAsync();
            throw;
        }
    }

    private static async Task<Session> Connect(
        TestApplicationFactory factory,
        HttpClient browser,
        Guid userId,
        Guid tripId,
        string city
    )
    {
        var token = await McpEndpointTests.Tokens(browser, "tripplanner.read tripplanner.write");
        var agent = McpEndpointTests.CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        return new(factory, agent, userId, tripId, city);
    }

    internal static async Task<object> State(Session session)
    {
        var places = await session.Factory.Database.GetDestinationPlacesAsync(
            session.UserId,
            session.TripId
        );
        var activities = new List<Activity>();
        foreach (var place in places)
        {
            activities.AddRange(
                await session.Factory.Database.GetActivitiesAsync(
                    session.UserId,
                    session.TripId,
                    place.CityId
                )
            );
        }
        return new
        {
            activities = activities.OrderBy(a => a.Id).ToArray(),
            visits = await session.Factory.Database.GetDestinationVisitsAsync(
                session.UserId,
                session.TripId
            ),
        };
    }

    public static async Task<int> Run(int port)
    {
        Directory.SetCurrentDirectory(AppContext.BaseDirectory);
        using var listener = new HttpListener();
        listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        listener.Start();
        var sessions = new Dictionary<string, Session>();
        try
        {
            while (listener.IsListening)
            {
                var request = await listener.GetContextAsync();
                try
                {
                    if (
                        request.Request.HttpMethod == "GET"
                        && request.Request.Url!.AbsolutePath == "/health"
                    )
                    {
                        await JsonSerializer.SerializeAsync(
                            request.Response.OutputStream,
                            new
                            {
                                status = "ready",
                                instance = Environment.GetEnvironmentVariable(
                                    "TRIPPLANNER_EVAL_INSTANCE"
                                ),
                                guidanceVersion = McpInstructions.Planning.Version,
                            }
                        );
                        continue;
                    }
                    using var body = await JsonDocument.ParseAsync(request.Request.InputStream);
                    object result;
                    switch (request.Request.Url!.AbsolutePath)
                    {
                        case "/start":
                            if (sessions.Count >= 32)
                            {
                                throw new InvalidOperationException(
                                    "Too many active eval sessions."
                                );
                            }
                            var session = body.RootElement.TryGetProperty(
                                "document",
                                out var document
                            )
                                ? await CreateSession(
                                    document.Deserialize<TripDocument>(
                                        TripResourceProjection.JsonOptions
                                    )!
                                )
                                : await CreateSession(
                                    body.RootElement.GetProperty("scenario").GetString()!
                                );
                            var id = Guid.NewGuid().ToString("N");
                            sessions.Add(id, session);
                            result = new
                            {
                                sessionId = id,
                                tripId = session.TripId,
                                destinationCity = session.DestinationCity,
                                before = await State(session),
                            };
                            break;
                        case "/rpc":
                            var active = sessions[request.Request.Headers["X-Eval-Session"]!];
                            using (
                                var message = new HttpRequestMessage(HttpMethod.Post, "/mcp")
                                {
                                    Content = new StringContent(
                                        body.RootElement.GetRawText(),
                                        Encoding.UTF8,
                                        "application/json"
                                    ),
                                }
                            )
                            {
                                message.Headers.Accept.Add(
                                    new MediaTypeWithQualityHeaderValue("application/json")
                                );
                                message.Headers.Accept.Add(
                                    new MediaTypeWithQualityHeaderValue("text/event-stream")
                                );
                                message.Headers.Add("MCP-Protocol-Version", "2025-06-18");
                                result = new
                                {
                                    result = await McpEndpointTests.Result(
                                        await active.Agent.SendAsync(message)
                                    ),
                                };
                            }
                            break;
                        case "/finish":
                            var key = request.Request.Headers["X-Eval-Session"]!;
                            var completed = sessions[key];
                            result = await State(completed);
                            sessions.Remove(key);
                            await completed.DisposeAsync();
                            break;
                        default:
                            request.Response.StatusCode = 404;
                            result = new { error = "Unknown eval endpoint" };
                            break;
                    }
                    await JsonSerializer.SerializeAsync(
                        request.Response.OutputStream,
                        result,
                        JsonSerializerOptions.Web
                    );
                }
                catch (Exception exception)
                {
                    request.Response.StatusCode = 500;
                    await JsonSerializer.SerializeAsync(
                        request.Response.OutputStream,
                        new { error = exception.Message }
                    );
                }
                finally
                {
                    request.Response.Close();
                }
            }
        }
        finally
        {
            foreach (var session in sessions.Values)
            {
                await session.DisposeAsync();
            }
        }
        return 0;
    }
}
