using OpenIddict.Abstractions;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Mcp;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;

namespace TripPlanner.Api.Endpoints;

public static class ActivityPlanEndpoints
{
    public static void MapActivityPlanEndpoints(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        group.AddEndpointFilter(
            async (invocation, next) =>
            {
                try
                {
                    return await next(invocation);
                }
                catch (ActivityPlanningChangedException)
                {
                    return Stale();
                }
                catch (Npgsql.PostgresException e) when (e.SqlState is "40001" or "40P01")
                {
                    return Stale();
                }
            }
        );
        group.MapGet(
            "/user/activity-preferences",
            (HttpContext c, IPlannerDb db, ICurrentUser u) =>
                GetPreferences(ActivityPreferenceScope.Profile, null, null, c, db, u)
        );
        group.MapPut(
            "/user/activity-preferences",
            (ActivityPreferencesRequest request, HttpContext c, IPlannerDb db, ICurrentUser u) =>
                ReplacePreferences(ActivityPreferenceScope.Profile, null, null, request, c, db, u)
        );
        group.MapGet(
            "/trips/{tripId:guid}/activity-preferences",
            (Guid tripId, HttpContext c, IPlannerDb db, ICurrentUser u) =>
                GetPreferences(ActivityPreferenceScope.Trip, tripId, null, c, db, u)
        );
        group.MapPut(
            "/trips/{tripId:guid}/activity-preferences",
            (
                Guid tripId,
                ActivityPreferencesRequest request,
                HttpContext c,
                IPlannerDb db,
                ICurrentUser u
            ) => ReplacePreferences(ActivityPreferenceScope.Trip, tripId, null, request, c, db, u)
        );
        group.MapGet(
            "/trips/{tripId:guid}/destinations/{destinationCity}/activity-preferences",
            (Guid tripId, string destinationCity, HttpContext c, IPlannerDb db, ICurrentUser u) =>
                GetPreferences(
                    ActivityPreferenceScope.Destination,
                    tripId,
                    destinationCity,
                    c,
                    db,
                    u
                )
        );
        group.MapPut(
            "/trips/{tripId:guid}/destinations/{destinationCity}/activity-preferences",
            (
                Guid tripId,
                string destinationCity,
                ActivityPreferencesRequest request,
                HttpContext c,
                IPlannerDb db,
                ICurrentUser u
            ) =>
                ReplacePreferences(
                    ActivityPreferenceScope.Destination,
                    tripId,
                    destinationCity,
                    request,
                    c,
                    db,
                    u
                )
        );
        var plans = group.MapGroup(
            "/trips/{tripId:guid}/destinations/{destinationCity}/activity-plan"
        );
        plans.MapGet("", GetPlan);
        plans.MapPut("", ReplacePlan);
        plans.MapPost("/previews", PreviewPlan);
        plans.MapPost("/assessments", CreateAssessment);
        plans.MapGet(
            "/assessments/{id:guid}",
            (
                Guid tripId,
                string destinationCity,
                Guid id,
                HttpContext c,
                IPlannerDb db,
                ICurrentUser u
            ) => GetResult(tripId, destinationCity, id, "assessment", c, db, u)
        );
        plans.MapPost("/proposals", CreateProposal);
        plans.MapGet(
            "/proposals/{id:guid}",
            (
                Guid tripId,
                string destinationCity,
                Guid id,
                HttpContext c,
                IPlannerDb db,
                ICurrentUser u
            ) => GetResult(tripId, destinationCity, id, "proposal", c, db, u)
        );
        plans.MapPut("/proposals/{id:guid}/review", ReplaceReview);
    }

    internal static IResult Stale() =>
        Results.Conflict(
            new
            {
                code = "planning_context_changed",
                title = "Planning inputs changed. Read the plan again before retrying.",
            }
        );

    internal static bool Matches(HttpContext c, long version) =>
        c.Request.Headers.IfMatch == ActivityPlanRules.ETag(version);

    internal static IResult VersionError(HttpContext c) =>
        Results.Problem(
            statusCode: string.IsNullOrEmpty(c.Request.Headers.IfMatch) ? 428 : 412,
            title: "Supply the latest ETag in If-Match; read the resource again."
        );

    private static void Headers(HttpContext c, long version, string? contextVersion = null)
    {
        c.Response.Headers.ETag = ActivityPlanRules.ETag(version);
        c.Response.Headers.CacheControl = "no-store";
        if (contextVersion is not null)
        {
            c.Response.Headers["Planning-Context"] = contextVersion;
        }
    }

    private static async Task<(User? User, IResult? Error)> PreferenceAccess(
        ActivityPreferenceScope scope,
        Guid? tripId,
        string? city,
        bool write,
        HttpContext c,
        IPlannerDb db,
        ICurrentUser current
    )
    {
        if (
            !Enum.IsDefined(scope)
            || scope == ActivityPreferenceScope.Profile && (tripId is not null || city is not null)
            || scope != ActivityPreferenceScope.Profile && (tripId is null || tripId == Guid.Empty)
            || scope == ActivityPreferenceScope.Trip && city is not null
            || scope == ActivityPreferenceScope.Destination && string.IsNullOrWhiteSpace(city)
        )
        {
            return (
                null,
                Results.BadRequest(
                    new
                    {
                        title = "Profile scope takes no IDs; trip scope needs tripId; destination scope needs tripId and destinationCity.",
                    }
                )
            );
        }

        if (scope == ActivityPreferenceScope.Profile)
        {
            return await EndpointAuthorization.AuthorizeCurrentUserAsync(c, db, current.Profile!);
        }

        var (_, user, error) = await PlanningEndpointHelpers.AuthorizeAsync(
            tripId!.Value,
            write,
            c,
            db,
            current
        );
        if (error is not null)
        {
            return (user, error);
        }

        return
            scope == ActivityPreferenceScope.Destination
            && await db.GetDestinationPlaceAsync(user!.Id, tripId.Value, city!, c.RequestAborted)
                is null
            ? (user, Results.NotFound())
            : (user, null);
    }

    internal static async Task<IResult> GetPreferences(
        ActivityPreferenceScope scope,
        Guid? tripId,
        string? destinationCity,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (user, error) = await PreferenceAccess(
            scope,
            tripId,
            destinationCity,
            false,
            context,
            database,
            currentUser
        );
        if (error is not null)
        {
            return error;
        }

        var saved = await database.GetActivityPreferencesAsync(
            tripId ?? user!.Id,
            scope.ToString().ToLowerInvariant(),
            destinationCity ?? "",
            context.RequestAborted
        );
        Headers(context, saved.Version);
        return Results.Ok(saved.Preferences);
    }

    internal static async Task<IResult> ReplacePreferences(
        ActivityPreferenceScope scope,
        Guid? tripId,
        string? destinationCity,
        ActivityPreferencesRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (user, error) = await PreferenceAccess(
            scope,
            tripId,
            destinationCity,
            true,
            context,
            database,
            currentUser
        );
        if (error is not null)
        {
            return error;
        }

        if (request.Instructions is null || request.Instructions.Length > 10000)
        {
            return Results.BadRequest(
                new { title = "Instructions must be at most 10,000 characters." }
            );
        }

        if (
            request.Defaults is { } defaults
            && ActivityPlanRules.ValidateSettings(defaults) is { Count: > 0 } errors
        )
        {
            return Results.ValidationProblem(errors);
        }

        string name = scope.ToString().ToLowerInvariant();
        var before = await database.GetActivityPreferencesAsync(
            tripId ?? user!.Id,
            name,
            destinationCity ?? "",
            context.RequestAborted
        );
        if (!Matches(context, before.Version))
        {
            return VersionError(context);
        }

        var saved = await database.SaveActivityPreferencesAsync(
            user!.Id,
            tripId,
            name,
            destinationCity ?? "",
            new(request.Instructions, request.Defaults),
            before.Version,
            context.RequestAborted
        );
        if (saved is null)
        {
            return VersionError(context);
        }

        Headers(context, saved.Version);
        return Results.Ok(saved.Preferences);
    }

    internal static async Task<IResult> GetPlan(
        Guid tripId,
        string destinationCity,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        ActivityPlanningService service
    )
    {
        var (_, user, error) = await PlanningEndpointHelpers.AuthorizeAsync(
            tripId,
            false,
            context,
            database,
            currentUser
        );
        if (error is not null)
        {
            return error;
        }

        var planningContext = await service.ReadAsync(
            user!.Id,
            tripId,
            destinationCity,
            context.RequestAborted
        );
        if (planningContext is null)
        {
            return Results.NotFound();
        }

        var response = service.Response(planningContext);
        Headers(context, response.Version, response.ContextVersion);
        return Results.Ok(response);
    }

    internal static async Task<IResult> PreviewPlan(
        Guid tripId,
        string destinationCity,
        PreviewActivityPlanRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        ActivityPlanningService service,
        TimeProvider clock
    )
    {
        var (_, user, error) = await PlanningEndpointHelpers.AuthorizeAsync(
            tripId,
            false,
            context,
            database,
            currentUser
        );
        if (error is not null)
        {
            return error;
        }
        var planningContext = await service.ReadAsync(
            user!.Id,
            tripId,
            destinationCity,
            context.RequestAborted
        );
        if (planningContext is null)
        {
            return Results.NotFound();
        }
        var version = ActivityPlanningService.ContextVersion(planningContext);
        if (request.ContextVersion != version)
        {
            return Stale();
        }
        var errors = ActivityPlanRules.Validate(request.Plan, planningContext);
        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }
        Headers(context, planningContext.SavedPlan?.Version ?? 0, version);
        // Pure cached-input evaluation: no saved assessment, job, provider call, or plan mutation.
        return Results.Ok(planningContext.Evaluate(request.Plan, clock.GetUtcNow()));
    }

    internal static async Task<IResult> ReplacePlan(
        Guid tripId,
        string destinationCity,
        ReplaceActivityPlanRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        ActivityPlanningService service,
        TimeProvider clock
    )
    {
        var (_, user, error) = await PlanningEndpointHelpers.AuthorizeAsync(
            tripId,
            true,
            context,
            database,
            currentUser
        );
        if (error is not null)
        {
            return error;
        }

        var planningContext = await service.ReadAsync(
            user!.Id,
            tripId,
            destinationCity,
            context.RequestAborted
        );
        if (planningContext is null)
        {
            return Results.NotFound();
        }

        long version = planningContext.SavedPlan?.Version ?? 0;
        if (!Matches(context, version))
        {
            return VersionError(context);
        }

        if (request.ContextVersion != ActivityPlanningService.ContextVersion(planningContext))
        {
            return Stale();
        }

        var plan = request.Plan;
        if (request.ProposalId is { } id)
        {
            var job = await database.GetActivityPlanningJobAsync(
                user.Id,
                tripId,
                destinationCity,
                id,
                context.RequestAborted
            );
            if (
                job?.Result is not { } result
                || result.BasePlanVersion != version
                || result.ContextVersion != request.ContextVersion
            )
            {
                return Stale();
            }

            var proposed =
                result.Alternatives.FirstOrDefault(a => a.Id == request.ChoiceId)?.Plan
                ?? result.Suggestions.FirstOrDefault(s => s.Id == request.ChoiceId)?.Plan;
            if (
                proposed is null
                || ActivityPlanRules.Hash(proposed) != ActivityPlanRules.Hash(plan)
            )
            {
                return Results.BadRequest(
                    new
                    {
                        title = "Apply the complete reviewed choice, with its proposal and choice IDs.",
                    }
                );
            }

            plan = proposed;
        }
        else if (request.ChoiceId is not null)
        {
            return Results.BadRequest(new { title = "A choice ID requires a proposal ID." });
        }

        var errors = ActivityPlanRules.Validate(plan, planningContext);
        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var assessment = planningContext.Evaluate(plan, clock.GetUtcNow());
        var flightConflicts = assessment
            .Issues.Where(i => i.Code == "flight_unavailable")
            .Select(i => i.Message)
            .Distinct()
            .ToArray();
        if (flightConflicts.Length > 0)
        {
            return Results.ValidationProblem(
                new Dictionary<string, string[]> { ["flights"] = flightConflicts }
            );
        }

        var saved = await database.SaveActivityPlanAsync(
            user.Id,
            tripId,
            destinationCity,
            new(plan, assessment, version, planningContext.InputRevision, clock.GetUtcNow()),
            version,
            planningContext.InputRevision,
            context.RequestAborted
        );
        if (saved is null)
        {
            return Stale();
        }
        // State changes are canonical inputs and can advance the context revision.
        var updated = await service.ReadAsync(
            user.Id,
            tripId,
            destinationCity,
            context.RequestAborted
        );
        if (updated is null)
        {
            return Results.NotFound();
        }

        Headers(
            context,
            updated.SavedPlan?.Version ?? saved.Version,
            ActivityPlanningService.ContextVersion(updated)
        );
        return Results.Ok(service.Response(updated));
    }

    internal static Task<IResult> CreateAssessment(
        Guid tripId,
        string destinationCity,
        CreateActivityAssessmentRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        ActivityPlanningService service,
        TimeProvider clock
    ) =>
        CreateJob(
            tripId,
            destinationCity,
            request.RequestId,
            request.ContextVersion,
            request.Plan,
            request.RefreshEvidence,
            request.UseAi,
            "assessment",
            request,
            context,
            database,
            currentUser,
            service,
            clock
        );

    internal static Task<IResult> CreateProposal(
        Guid tripId,
        string destinationCity,
        CreateActivityProposalRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        ActivityPlanningService service,
        TimeProvider clock
    ) =>
        request.Kind is "draft" or "improvements" or "schedule"
            ? CreateJob(
                tripId,
                destinationCity,
                request.RequestId,
                request.ContextVersion,
                request.Plan,
                request.RefreshEvidence,
                request.UseAi,
                request.Kind,
                request,
                context,
                database,
                currentUser,
                service,
                clock
            )
            : Task.FromResult<IResult>(
                Results.BadRequest(new { title = "Choose draft, improvements, or schedule." })
            );

    private static async Task<IResult> CreateJob(
        Guid tripId,
        string city,
        Guid id,
        string contextVersion,
        ActivityPlan? draft,
        bool refresh,
        bool ai,
        string kind,
        object request,
        HttpContext c,
        IPlannerDb db,
        ICurrentUser current,
        ActivityPlanningService service,
        TimeProvider clock
    )
    {
        var (_, user, error) = await PlanningEndpointHelpers.AuthorizeAsync(
            tripId,
            true,
            c,
            db,
            current
        );
        if (error is not null)
        {
            return error;
        }

        if (id == Guid.Empty)
        {
            return Results.BadRequest(new { title = "A nonempty request ID is required." });
        }

        if (ai && !user!.FeatureFlags.Split(',', StringSplitOptions.TrimEntries).Contains("LLM"))
        {
            return Results.Problem(
                statusCode: 403,
                title: "AI enrichment requires the LLM feature flag."
            );
        }

        string hash = ActivityPlanRules.Hash(
            new
            {
                tripId,
                city,
                kind,
                request,
            }
        );
        var existing = await db.GetActivityPlanningJobAsync(
            user!.Id,
            tripId,
            city,
            id,
            c.RequestAborted
        );
        if (existing is not null)
        {
            return existing.UserId == user.Id && existing.RequestHash == hash
                ? JobResponse(existing)
                : Results.Conflict(
                    new
                    {
                        code = "request_id_reused",
                        title = "This request ID has already been used with different inputs.",
                    }
                );
        }

        var planningContext = await service.ReadAsync(user.Id, tripId, city, c.RequestAborted);
        if (planningContext is null)
        {
            return Results.NotFound();
        }

        if (contextVersion != ActivityPlanningService.ContextVersion(planningContext))
        {
            return Stale();
        }

        var plan =
            draft ?? planningContext.SavedPlan?.Plan ?? ActivityPlanRules.Initial(planningContext);
        var errors = ActivityPlanRules.Validate(plan, planningContext);
        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        bool immediate = kind == "assessment" && !refresh && !ai;
        string source =
            c.Request.Path.StartsWithSegments("/mcp")
            || c.User.HasScope(McpServiceExtensions.ReadScope)
            || c.User.HasScope(McpServiceExtensions.WriteScope)
                ? c.User.GetPresenters().Contains(McpServiceExtensions.ClientId)
                    ? "ChatGPT"
                    : "MCP"
                : "Website";
        var job = new ActivityPlanningJob(
            id,
            user.Id,
            tripId,
            city,
            kind,
            hash,
            plan,
            planningContext.InputRevision,
            planningContext.SavedPlan?.Version ?? 0,
            refresh,
            ai,
            source,
            clock.GetUtcNow()
        )
        {
            Result = immediate ? service.Assess(planningContext, plan, id) : null,
            Status = immediate ? "Completed" : "pending",
        };
        var saved = await db.CreateActivityPlanningJobAsync(user.Id, tripId, job, c.RequestAborted);
        c.Response.Headers.CacheControl = "no-store";
        c.Response.Headers.RetryAfter = "2";
        return saved is null ? Stale() : JobResponse(saved);
    }

    private static IResult JobResponse(ActivityPlanningJob job)
    {
        string url =
            $"/trips/{job.TripId}/destinations/{Uri.EscapeDataString(job.CityId)}/activity-plan/{(job.Kind == "assessment" ? "assessments" : "proposals")}/{job.Id}";
        var response = new ActivityPlanningOperationResponse(job.Id, url, job.Result);
        return job.Status is "Completed" or "Failed"
            ? Results.Ok(response)
            : Results.Accepted($"/operations/{job.Id}", response);
    }

    internal static async Task<IResult> GetResult(
        Guid tripId,
        string destinationCity,
        Guid id,
        string kind,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (_, user, error) = await PlanningEndpointHelpers.AuthorizeAsync(
            tripId,
            false,
            context,
            database,
            currentUser
        );
        if (error is not null)
        {
            return error;
        }

        var job = await database.GetActivityPlanningJobAsync(
            user!.Id,
            tripId,
            destinationCity,
            id,
            context.RequestAborted
        );
        if (job is null || (job.Kind == "assessment") != (kind == "assessment"))
        {
            return Results.NotFound();
        }

        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.ETag = $"\"{ActivityPlanRules.Hash(job.Review)}\"";
        if (job.Result is not null)
        {
            context.Response.Headers["Planning-Context"] = job.Result.ContextVersion;
        }

        return Results.Ok(
            new
            {
                operationId = job.Id,
                status = job.Status,
                result = job.Result,
                review = job.Review,
                error = job.Error,
            }
        );
    }

    internal static async Task<IResult> ReplaceReview(
        Guid tripId,
        string destinationCity,
        Guid id,
        ReplaceActivityProposalReviewRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (_, user, error) = await PlanningEndpointHelpers.AuthorizeAsync(
            tripId,
            true,
            context,
            database,
            currentUser
        );
        if (error is not null)
        {
            return error;
        }

        var job = await database.GetActivityPlanningJobAsync(
            user!.Id,
            tripId,
            destinationCity,
            id,
            context.RequestAborted
        );
        if (job is null || job.Kind == "assessment" || job.Result is null)
        {
            return Results.NotFound();
        }

        if (
            request.DismissedSuggestionIds is null
            || request.DismissedSuggestionIds.Distinct().Count()
                != request.DismissedSuggestionIds.Length
            || request.DismissedSuggestionIds.Any(id =>
                !job.Result.Suggestions.Any(s => s.Id == id)
            )
        )
        {
            return Results.BadRequest(
                new { title = "Dismiss only suggestion IDs in this proposal." }
            );
        }

        if (context.Request.Headers.IfMatch != $"\"{ActivityPlanRules.Hash(job.Review)}\"")
        {
            return VersionError(context);
        }

        if (
            context.Request.Headers["Planning-Context"] != job.Result.ContextVersion
            || (
                await database.GetActivityPlanningRevisionAsync(
                    user.Id,
                    tripId,
                    context.RequestAborted
                )
            ).ToString() != job.Result.ContextVersion
        )
        {
            return Stale();
        }

        if (
            !await database.SaveActivityProposalReviewAsync(
                user.Id,
                tripId,
                destinationCity,
                id,
                new(request.DismissedSuggestionIds),
                job.Review,
                long.Parse(job.Result.ContextVersion),
                job.Result.BasePlanVersion,
                context.RequestAborted
            )
        )
        {
            return Stale();
        }

        return await GetResult(
            tripId,
            destinationCity,
            id,
            "proposal",
            context,
            database,
            currentUser
        );
    }
}
