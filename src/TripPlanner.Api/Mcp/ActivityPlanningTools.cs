using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Endpoints;
using TripPlanner.Api.Instructions;
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
    [Description(McpInstructions.Tools.GetActivityPreferences)]
    public Task<CallToolResult> GetPreferences(
        ActivityPreferenceScope scope,
        Guid? tripId = null,
        [StringLength(200), Description(McpInstructions.Fields.PlanningDestination)]
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
    [Description(McpInstructions.Tools.ReplaceActivityPreferences)]
    public Task<CallToolResult> ReplacePreferences(
        ActivityPreferenceScope scope,
        ActivityPreferencesRequest request,
        string etag,
        Guid? tripId = null,
        [StringLength(200), Description(McpInstructions.Fields.PlanningDestination)]
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
    [Description(McpInstructions.Tools.GetActivityPlan)]
    public Task<CallToolResult> GetPlan(
        Guid tripId,
        [Required, StringLength(200), Description(McpInstructions.Fields.PlanningDestination)]
            string destinationCity
    ) =>
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
    [Description(McpInstructions.Tools.PreviewActivityPlan)]
    public Task<CallToolResult> PreviewPlan(
        Guid tripId,
        [Required, StringLength(200), Description(McpInstructions.Fields.PlanningDestination)]
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
    [Description(McpInstructions.Tools.ReplaceActivityPlan)]
    public Task<CallToolResult> ReplacePlan(
        Guid tripId,
        [Required, StringLength(200), Description(McpInstructions.Fields.PlanningDestination)]
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
    [Description(McpInstructions.Tools.CreateActivityPlanAssessment)]
    public Task<CallToolResult> CreateAssessment(
        Guid tripId,
        [Required, StringLength(200), Description(McpInstructions.Fields.PlanningDestination)]
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
    [Description(McpInstructions.Tools.GetActivityPlanAssessment)]
    public Task<CallToolResult> GetAssessment(
        Guid tripId,
        [Required, StringLength(200), Description(McpInstructions.Fields.PlanningDestination)]
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
    [Description(McpInstructions.Tools.CreateActivityPlanProposal)]
    public Task<CallToolResult> CreateProposal(
        Guid tripId,
        [Required, StringLength(200), Description(McpInstructions.Fields.PlanningDestination)]
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
    [Description(McpInstructions.Tools.GetActivityPlanProposal)]
    public Task<CallToolResult> GetProposal(
        Guid tripId,
        [Required, StringLength(200), Description(McpInstructions.Fields.PlanningDestination)]
            string destinationCity,
        Guid proposalId
    ) =>
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
    [Description(McpInstructions.Tools.ReplaceActivityPlanProposalReview)]
    public Task<CallToolResult> ReplaceReview(
        Guid tripId,
        [Required, StringLength(200), Description(McpInstructions.Fields.PlanningDestination)]
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
    [Description(McpInstructions.Tools.ListOperations)]
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
    [Description(McpInstructions.Tools.GetOperation)]
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
    [Description(McpInstructions.Tools.ListCalendarSubscriptions)]
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
    [Description(McpInstructions.Tools.CreateCalendarSubscription)]
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
    [Description(McpInstructions.Tools.RevokeCalendarSubscription)]
    public Task<CallToolResult> RevokeCalendar(Guid tripId, Guid subscriptionId) =>
        adapter.ExecuteAsync(
            true,
            c => ActivityCalendarEndpoints.Revoke(tripId, subscriptionId, c, database, currentUser)
        );
}
