using System.Reflection;
using System.Runtime.ExceptionServices;
using System.Transactions;
using OpenIddict.Abstractions;
using TripPlanner.Api.Database;
using TripPlanner.Api.Mcp;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

// Decorates the shared write interface: REST, MCP and background workers cannot bypass auditing.
public class AuditedPlannerDb : DispatchProxy
{
    public static readonly IReadOnlyDictionary<string, string> Actions = new Dictionary<
        string,
        string
    >
    {
        [nameof(IPlannerDb.SaveActivityPreferencesAsync)] = "Updated activity preferences",
        [nameof(IPlannerDb.SaveActivityPlanAsync)] = "Updated activity plan",
        [nameof(IPlannerDb.SaveActivityProposalReviewAsync)] = "Reviewed activity suggestions",
        [nameof(IPlannerDb.CreateActivityCalendarSubscriptionAsync)] =
            "Created calendar subscription",
        [nameof(IPlannerDb.RevokeActivityCalendarSubscriptionAsync)] =
            "Revoked calendar subscription",
        [nameof(IPlannerDb.CreateTripAsync)] = "Created trip",
        [nameof(IPlannerDb.UpdateTripAsync)] = "Updated trip",
        [nameof(IPlannerDb.DeleteTripAsync)] = "Deleted trip",
        [nameof(IPlannerDb.SetFlightConstraintsAsync)] = "Updated flight preferences",
        [nameof(IPlannerDb.ChangePartyMemberAsync)] = "Updated party member",
        [nameof(IPlannerDb.SaveDestinationPlaceAsync)] = "Saved destination",
        [nameof(IPlannerDb.ReplaceDestinationPlaceAsync)] = "Updated destination",
        [nameof(IPlannerDb.DeleteDestinationAsync)] = "Deleted destination and its activities",
        [nameof(IPlannerDb.AddDestinationVisitAsync)] = "Added destination visit",
        [nameof(IPlannerDb.ReplaceDestinationVisitAsync)] = "Updated destination visit",
        [nameof(IPlannerDb.DeleteDestinationVisitAsync)] = "Deleted destination visit",
        [nameof(IPlannerDb.SaveStayLocationAsync)] = "Updated stay location",
        [nameof(IPlannerDb.SaveActivityAsync)] = "Saved activity",
        [nameof(IPlannerDb.DeleteActivityAsync)] = "Deleted activity",
        [nameof(IPlannerDb.SetFlightChoicesAsync)] = "Updated flight choices",
        [nameof(IPlannerDb.SetSelectedFlightAsync)] = "Updated selected flights",
        [nameof(IPlannerDb.DeleteSelectedFlightAsync)] = "Removed selected flights",
        [nameof(IPlannerDb.CompleteActivityJobAsync)] = "Added assistant activities",
    };
    private IPlannerDb database = null!;
    private IActivityLogStore store = null!;
    private IHttpContextAccessor contexts = null!;
    private TimeProvider clock = null!;

    public static IPlannerDb Create(
        IPlannerDb database,
        IActivityLogStore store,
        IHttpContextAccessor contexts,
        TimeProvider clock
    )
    {
        var proxy = Create<IPlannerDb, AuditedPlannerDb>();
        var decorator = (AuditedPlannerDb)proxy;
        decorator.database = database;
        decorator.store = store;
        decorator.contexts = contexts;
        decorator.clock = clock;
        return proxy;
    }

    protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
    {
        var method = targetMethod!;
        if (!Actions.ContainsKey(method.Name))
        {
            return InvokeInner(method, args!);
        }

        if (method.ReturnType == typeof(Task))
        {
            return InvokeVoidAsync(method, args!);
        }

        return typeof(AuditedPlannerDb)
            .GetMethod(nameof(InvokeAsync), BindingFlags.NonPublic | BindingFlags.Instance)!
            .MakeGenericMethod(method.ReturnType.GenericTypeArguments[0])
            .Invoke(this, [method, args!]);
    }

    private object? InvokeInner(MethodInfo method, object?[] args)
    {
        try
        {
            return method.Invoke(database, args);
        }
        catch (TargetInvocationException exception) when (exception.InnerException is not null)
        {
            ExceptionDispatchInfo.Capture(exception.InnerException).Throw();
            throw;
        }
    }

    private async Task InvokeVoidAsync(MethodInfo method, object?[] args) =>
        await ExecuteAsync(
            method,
            args,
            async () =>
            {
                await (Task)InvokeInner(method, args)!;
                return true;
            }
        );

    private Task<T> InvokeAsync<T>(MethodInfo method, object?[] args) =>
        ExecuteAsync(method, args, () => (Task<T>)InvokeInner(method, args)!);

    private async Task<T> ExecuteAsync<T>(MethodInfo method, object?[] args, Func<Task<T>> change)
    {
        var parameters = method
            .GetParameters()
            .Select((parameter, index) => (parameter.Name!, Value: args[index]))
            .ToDictionary(pair => pair.Item1, pair => pair.Value);
        var cancellationToken = parameters.Values.OfType<CancellationToken>().FirstOrDefault();
        var job = parameters.Values.OfType<ActivityJob>().FirstOrDefault();
        Guid actorId =
            job?.UserId
            ?? (Guid)(parameters.GetValueOrDefault("ownerUserId") ?? parameters["userId"])!;
        Guid tripId =
            job?.TripId
            ?? (
                parameters.GetValueOrDefault("tripId") as Guid?
                ?? parameters.Values.OfType<DestinationPlace>().FirstOrDefault()?.TripId
                ?? parameters.Values.OfType<DestinationVisit>().FirstOrDefault()?.TripId
                ?? parameters.Values.OfType<Activity>().FirstOrDefault()?.TripId
                ?? parameters.Values.OfType<SelectedFlight>().FirstOrDefault()?.TripId
                ?? Guid.Empty
            );
        using var transaction =
            database is PostgresPlannerDb
                ? new TransactionScope(
                    TransactionScopeOption.Required,
                    new TransactionOptions
                    {
                        IsolationLevel = IsolationLevel.ReadCommitted,
                        Timeout = TimeSpan.FromMinutes(2),
                    },
                    TransactionScopeAsyncFlowOption.Enabled
                )
                : null;
        var before =
            tripId == Guid.Empty
                ? null
                : await database.GetVisibleTripAsync(actorId, tripId, cancellationToken);
        string? deletedName = null;
        if (before is not null && method.Name == nameof(IPlannerDb.DeleteActivityAsync))
        {
            deletedName = (
                await database.GetActivityAsync(
                    actorId,
                    tripId,
                    (string)parameters["cityId"]!,
                    (Guid)parameters["activityId"]!,
                    cancellationToken
                )
            )
                ?.Properties
                .Name;
        }

        if (before is not null && method.Name == nameof(IPlannerDb.DeleteDestinationAsync))
        {
            deletedName = (
                await database.GetDestinationPlaceAsync(
                    actorId,
                    tripId,
                    (string)parameters["cityId"]!,
                    cancellationToken
                )
            )?.Name;
        }

        var result = await change();
        bool succeeded =
            result is not null
            && result is not false
            && (
                result is not PartyMemberChangeStatus status
                || status == PartyMemberChangeStatus.Success
            );
        if (job is not null)
        {
            var completed = await database.GetActivityJobResultAsync(
                actorId,
                job.TripId,
                job.CityId,
                job.OperationId,
                cancellationToken
            );
            succeeded = succeeded && completed?.Activities.Features.Count > 0;
        }
        var trip = result as Trip ?? before;
        if (succeeded && trip is not null)
        {
            var actor =
                await database.GetUserAsync(actorId, cancellationToken)
                ?? throw new InvalidOperationException("The mutation actor was not found.");
            var context = contexts.HttpContext;
            string source =
                job is not null ? "Activity assistant"
                : context?.Request.Path.StartsWithSegments("/mcp") == true
                    ? context.User.GetPresenters().Contains(McpServiceExtensions.ClientId)
                            ? "ChatGPT"
                        : "MCP"
                : context is not null ? "Website"
                : "Service";
            string? resourceId =
                parameters.GetValueOrDefault("activityId")?.ToString()
                ?? parameters.GetValueOrDefault("stayId")?.ToString()
                ?? parameters.GetValueOrDefault("partyId")?.ToString()
                ?? (result as Activity)?.Id.ToString("D")
                ?? (result as DestinationVisit)?.StayId.ToString("D")
                ?? parameters.GetValueOrDefault("cityId") as string
                ?? (result as DestinationPlace)?.CityId;
            string description = result switch
            {
                Activity activity => activity.Properties.Name,
                DestinationPlace place => place.Name,
                DestinationVisit visit =>
                    $"{visit.CityId}: {visit.ArrivalDate?.ToString("yyyy-MM-dd") ?? "Undated"} – {visit.DepartureDate?.ToString("yyyy-MM-dd") ?? "Undated"}",
                _ when job is not null =>
                    $"{((IReadOnlyList<Activity>?)parameters["activities"])?.Count ?? 0} activities",
                _ => deletedName ?? Actions[method.Name],
            };
            await store.AppendAsync(
                new(
                    Guid.NewGuid(),
                    clock.GetUtcNow(),
                    actorId,
                    actor.DisplayName,
                    source,
                    Actions[method.Name],
                    trip.Id,
                    trip.OwnerUserId,
                    trip.Name,
                    resourceId,
                    description
                ),
                cancellationToken
            );
        }
        transaction?.Complete();
        return result;
    }
}
