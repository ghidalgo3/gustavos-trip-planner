using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Endpoints;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.ActivityPlanning;

namespace TripPlanner.Api.Mcp;

[McpServerToolType]
public sealed class ActivityPlanningTools(
    McpExecutionAdapter adapter,
    IPlannerDb database,
    ICurrentUser currentUser,
    ActivityPlanningService service,
    TimeProvider clock,
    IOptions<ActivityPlanningOptions> options
)
{
    private const string ReadSecurity = "[{\"type\":\"oauth2\",\"scopes\":[\"tripplanner.read\"]}]";
    private const string WriteSecurity =
        "[{\"type\":\"oauth2\",\"scopes\":[\"tripplanner.write\"]}]";

    [McpServerTool(
        Name = "get_activity_preferences",
        ReadOnly = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(
        "Read preferences and their ETag. Profile refers only to the connected user and takes no IDs. Trip needs tripId; Destination needs tripId and destinationCity. Other travellers' raw profile instructions are private."
    )]
    public Task<CallToolResult> GetPreferences(
        ActivityPreferenceScope scope,
        Guid? tripId = null,
        string? destinationCity = null
    ) =>
        adapter.ExecuteAsync(
            false,
            c =>
                ActivityPlanEndpoints.GetPreferences(
                    scope,
                    tripId,
                    destinationCity,
                    c,
                    database,
                    currentUser
                )
        );

    [McpServerTool(
        Name = "replace_activity_preferences",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Replace the complete preference document with the ETag from reading it. Preserve unrelated instructions and defaults. Shared scopes require planning permission. Text timing rules require acceptance as structured plan settings before they constrain scheduling."
    )]
    public Task<CallToolResult> ReplacePreferences(
        ActivityPreferenceScope scope,
        ActivityPreferencesRequest request,
        string etag,
        Guid? tripId = null,
        string? destinationCity = null
    ) =>
        adapter.ExecuteAsync(
            true,
            c =>
                ActivityPlanEndpoints.ReplacePreferences(
                    scope,
                    tripId,
                    destinationCity,
                    request,
                    c,
                    database,
                    currentUser
                ),
            etag: etag
        );

    [McpServerTool(
        Name = "get_activity_plan",
        ReadOnly = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(
        "Read the destination's shared schedule, selection, restrictions, assessment, shared context, ETag and input-context version. Read after creating activity ideas and before placing their IDs on dates/times with replace_activity_plan. context.visits supplies destination visit IDs for days[].stayId; these are not accommodation IDs. Planned activities may be selected but unscheduled. Stale saved calendar timing remains fixed until an updated plan is accepted."
    )]
    public Task<CallToolResult> GetPlan(Guid tripId, string destinationCity) =>
        adapter.ExecuteAsync(
            false,
            c =>
                ActivityPlanEndpoints.GetPlan(
                    tripId,
                    destinationCity,
                    c,
                    database,
                    currentUser,
                    service
                )
        );

    [McpServerTool(Name = "preview_activity_plan", ReadOnly = true, OpenWorld = false)]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(
        "Evaluate an unsaved draft using cached inputs without saving a plan, assessment, or job, and without calling providers. Return current timing and free-time totals. Supply the contextVersion from get_activity_plan; reread after a stale-context error. Estimates remain provisional when evidence is incomplete."
    )]
    public Task<CallToolResult> PreviewPlan(
        Guid tripId,
        string destinationCity,
        PreviewActivityPlanRequest request
    ) =>
        adapter.ExecuteAsync(
            false,
            c =>
                ActivityPlanEndpoints.PreviewPlan(
                    tripId,
                    destinationCity,
                    request,
                    c,
                    database,
                    currentUser,
                    service,
                    clock
                )
        );

    [McpServerTool(
        Name = "replace_activity_plan",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Save the complete shared plan when the user requests scheduling or chooses to apply a plan. Create missing activity ideas first with create_activity, or reuse existing ideas; schedule their returned IDs here, never by adding dates/times to activity names or descriptions. Include IDs in selectedActivityIds and days[].activityIds in order, with the destination visit's stayId and local date. For user-requested dates/times, add rules by activityId with fixedDate/fixedStart. Preserve all unrelated fields and restrictions. Supply current ETag and request.contextVersion from get_activity_plan read after activity creation. To accept a proposal, also supply proposalId, choiceId and its exact plan. A 409/412 requires rereading. Conflicting plans are allowed and explained; schedules are never silently optimized."
    )]
    public Task<CallToolResult> ReplacePlan(
        Guid tripId,
        string destinationCity,
        ReplaceActivityPlanRequest request,
        string etag
    ) =>
        adapter.ExecuteAsync(
            true,
            c =>
                ActivityPlanEndpoints.ReplacePlan(
                    tripId,
                    destinationCity,
                    request,
                    c,
                    database,
                    currentUser,
                    service,
                    clock
                ),
            request.ContextVersion,
            etag
        );

    [McpServerTool(
        Name = "create_activity_plan_assessment",
        ReadOnly = false,
        Destructive = false,
        Idempotent = true,
        OpenWorld = true
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Persist an explanation of a saved plan or unsaved draft without applying it. Use a fresh requestId, retaining it for retries with identical inputs. Cached evaluation is immediate; refreshEvidence/useAi may call providers and return an operationId. Poll get_operation, then get_activity_plan_assessment. AI requires the LLM feature flag."
    )]
    public Task<CallToolResult> CreateAssessment(
        Guid tripId,
        string destinationCity,
        CreateActivityAssessmentRequest request
    ) =>
        adapter.ExecuteAsync(
            true,
            c =>
                ActivityPlanEndpoints.CreateAssessment(
                    tripId,
                    destinationCity,
                    request,
                    c,
                    database,
                    currentUser,
                    service,
                    clock
                )
        );

    [McpServerTool(
        Name = "get_activity_plan_assessment",
        ReadOnly = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(
        "Retrieve persisted or partial assessment results, conflicts, assumptions, provenance and operation status. This does not alter the saved schedule."
    )]
    public Task<CallToolResult> GetAssessment(
        Guid tripId,
        string destinationCity,
        Guid assessmentId
    ) =>
        adapter.ExecuteAsync(
            false,
            c =>
                ActivityPlanEndpoints.GetResult(
                    tripId,
                    destinationCity,
                    assessmentId,
                    "assessment",
                    c,
                    database,
                    currentUser
                )
        );

    [McpServerTool(
        Name = "create_activity_plan_proposal",
        ReadOnly = false,
        Destructive = false,
        Idempotent = true,
        OpenWorld = true
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Request draft alternatives or incremental improvements for review. Use kind=schedule to schedule exactly the selected activities, minimizing travel on daily routes starting and ending at the saved accommodation. This mode requires a stay location and never drops selected activities. Does not change the plan. Supply current contextVersion and a fresh requestId; identical retries are idempotent. Respect must-do, day/time/order and transport restrictions. Poll get_operation and inspect the proposal before offering a choice."
    )]
    public Task<CallToolResult> CreateProposal(
        Guid tripId,
        string destinationCity,
        CreateActivityProposalRequest request
    ) =>
        adapter.ExecuteAsync(
            true,
            c =>
                ActivityPlanEndpoints.CreateProposal(
                    tripId,
                    destinationCity,
                    request,
                    c,
                    database,
                    currentUser,
                    service,
                    clock
                )
        );

    [McpServerTool(
        Name = "get_activity_plan_proposal",
        ReadOnly = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(
        "Read progressively available alternatives and improvements, their before/after assessments, base versions and review ETag. Timeout is not proof of infeasibility. Present the user's choice before applying it through replace_activity_plan."
    )]
    public Task<CallToolResult> GetProposal(Guid tripId, string destinationCity, Guid proposalId) =>
        adapter.ExecuteAsync(
            false,
            c =>
                ActivityPlanEndpoints.GetResult(
                    tripId,
                    destinationCity,
                    proposalId,
                    "proposal",
                    c,
                    database,
                    currentUser
                )
        );

    [McpServerTool(
        Name = "replace_activity_plan_proposal_review",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Replace dismissed suggestion IDs using the review ETag and contextVersion. Dismissals last until relevant inputs change. To keep a choice permanently, replace the plan with the user's explicit must-do, fixed-day/time or relative-order restriction; a dismissal alone does not add a restriction."
    )]
    public Task<CallToolResult> ReplaceReview(
        Guid tripId,
        string destinationCity,
        Guid proposalId,
        ReplaceActivityProposalReviewRequest request,
        string etag,
        string contextVersion
    ) =>
        adapter.ExecuteAsync(
            true,
            c =>
                ActivityPlanEndpoints.ReplaceReview(
                    tripId,
                    destinationCity,
                    proposalId,
                    request,
                    c,
                    database,
                    currentUser
                ),
            contextVersion,
            etag
        );

    [McpServerTool(Name = "list_operations", ReadOnly = true, Idempotent = true, OpenWorld = false)]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(
        "List the connected user's durable operations. Activity planning types are activityPlanAssessment and activityPlanProposal. Use returned IDs for polling and result retrieval."
    )]
    public Task<CallToolResult> ListOperations(
        [Range(1, 100)] int? top = null,
        [Range(0, 100000)] int? skip = null,
        [AllowedValues(
            null,
            "flightSearch",
            "tripFormFill",
            "activitySuggest",
            "activityPlanAssessment",
            "activityPlanProposal"
        )]
            string? type = null
    ) =>
        adapter.ExecuteAsync(
            false,
            c => OperationsEndpoints.ListOperations(top, skip, type, c, database, currentUser)
        );

    [McpServerTool(Name = "get_operation", ReadOnly = true, Idempotent = true, OpenWorld = false)]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(
        "Poll a durable operation's status and progress. Use the same ID with the corresponding assessment/proposal retrieval tool. Completed previews still require explicit plan replacement to apply."
    )]
    public Task<CallToolResult> GetOperation(Guid operationId) =>
        adapter.ExecuteAsync(
            false,
            c => OperationsEndpoints.GetOperation(operationId, c, database, currentUser)
        );

    [McpServerTool(
        Name = "list_calendar_subscriptions",
        ReadOnly = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(
        "List only the connected member's calendar subscription metadata. Bearer URLs and token hashes are never returned by this tool."
    )]
    public Task<CallToolResult> ListCalendars(Guid tripId) =>
        adapter.ExecuteAsync(
            false,
            c => ActivityCalendarEndpoints.List(tripId, c, database, currentUser)
        );

    [McpServerTool(
        Name = "create_calendar_subscription",
        ReadOnly = false,
        Destructive = false,
        Idempotent = false,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Create a personal revocable calendar subscription for the connected trip member. Returns the bearer URL once. Treat it as a credential and show it only for the requested calendar setup, never in diagnostics. Includes saved dated activities, never proposals."
    )]
    public Task<CallToolResult> CreateCalendar(Guid tripId) =>
        adapter.ExecuteAsync(
            true,
            c => ActivityCalendarEndpoints.Create(tripId, c, database, currentUser, options, clock)
        );

    [McpServerTool(
        Name = "revoke_calendar_subscription",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Revoke the connected member's subscription ID. Its bearer URL immediately stops serving the trip. Cannot revoke another member's subscription."
    )]
    public Task<CallToolResult> RevokeCalendar(Guid tripId, Guid subscriptionId) =>
        adapter.ExecuteAsync(
            true,
            c => ActivityCalendarEndpoints.Revoke(tripId, subscriptionId, c, database, currentUser)
        );
}
