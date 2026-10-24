using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Flights;
using TripPlanner.Api.Telemetry;

namespace TripPlanner.Api.Services.TripForms;

public sealed class TripFormJobProcessor(
    IPlannerDb database,
    ITripFormAssistant assistant,
    AirportCatalog airports,
    ILogger<TripFormJobProcessor> logger
)
{
    public async Task<bool> ProcessNextAsync(CancellationToken cancellationToken = default)
    {
        TripFormWork? work = await database.ClaimTripFormWorkAsync(
            TimeSpan.FromMinutes(3),
            cancellationToken
        );
        if (work is null)
        {
            return false;
        }
        return await OperationTelemetry.TraceJobAsync(
            "trip_form",
            () => ProcessClaimedAsync(work, cancellationToken),
            cancellationToken
        );
    }

    private async Task<bool> ProcessClaimedAsync(
        TripFormWork work,
        CancellationToken cancellationToken
    )
    {
        if (work.Attempts > 3)
        {
            OperationTelemetry.JobFailed();
            await database.CompleteTripFormWorkAsync(
                work,
                null,
                "Trip form fill could not complete after repeated interruptions.",
                cancellationToken
            );
            return true;
        }
        try
        {
            User? owner = await database.GetUserAsync(work.UserId, cancellationToken);
            Trip? trip = await database.GetTripAsync(work.UserId, work.TripId, cancellationToken);
            if (owner is null || trip is null)
            {
                throw new InvalidOperationException("The trip or owner no longer exists.");
            }

            IReadOnlyList<Party> parties = await database.GetPartiesAsync(
                work.UserId,
                work.TripId,
                cancellationToken
            );
            var editorParties = new List<PlanningParty>();
            foreach (Party party in parties)
            {
                var members = new List<PlanningMember>();
                foreach (Guid id in party.UserIds)
                {
                    User? member = await database.GetUserAsync(id, cancellationToken);
                    if (member is not null)
                    {
                        members.Add(new(member.Id, member.DisplayName, member.HomeCityName));
                    }
                }
                editorParties.Add(new(party.Id, members, airports.SuggestOrigin([owner])));
            }
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(120));
            TripFormProposal proposal = await assistant.ProposeAsync(
                work.Input,
                work.Draft,
                owner,
                editorParties,
                timeout.Token
            );
            proposal = proposal with
            {
                Document = proposal.Document with
                {
                    AiPrompt = work.Input,
                    AiPromptLocked = true,
                    AiFormOperationId = work.OperationId,
                },
            };
            await database.CompleteTripFormWorkAsync(work, proposal, null, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
            when (exception
                    is HttpRequestException
                        or InvalidOperationException
                        or System.Text.Json.JsonException
                        or KeyNotFoundException
                        or OperationCanceledException
            )
        {
            OperationTelemetry.JobFailed(exception);
            logger.LogWarning(exception, "Trip form fill {OperationId} failed", work.OperationId);
            await database.CompleteTripFormWorkAsync(
                work,
                null,
                "The AI form assistant could not fill the trip. Try again.",
                cancellationToken
            );
        }
        return true;
    }
}
