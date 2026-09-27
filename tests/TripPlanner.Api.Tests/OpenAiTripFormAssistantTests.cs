using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Tests;

[TestClass]
public class OpenAiTripFormAssistantTests
{
    [TestMethod]
    public async Task Proposal_MapsToolCallIntoReviewablePlanningDraft()
    {
        var handler = new Handler();
        var assistant = new OpenAiTripFormAssistant(
            new HttpClient(handler),
            Microsoft.Extensions.Options.Options.Create(new OpenAiOptions { ApiKey = "test-key" }),
            new AirportCatalog()
        );
        Guid ownerId = Guid.NewGuid();
        Guid partyId = Guid.NewGuid();
        var owner = new User(
            ownerId,
            "google",
            "ada@example.com",
            "Ada",
            "Boston",
            null,
            [],
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow,
            "LLM"
        );
        var draft = new PlanningDocument
        {
            Parties = [new PartySearchSettings { PartyId = partyId }],
            Constraints =
            [
                new PlanningConstraint
                {
                    Id = Guid.NewGuid(),
                    UserId = ownerId,
                    Type = "nonstop",
                    OriginalInput = "Paris January 5 to 15, direct only",
                },
            ],
        };
        TripFormProposal proposal = await assistant.ProposeAsync(
            "Paris January 5 to 15, direct only",
            draft,
            owner,
            [new PlanningParty(partyId, [new PlanningMember(ownerId, "Ada", "Boston")])]
        );

        Assert.AreEqual("CDG", proposal.Document.Destination?.Code);
        Assert.AreEqual(new DateOnly(2030, 1, 5), proposal.Document.TravelDates?.StartDate);
        Assert.AreEqual(new DateOnly(2030, 1, 15), proposal.Document.TravelDates?.EndDate);
        Assert.AreEqual(0, proposal.Document.Parties[0].MaxStops);
        Assert.AreEqual("nonstop", proposal.Document.Constraints.Single().Type);
        Assert.AreEqual(ownerId, proposal.Document.Constraints.Single().UserId);
        Assert.IsEmpty(proposal.Warnings);
        Assert.IsNotNull(handler.Request);
        using JsonDocument sent = JsonDocument.Parse(handler.Request);
        Assert.IsFalse(sent.RootElement.GetProperty("store").GetBoolean());
        Assert.AreEqual(
            "fill_trip_form",
            sent.RootElement.GetProperty("tool_choice").GetProperty("name").GetString()
        );
        JsonElement tool = sent.RootElement.GetProperty("tools")[0];
        Assert.AreEqual("fill_trip_form", tool.GetProperty("name").GetString());
        Assert.IsTrue(tool.GetProperty("strict").GetBoolean());
        Assert.AreEqual(
            new OpenAiOptions().Model,
            sent.RootElement.GetProperty("model").GetString()
        );
    }

    [TestMethod]
    public async Task ProviderFailure_IsReportedAsHttpRequestException()
    {
        var assistant = new OpenAiTripFormAssistant(
            new HttpClient(new Handler(HttpStatusCode.Unauthorized)),
            Microsoft.Extensions.Options.Options.Create(new OpenAiOptions { ApiKey = "test-key" }),
            new AirportCatalog()
        );
        Guid ownerId = Guid.NewGuid();
        var owner = new User(
            ownerId,
            "google",
            "ada@example.com",
            "Ada",
            null,
            null,
            [],
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow,
            "LLM"
        );
        HttpRequestException error = await Assert.ThrowsExactlyAsync<HttpRequestException>(() =>
            assistant.ProposeAsync("Paris", new PlanningDocument(), owner, [])
        );
        StringAssert.Contains(error.Message, "401");
    }

    [TestMethod]
    public async Task Proposal_UsesDateWindowsForFlightDatesWhenToolOmitsTopLevelDates()
    {
        const string arguments = """
            {"destination":"Paris","origin":null,"departureDate":null,"returnDate":null,"cabin":null,"market":null,"maxJourneyHours":null,"maxStops":null,"preferredAirlines":null,"requirements":[{"user":null,"type":"departureWindow","earliest":"2030-01-05","latest":"2030-01-07","startDate":null,"endDate":null,"locationType":null,"location":null,"otherUser":null},{"user":null,"type":"returnHomeWindow","earliest":"2030-01-15","latest":"2030-01-17","startDate":null,"endDate":null,"locationType":null,"location":null,"otherUser":null}]}
            """;
        var assistant = new OpenAiTripFormAssistant(
            new HttpClient(new Handler(arguments: arguments)),
            Microsoft.Extensions.Options.Options.Create(new OpenAiOptions { ApiKey = "test-key" }),
            new AirportCatalog()
        );
        Guid ownerId = Guid.NewGuid();
        Guid partyId = Guid.NewGuid();
        var owner = new User(
            ownerId,
            "google",
            "ada@example.com",
            "Ada",
            "Boston",
            null,
            [],
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow,
            "LLM"
        );
        TripFormProposal proposal = await assistant.ProposeAsync(
            "Paris January 5 to 15, flexible by two days",
            new PlanningDocument { Parties = [new PartySearchSettings { PartyId = partyId }] },
            owner,
            [new PlanningParty(partyId, [new PlanningMember(ownerId, "Ada", "Boston")])]
        );
        Assert.AreEqual(new DateOnly(2030, 1, 5), proposal.Document.TravelDates?.StartDate);
        Assert.AreEqual(new DateOnly(2030, 1, 15), proposal.Document.TravelDates?.EndDate);
    }

    [TestMethod]
    public async Task NewPrompt_ReplacesRequirementsFromEarlierAiFill()
    {
        Guid ownerId = Guid.NewGuid();
        Guid partyId = Guid.NewGuid();
        var owner = new User(
            ownerId,
            "google",
            "ada@example.com",
            "Ada",
            "Boston",
            null,
            [],
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow,
            "LLM"
        );
        var oldWindow = new PlanningConstraint
        {
            Id = Guid.NewGuid(),
            UserId = ownerId,
            Type = "returnHomeWindow",
            Window = new(new(2030, 12, 3), new(2030, 12, 9)),
            OriginalInput = "Old December trip",
        };
        var manual = new PlanningConstraint
        {
            Id = Guid.NewGuid(),
            UserId = ownerId,
            Type = "avoidLayover",
            LocationType = "city",
            Location = "Amsterdam",
        };
        var assistant = new OpenAiTripFormAssistant(
            new HttpClient(new Handler()),
            Microsoft.Extensions.Options.Options.Create(new OpenAiOptions { ApiKey = "test-key" }),
            new AirportCatalog()
        );
        TripFormProposal proposal = await assistant.ProposeAsync(
            "New January trip",
            new PlanningDocument
            {
                Parties = [new PartySearchSettings { PartyId = partyId }],
                Constraints = [oldWindow, manual],
            },
            owner,
            [new PlanningParty(partyId, [new PlanningMember(ownerId, "Ada", "Boston")])]
        );
        Assert.IsFalse(proposal.Document.Constraints.Any(c => c.Id == oldWindow.Id));
        Assert.IsTrue(proposal.Document.Constraints.Any(c => c.Id == manual.Id));
        Assert.IsTrue(proposal.Document.Constraints.Any(c => c.Type == "nonstop"));
    }

    private sealed class Handler(
        HttpStatusCode statusCode = HttpStatusCode.OK,
        string? arguments = null
    ) : HttpMessageHandler
    {
        public string? Request { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        )
        {
            Request = await request.Content!.ReadAsStringAsync(cancellationToken);
            if (statusCode != HttpStatusCode.OK)
                return new HttpResponseMessage(statusCode)
                {
                    Content = new StringContent("unauthorized"),
                };
            const string defaultArguments = """
                {"destination":"Paris","origin":null,"departureDate":"2030-01-05","returnDate":"2030-01-15","cabin":null,"market":null,"maxJourneyHours":null,"maxStops":0,"preferredAirlines":null,"requirements":[{"user":null,"type":"nonstop","earliest":null,"latest":null,"startDate":null,"endDate":null,"locationType":null,"location":null,"otherUser":null}]}
                """;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(
                        new
                        {
                            output = new[]
                            {
                                new
                                {
                                    type = "function_call",
                                    name = "fill_trip_form",
                                    arguments = arguments ?? defaultArguments,
                                },
                            },
                        }
                    ),
                    Encoding.UTF8,
                    "application/json"
                ),
            };
        }
    }
}
