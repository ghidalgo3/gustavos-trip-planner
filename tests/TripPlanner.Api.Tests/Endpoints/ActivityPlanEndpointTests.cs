using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Tests.Support;
using static TripPlanner.Api.Tests.Support.ActivityPlanningFixture;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class ActivityPlanEndpointTests
{
    [TestMethod]
    public async Task ExistingDestination_WithUnavailablePlanningContext_ReturnsLookupFailure()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, _, place, _) = await Seed(factory, client);
        var database = DispatchProxy.Create<IPlannerDb, MissingPlanningRevisionDb>();
        ((MissingPlanningRevisionDb)database).Inner = factory.Database;
        await using var unavailable = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IPlannerDb>();
                services.AddSingleton(database);
            })
        );
        using var failedClient = unavailable.CreateClient();
        foreach (var header in client.DefaultRequestHeaders)
        {
            failedClient.DefaultRequestHeaders.TryAddWithoutValidation(header.Key, header.Value);
        }
        var response = await failedClient.GetAsync(
            $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan"
        );
        Assert.AreEqual(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.AreEqual("planning_lookup_failed", problem.GetProperty("code").GetString());
    }

    public class MissingPlanningRevisionDb : DispatchProxy
    {
        public IPlannerDb Inner { get; set; } = null!;

        protected override object? Invoke(MethodInfo? method, object?[]? args) =>
            method!.Name == nameof(IPlannerDb.GetActivityPlanningRevisionAsync)
                ? Task.FromResult(-1L)
                : method.Invoke(Inner, args);
    }

    [TestMethod]
    [DataRow("paris-fr")]
    [DataRow("Paris")]
    [DataRow("paris")]
    [DataRow("  PARIS  ")]
    public async Task DestinationLookup_InitializesAndReplacesTheSamePlan(string destination)
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, activity) = await Seed(factory, client);
        string path =
            $"/trips/{trip.Id}/destinations/{Uri.EscapeDataString(destination)}/activity-plan";
        var read = await client.GetAsync(path);
        Assert.AreEqual(HttpStatusCode.OK, read.StatusCode, await read.Content.ReadAsStringAsync());
        var initial = (await read.Content.ReadFromJsonAsync<ActivityPlanResponse>())!;
        Assert.AreEqual(0L, initial.Version);
        Assert.AreEqual("\"0\"", read.Headers.ETag!.ToString());
        Assert.AreEqual(
            initial.ContextVersion,
            read.Headers.GetValues("Planning-Context").Single()
        );
        Assert.IsNull(initial.SavedAssessment);
        Assert.IsNull(await factory.Database.GetActivityPlanAsync(user.Id, trip.Id, place.CityId));
        var plan = initial.Plan with
        {
            Days = [initial.Plan.Days[0] with { ActivityIds = [activity.Id], Name = "Museum day" }],
            Rules = [new(activity.Id) { FixedDate = Date, FixedStart = new(9, 0) }],
        };
        var write = await Put(
            client,
            path,
            new ReplaceActivityPlanRequest(plan, initial.ContextVersion),
            read.Headers.ETag.ToString()
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            write.StatusCode,
            await write.Content.ReadAsStringAsync()
        );
        var canonical = (
            await client.GetFromJsonAsync<ActivityPlanResponse>(
                $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan"
            )
        )!;
        Assert.AreEqual(1L, canonical.Version);
        CollectionAssert.AreEqual(plan.Days[0].ActivityIds, canonical.Plan.Days[0].ActivityIds);
        Assert.AreEqual("Museum day", canonical.Plan.Days[0].Name);
        Assert.AreEqual(new TimeOnly(9, 0), canonical.Plan.Rules[0].FixedStart);
        Assert.AreEqual(Date, canonical.Plan.Rules[0].FixedDate);
        Assert.IsNotNull(
            await factory.Database.GetActivityPlanAsync(user.Id, trip.Id, place.CityId)
        );
        if (destination != place.CityId)
        {
            Assert.IsNull(
                await factory.Database.GetActivityPlanAsync(user.Id, trip.Id, destination)
            );
        }
        // Names and IDs also address the same preferences and persisted assessment jobs.
        string preferencePath =
            $"/trips/{trip.Id}/destinations/{Uri.EscapeDataString(destination)}/activity-preferences";
        var preference = await client.GetAsync(preferencePath);
        var savedPreference = await Put(
            client,
            preferencePath,
            new ActivityPreferencesRequest("Keep museum time"),
            preference.Headers.ETag!.ToString()
        );
        Assert.AreEqual(HttpStatusCode.OK, savedPreference.StatusCode);
        Assert.AreEqual(
            "Keep museum time",
            (
                await factory.Database.GetActivityPreferencesAsync(
                    trip.Id,
                    "destination",
                    place.CityId
                )
            )
                .Preferences
                .Instructions
        );
        canonical = (await client.GetFromJsonAsync<ActivityPlanResponse>(path))!;
        var job = await client.PostAsJsonAsync(
            path + "/assessments",
            new CreateActivityAssessmentRequest(Guid.NewGuid(), canonical.ContextVersion)
        );
        Assert.AreEqual(HttpStatusCode.OK, job.StatusCode, await job.Content.ReadAsStringAsync());
        var result = (await job.Content.ReadFromJsonAsync<ActivityPlanningOperationResponse>())!;
        Assert.AreEqual(
            HttpStatusCode.OK,
            (await client.GetAsync(path + $"/assessments/{result.OperationId}")).StatusCode
        );
        Assert.AreEqual(HttpStatusCode.OK, (await client.GetAsync(result.ResultUrl)).StatusCode);
    }

    [TestMethod]
    [DataRow("Missing", false, HttpStatusCode.NotFound, "destination_not_found")]
    [DataRow("Paris", true, HttpStatusCode.Conflict, "destination_ambiguous")]
    public async Task DestinationLookup_DistinguishesMissingAndAmbiguousNames(
        string destination,
        bool duplicate,
        HttpStatusCode status,
        string code
    )
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, _) = await Seed(factory, client);
        if (duplicate)
        {
            await factory.Database.SaveDestinationPlaceAsync(
                user.Id,
                place with
                {
                    CityId = "paris-us",
                    CountryCode = "US",
                }
            );
        }
        var response = await client.GetAsync(
            $"/trips/{trip.Id}/destinations/{destination}/activity-plan"
        );
        Assert.AreEqual(status, response.StatusCode);
        var problem = (await response.Content.ReadFromJsonAsync<JsonElement>());
        Assert.AreEqual(code, problem.GetProperty("code").GetString());
        Assert.AreEqual(
            HttpStatusCode.OK,
            (
                await client.GetAsync($"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan")
            ).StatusCode
        );
        Assert.IsNull(await factory.Database.GetActivityPlanAsync(user.Id, trip.Id, place.CityId));
    }

    [TestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public async Task DayNames_RoundTripNormalizeAndClear_WithoutAcceptingTiming(bool stale)
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, activity) = await Seed(factory, client);
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var read = await client.GetAsync(path);
        var initial = (await read.Content.ReadFromJsonAsync<ActivityPlanResponse>())!;
        Assert.IsNull(initial.Plan.Days.Single().Name);
        var plan = initial.Plan with
        {
            Days =
            [
                initial.Plan.Days[0] with
                {
                    ActivityIds = [activity.Id],
                    Name = "EPCOT Visit",
                },
            ],
            Rules = [new(activity.Id) { AlwaysAvailable = true }],
        };
        var write = await Put(
            client,
            path,
            new ReplaceActivityPlanRequest(plan, initial.ContextVersion),
            read.Headers.ETag!.ToString()
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            write.StatusCode,
            await write.Content.ReadAsStringAsync()
        );
        var saved = (await factory.Database.GetActivityPlanAsync(user.Id, trip.Id, place.CityId))!;
        if (stale)
        {
            await factory.Database.SaveActivityAsync(
                user.Id,
                activity with
                {
                    Properties = activity.Properties with { Duration = TimeSpan.FromHours(2) },
                    UpdatedAt = Now.AddMinutes(1),
                },
                place.ContextVersion,
                activity.UpdatedAt
            );
        }
        var beforeDocument = (
            await client.GetFromJsonAsync<TripDocument>($"/trips/{trip.Id}/document")
        )!;
        foreach (
            var (supplied, expected) in new (string?, string?)[]
            {
                ("  京都 & EPCOT 🌐  ", "京都 & EPCOT 🌐"),
                ("   ", null),
                (" ", null),
            }
        )
        {
            read = await client.GetAsync(path);
            var current = (await read.Content.ReadFromJsonAsync<ActivityPlanResponse>())!;
            var renamed = current.Plan with
            {
                Days = [current.Plan.Days[0] with { Name = supplied }],
            };
            write = await Put(
                client,
                path,
                new ReplaceActivityPlanRequest(renamed, current.ContextVersion),
                read.Headers.ETag!.ToString()
            );
            Assert.AreEqual(
                HttpStatusCode.OK,
                write.StatusCode,
                await write.Content.ReadAsStringAsync()
            );
            var response = (await write.Content.ReadFromJsonAsync<ActivityPlanResponse>())!;
            Assert.AreEqual(expected, response.Plan.Days.Single().Name);
            Assert.AreEqual(stale, response.TimingStale);
            Assert.AreEqual(current.ContextVersion, response.ContextVersion);
            Assert.AreEqual(current.Version + 1, response.Version);
            var stored = (
                await factory.Database.GetActivityPlanAsync(user.Id, trip.Id, place.CityId)
            )!;
            Assert.AreEqual(saved.InputRevision, stored.InputRevision);
            Assert.AreEqual(
                JsonSerializer.Serialize(saved.Assessment),
                JsonSerializer.Serialize(stored.Assessment)
            );
            var document = (
                await client.GetFromJsonAsync<TripDocument>($"/trips/{trip.Id}/document")
            )!;
            Assert.AreEqual(
                expected,
                document.Preferences["destinations"]![0]!["schedule"]!["days"]![0]!
                    ["name"]
                    ?.GetValue<string>()
            );
            Assert.AreNotEqual(beforeDocument.Revision, document.Revision);
            Assert.AreEqual(
                HttpStatusCode.PreconditionFailed,
                (
                    await Put(
                        client,
                        path,
                        new ReplaceActivityPlanRequest(renamed, current.ContextVersion),
                        read.Headers.ETag!.ToString()
                    )
                ).StatusCode
            );
        }
    }

    [TestMethod]
    [DataRow(200, HttpStatusCode.OK)]
    [DataRow(201, HttpStatusCode.BadRequest)]
    public async Task DayNames_EnforceLengthEvenOnEmptyDays(int length, HttpStatusCode expected)
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, _, place, _) = await Seed(factory, client);
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var read = await client.GetAsync(path);
        var initial = (await read.Content.ReadFromJsonAsync<ActivityPlanResponse>())!;
        var plan = initial.Plan with
        {
            Days = [initial.Plan.Days[0] with { Name = new string('a', length) }],
        };
        var write = await Put(
            client,
            path,
            new ReplaceActivityPlanRequest(plan, initial.ContextVersion),
            read.Headers.ETag!.ToString()
        );
        Assert.AreEqual(expected, write.StatusCode, await write.Content.ReadAsStringAsync());
        if (expected == HttpStatusCode.OK)
        {
            var reloaded = (await client.GetFromJsonAsync<ActivityPlanResponse>(path))!;
            Assert.AreEqual(new string('a', length), reloaded.Plan.Days.Single().Name);
            Assert.IsEmpty(reloaded.Plan.Days.Single().ActivityIds);
        }
    }

    [TestMethod]
    public async Task ScheduleProposal_QueuesSelectedPlanWithoutApplyingIt()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, activity) = await Seed(factory, client);
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var current = (await client.GetFromJsonAsync<ActivityPlanResponse>(path))!;
        var request = new CreateActivityProposalRequest(
            Guid.NewGuid(),
            current.ContextVersion,
            current.Plan,
            RefreshEvidence: true,
            Kind: "schedule"
        );
        var response = await client.PostAsJsonAsync(path + "/proposals", request);
        Assert.AreEqual(
            HttpStatusCode.Accepted,
            response.StatusCode,
            await response.Content.ReadAsStringAsync()
        );
        var job = (
            await factory.Database.GetActivityPlanningJobAsync(
                user.Id,
                trip.Id,
                place.CityId,
                request.RequestId
            )
        )!;
        Assert.AreEqual("schedule", job.Kind);
        CollectionAssert.AreEqual(new[] { activity.Id }, job.Plan.SelectedActivityIds);
        Assert.IsTrue(job.RefreshEvidence);
        Assert.IsNull(await factory.Database.GetActivityPlanAsync(user.Id, trip.Id, place.CityId));
    }

    [TestMethod]
    public async Task Preview_EvaluatesDraftWithoutSaving_AndRejectsStaleOrForeignInputs()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, activity) = await Seed(factory, client);
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var initial = (await client.GetFromJsonAsync<ActivityPlanResponse>(path))!;
        var draft = initial.Plan with
        {
            Days = [initial.Plan.Days[0] with { ActivityIds = [activity.Id] }],
        };
        var beforeLog = await client.GetStringAsync("/user/activity-log");
        var beforeOperations = await client.GetStringAsync("/operations");
        var preview = await client.PostAsJsonAsync(
            path + "/previews",
            new PreviewActivityPlanRequest(draft, initial.ContextVersion)
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            preview.StatusCode,
            await preview.Content.ReadAsStringAsync()
        );
        var assessed = (await preview.Content.ReadFromJsonAsync<ActivityPlanAssessment>())!;
        Assert.AreEqual(activity.Id, assessed.Days.Single().Entries.Single().ActivityId);
        Assert.AreEqual(activity.Properties.Duration, assessed.Days.Single().ActivityDuration);
        Assert.IsNotNull(preview.Headers.ETag);
        var after = (await client.GetFromJsonAsync<ActivityPlanResponse>(path))!;
        Assert.IsEmpty(after.Plan.Days[0].ActivityIds);
        Assert.AreEqual(initial.Version, after.Version);
        Assert.AreEqual(initial.ContextVersion, after.ContextVersion);
        Assert.IsNull(await factory.Database.GetActivityPlanAsync(user.Id, trip.Id, place.CityId));
        Assert.AreEqual(beforeLog, await client.GetStringAsync("/user/activity-log"));
        Assert.AreEqual(beforeOperations, await client.GetStringAsync("/operations"));
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (
                await client.PostAsJsonAsync(
                    path + "/previews",
                    new PreviewActivityPlanRequest(draft, "stale")
                )
            ).StatusCode
        );
        var invalid = draft with { Days = [draft.Days[0] with { ActivityIds = [Guid.NewGuid()] }] };
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PostAsJsonAsync(
                    path + "/previews",
                    new PreviewActivityPlanRequest(invalid, initial.ContextVersion)
                )
            ).StatusCode
        );
        client.DefaultRequestHeaders.Remove("X-Test-Subject");
        client.DefaultRequestHeaders.Add("X-Test-Subject", "other-preview-user");
        client.DefaultRequestHeaders.Remove("X-Test-Email");
        client.DefaultRequestHeaders.Add("X-Test-Email", "other-preview@example.com");
        await client.GetAsync("/user");
        await client.PutResourceAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Boston", -71, 42), [])
        );
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (
                await client.PostAsJsonAsync(
                    path + "/previews",
                    new PreviewActivityPlanRequest(draft, initial.ContextVersion)
                )
            ).StatusCode
        );
    }

    [TestMethod]
    public async Task ManualMealPositions_PreviewSaveAndReloadPreserveCalculatedTiming()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, _, place, activity) = await Seed(factory, client);
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var read = await client.GetAsync(path);
        var initial = (await read.Content.ReadFromJsonAsync<ActivityPlanResponse>())!;
        Assert.IsEmpty(initial.Assessment.Days.Single().Breaks);
        var positions = new ActivityMealPositions(0, 1, 1);
        var draft = initial.Plan with
        {
            Settings = initial.Plan.Settings with { BreakfastDuration = TimeSpan.FromMinutes(30) },
            Days =
            [
                initial.Plan.Days[0] with
                {
                    ActivityIds = [activity.Id],
                    MealPositions = positions,
                },
            ],
            Rules = [new(activity.Id) { AlwaysAvailable = true }],
        };
        var preview = await client.PostAsJsonAsync(
            path + "/previews",
            new PreviewActivityPlanRequest(draft, initial.ContextVersion)
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            preview.StatusCode,
            await preview.Content.ReadAsStringAsync()
        );
        var timing = (await preview.Content.ReadFromJsonAsync<ActivityPlanAssessment>())!
            .Days.Single()
            .Entries.Single();
        Assert.AreEqual(new TimeOnly(7, 30), TimeOnly.FromDateTime(timing.Start!.Value.DateTime));
        var saved = await Put(
            client,
            path,
            new ReplaceActivityPlanRequest(draft, initial.ContextVersion),
            read.Headers.ETag!.ToString()
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            saved.StatusCode,
            await saved.Content.ReadAsStringAsync()
        );
        var reloaded = (await client.GetFromJsonAsync<ActivityPlanResponse>(path))!;
        Assert.AreEqual(positions, reloaded.Plan.Days.Single().MealPositions);
        Assert.AreEqual(timing.Start, reloaded.Assessment.Days.Single().Entries.Single().Start);
        Assert.IsNull(reloaded.Plan.Rules.Single().FixedStart);
    }

    [TestMethod]
    public async Task FlightBlockedActivity_PreviewExplainsAndSaveRejects_WhileValidPlacementPersists()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, activity) = await Seed(factory, client);
        var party = (await factory.Database.GetPartiesAsync(user.Id, trip.Id)).Single();
        await factory.Database.SetSelectedFlightAsync(user.Id, ReturnFlight(trip.Id, party.Id));
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var read = await client.GetAsync(path);
        var initial = (await read.Content.ReadFromJsonAsync<ActivityPlanResponse>())!;
        var plan = initial.Plan with
        {
            Days =
            [
                initial.Plan.Days[0] with
                {
                    ActivityIds = [activity.Id],
                    MealPositions = new(0, 0, 1),
                    AvailableFrom = new(7, 0),
                    AvailableUntil = new(23, 0),
                },
            ],
            Rules = [new(activity.Id) { FixedStart = new(18, 0), AlwaysAvailable = true }],
        };
        var preview = await client.PostAsJsonAsync(
            path + "/previews",
            new PreviewActivityPlanRequest(plan, initial.ContextVersion)
        );
        Assert.AreEqual(HttpStatusCode.OK, preview.StatusCode);
        var assessment = (await preview.Content.ReadFromJsonAsync<ActivityPlanAssessment>())!;
        Assert.IsTrue(assessment.Issues.Any(i => i.Code == "flight_unavailable"));
        Assert.IsNotNull(assessment.Days.Single().FlightAvailability);
        var invalid = await Put(
            client,
            path,
            new ReplaceActivityPlanRequest(plan, initial.ContextVersion),
            read.Headers.ETag!.ToString()
        );
        Assert.AreEqual(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.IsNull(await factory.Database.GetActivityPlanAsync(user.Id, trip.Id, place.CityId));
        plan = plan with { Rules = [plan.Rules[0] with { FixedStart = new(14, 0) }] };
        var valid = await Put(
            client,
            path,
            new ReplaceActivityPlanRequest(plan, initial.ContextVersion),
            read.Headers.ETag!.ToString()
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            valid.StatusCode,
            await valid.Content.ReadAsStringAsync()
        );
        var reloaded = (await client.GetFromJsonAsync<ActivityPlanResponse>(path))!;
        Assert.AreEqual(
            2,
            reloaded.Context.SuggestedAvailability.Single().Candidates.Count(c => c.Selected)
        );
        Assert.IsFalse(reloaded.Assessment.Issues.Any(i => i.Code == "flight_unavailable"));
    }

    [TestMethod]
    public async Task PartialFlightChoices_AreShownAndConstrainPlanningBeforeTheItineraryIsComplete()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, _) = await Seed(factory, client);
        var party = (await factory.Database.GetPartiesAsync(user.Id, trip.Id)).Single();
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var initial = (await client.GetFromJsonAsync<ActivityPlanResponse>(path))!;
        var flight = ReturnFlight(trip.Id, party.Id);
        var outbound = flight.Itinerary.GetProperty("outbound");
        var fare = new FareSearchResult(
            party.Id,
            "saved",
            flight.Request,
            System.Text.Json.JsonSerializer.SerializeToElement(
                new { itineraries = new[] { flight.Itinerary } }
            ),
            Now,
            Now.AddHours(1)
        );
        await factory.Database.SetFlightChoicesAsync(
            user.Id,
            trip.Id,
            new(
                party.Id,
                [TripPlanner.Api.Services.Flights.FlightChoiceRoute.FlightKey(outbound), null],
                []
            )
            {
                SavedFares = [fare],
            }
        );
        Assert.IsEmpty(await factory.Database.GetSelectedFlightsAsync(user.Id, trip.Id));
        var current = (await client.GetFromJsonAsync<ActivityPlanResponse>(path))!;
        Assert.AreNotEqual(initial.ContextVersion, current.ContextVersion);
        var chosen = current
            .Context.SuggestedAvailability.Single()
            .Candidates.Single(c => c.Selected);
        Assert.AreEqual("BOS", chosen.DepartureAirport);
        Assert.AreEqual("CDG", chosen.ArrivalAirport);
        Assert.AreEqual(
            12,
            current.Assessment.Days.Single().FlightAvailability!.AvailableFromInstant!.Value.Hour
        );
        var stale = await client.PostAsJsonAsync(
            path + "/previews",
            new PreviewActivityPlanRequest(initial.Plan, initial.ContextVersion)
        );
        Assert.AreEqual(HttpStatusCode.Conflict, stale.StatusCode);
    }

    private static async Task<HttpResponseMessage> Put(
        HttpClient client,
        string path,
        object body,
        string? etag
    )
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, path)
        {
            Content = JsonContent.Create(body),
        };
        if (etag is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", etag);
        }

        return await client.SendAsync(request);
    }

    [TestMethod]
    public async Task PlanReplacement_SynchronizesStates_AuditsSuccess_AndRejectsStaleInputs()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, activity) = await Seed(factory, client);
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var read = await client.GetAsync(path);
        var initial = (await read.Content.ReadFromJsonAsync<ActivityPlanResponse>())!;
        Assert.HasCount(1, initial.Plan.SelectedActivityIds);
        Assert.IsTrue(initial.Assessment.Issues.Any(i => i.Code == "unscheduled"));
        var plan = initial.Plan with
        {
            Days =
            [
                initial.Plan.Days[0] with
                {
                    ActivityIds = [activity.Id],
                    AvailabilityConfirmed = true,
                },
            ],
            Rules = [new(activity.Id) { AlwaysAvailable = true }],
        };
        var request = new ReplaceActivityPlanRequest(plan, initial.ContextVersion);
        Assert.AreEqual((HttpStatusCode)428, (await Put(client, path, request, null)).StatusCode);
        var saved = await Put(client, path, request, read.Headers.ETag!.ToString());
        Assert.AreEqual(
            HttpStatusCode.OK,
            saved.StatusCode,
            await saved.Content.ReadAsStringAsync()
        );
        var current = (await saved.Content.ReadFromJsonAsync<ActivityPlanResponse>())!;
        Assert.AreEqual(
            HttpStatusCode.PreconditionFailed,
            (await Put(client, path, request, read.Headers.ETag!.ToString())).StatusCode
        );
        var changed = activity with
        {
            Properties = activity.Properties with { Duration = TimeSpan.FromHours(2) },
            UpdatedAt = Now.AddMinutes(1),
        };
        await factory.Database.SaveActivityAsync(
            user.Id,
            changed,
            place.ContextVersion,
            activity.UpdatedAt
        );
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (
                await Put(
                    client,
                    path,
                    new ReplaceActivityPlanRequest(current.Plan, current.ContextVersion),
                    saved.Headers.ETag!.ToString()
                )
            ).StatusCode
        );
        read = await client.GetAsync(path);
        current = (await read.Content.ReadFromJsonAsync<ActivityPlanResponse>())!;
        Assert.IsTrue(current.TimingStale);
        var excluded = current.Plan with
        {
            SelectedActivityIds = [],
            ExcludedActivityIds = [activity.Id],
            Days = current.Plan.Days.Select(d => d with { ActivityIds = [] }).ToArray(),
            Rules = [],
        };
        saved = await Put(
            client,
            path,
            new ReplaceActivityPlanRequest(excluded, current.ContextVersion),
            read.Headers.ETag!.ToString()
        );
        Assert.AreEqual(HttpStatusCode.OK, saved.StatusCode);
        Assert.AreEqual(
            ActivityState.No,
            (await factory.Database.GetActivityAsync(user.Id, trip.Id, place.CityId, activity.Id))!
                .Properties
                .State
        );
        var log = (await client.GetFromJsonAsync<ActivityLogPage>("/user/activity-log"))!;
        Assert.HasCount(2, log.Entries.Where(e => e.Action == "Updated activity plan"));
        Assert.IsTrue(log.Entries.All(e => e.ActorUserId == user.Id && e.Source == "Website"));
    }

    [TestMethod]
    public async Task Assessments_AreIdempotentAndDoNotApplyUnsavedDrafts()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, activity) = await Seed(factory, client);
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var plan = (await client.GetFromJsonAsync<ActivityPlanResponse>(path))!;
        var draft = plan.Plan with { SelectedActivityIds = [], Days = [] };
        var request = new CreateActivityAssessmentRequest(
            Guid.NewGuid(),
            plan.ContextVersion,
            draft
        );
        var first = await client.PostAsJsonAsync(path + "/assessments", request);
        var second = await client.PostAsJsonAsync(path + "/assessments", request);
        Assert.AreEqual(
            HttpStatusCode.OK,
            first.StatusCode,
            await first.Content.ReadAsStringAsync()
        );
        Assert.AreEqual(
            await first.Content.ReadAsStringAsync(),
            await second.Content.ReadAsStringAsync()
        );
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (
                await client.PostAsJsonAsync(
                    path + "/assessments",
                    request with
                    {
                        Plan = plan.Plan,
                    }
                )
            ).StatusCode
        );
        Assert.IsNull(await factory.Database.GetActivityPlanAsync(user.Id, trip.Id, place.CityId));
        Assert.AreEqual(
            ActivityState.Yes,
            (await factory.Database.GetActivityAsync(user.Id, trip.Id, place.CityId, activity.Id))!
                .Properties
                .State
        );
        Assert.AreEqual(
            "Completed",
            (
                await client.GetFromJsonAsync<TrackedOperation>($"/operations/{request.RequestId}")
            )!.Status
        );
    }
}
