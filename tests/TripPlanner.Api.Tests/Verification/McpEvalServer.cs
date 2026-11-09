using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using TripPlanner.Api.Instructions;
using TripPlanner.Api.Models;
using TripPlanner.Api.Tests.Mcp;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Verification;

// Loopback-only bridge to the real MCP handlers in disposable, in-memory test hosts.
// It never connects to a production database, research provider or booking service.
internal static class McpEvalServer
{
    internal sealed class Session(
        TestApplicationFactory factory,
        HttpClient agent,
        Guid userId,
        Guid tripId
    ) : IAsyncDisposable
    {
        internal TestApplicationFactory Factory { get; } = factory;
        internal HttpClient Agent { get; } = agent;
        internal Guid UserId { get; } = userId;
        internal Guid TripId { get; } = tripId;

        public async ValueTask DisposeAsync()
        {
            Agent.Dispose();
            await Factory.DisposeAsync();
        }
    }

    internal static async Task<Session> CreateSession(string scenario)
    {
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
            var token = await McpEndpointTests.Tokens(
                browser,
                "tripplanner.read tripplanner.write"
            );
            var agent = McpEndpointTests.CreateClient(factory);
            agent.DefaultRequestHeaders.Authorization = new(
                "Bearer",
                token.GetProperty("access_token").GetString()
            );
            return new(factory, agent, user.Id, trip.Id);
        }
        catch
        {
            await factory.DisposeAsync();
            throw;
        }
    }

    internal static async Task<object> State(Session session) =>
        new
        {
            activities = await session.Factory.Database.GetActivitiesAsync(
                session.UserId,
                session.TripId,
                "paris-fr"
            ),
            visits = await session.Factory.Database.GetDestinationVisitsAsync(
                session.UserId,
                session.TripId
            ),
        };

    public static async Task<int> Run(int port)
    {
        // MVC's generated content-root manifest is beside the test executable.
        Directory.SetCurrentDirectory(AppContext.BaseDirectory);
        using var listener = new HttpListener();
        listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        listener.Start();
        Console.WriteLine($"MCP eval fixtures: http://127.0.0.1:{port}");
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
                            string scenario = body.RootElement.GetProperty("scenario").GetString()!;
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
                                throw new InvalidOperationException("Unknown eval scenario.");
                            }
                            var session = await CreateSession(scenario);
                            string id = Guid.NewGuid().ToString("N");
                            sessions.Add(id, session);
                            result = new
                            {
                                sessionId = id,
                                tripId = session.TripId,
                                destinationCity = "paris-fr",
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
                                var rpc = await McpEndpointTests.Result(
                                    await active.Agent.SendAsync(message)
                                );
                                result = new { result = rpc };
                            }
                            break;
                        case "/finish":
                            string key = request.Request.Headers["X-Eval-Session"]!;
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
