using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;

namespace TripPlanner.Api.Database;

public sealed partial class PostgresPlannerDb
{
    private static async Task InvalidateVisitActivityPlanAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        DestinationVisit previous,
        CancellationToken cancellationToken
    )
    {
        var tripId = previous.TripId;
        var cityId = previous.CityId;
        StoredActivityPlan saved;
        await using (
            var read = new NpgsqlCommand(
                "SELECT plan::text,assessment::text,version,input_revision,saved_at FROM activity_plans WHERE trip_id=$1 AND city_id=$2 FOR UPDATE;",
                connection,
                transaction
            )
        )
        {
            read.Parameters.AddWithValue(tripId);
            read.Parameters.AddWithValue(cityId);
            await using var reader = await read.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                return;
            }
            saved = new(
                PlanningRead<ActivityPlan>(reader.GetString(0)),
                PlanningRead<ActivityPlanAssessment>(reader.GetString(1)),
                reader.GetInt64(2),
                reader.GetInt64(3),
                reader.GetFieldValue<DateTimeOffset>(4)
            );
        }
        var plan = ActivityPlanRules.InvalidateVisitSchedule(saved.Plan, previous);
        if (PlanningJson(plan) == PlanningJson(saved.Plan))
        {
            return;
        }
        await using var write = new NpgsqlCommand(
            "UPDATE activity_plans SET plan=$3,assessment=$4,version=$5,input_revision=$6,saved_at=$7 WHERE trip_id=$1 AND city_id=$2;",
            connection,
            transaction
        );
        write.Parameters.AddWithValue(tripId);
        write.Parameters.AddWithValue(cityId);
        write.Parameters.AddWithValue(NpgsqlDbType.Jsonb, PlanningJson(plan));
        write.Parameters.AddWithValue(NpgsqlDbType.Jsonb, PlanningJson(saved.Assessment));
        write.Parameters.AddWithValue(saved.Version + 1);
        write.Parameters.AddWithValue(saved.InputRevision);
        write.Parameters.AddWithValue(saved.SavedAt);
        await write.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string PlanningJson<T>(T value) =>
        JsonSerializer.Serialize(value, JsonSerializerOptions.Web);

    private static T PlanningRead<T>(string json) =>
        JsonSerializer.Deserialize<T>(json, JsonSerializerOptions.Web)!;

    private const string PlanningVisible =
        "(t.owner_user_id=$1 OR EXISTS(SELECT 1 FROM parties p WHERE p.trip_id=t.id AND $1=ANY(p.user_ids)))";

    public async Task<long> GetActivityPlanningRevisionAsync(
        Guid userId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            $"SELECT v.revision FROM activity_planning_versions v JOIN trips t ON t.id=v.trip_id WHERE t.id=$2 AND {PlanningVisible}"
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(tripId);
        return await command.ExecuteScalarAsync(cancellationToken) is long revision ? revision : -1;
    }

    public async Task<StoredActivityPreferences> GetActivityPreferencesAsync(
        Guid subjectId,
        string scope,
        string cityId = "",
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            "SELECT preferences::text,version FROM activity_preferences WHERE subject_id=$1 AND scope=$2 AND city_id=$3"
        );
        command.Parameters.AddWithValue(subjectId);
        command.Parameters.AddWithValue(scope);
        command.Parameters.AddWithValue(cityId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new(PlanningRead<ActivityPreferences>(reader.GetString(0)), reader.GetInt64(1))
            : new(new());
    }

    public async Task<StoredActivityPreferences?> SaveActivityPreferencesAsync(
        Guid userId,
        Guid? tripId,
        string scope,
        string cityId,
        ActivityPreferences preferences,
        long expectedVersion,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            INSERT INTO activity_preferences(subject_id,scope,city_id,version,preferences)
            SELECT $2,$3,$4,1,$5 WHERE
                (($3='profile' AND $1=$2 AND EXISTS(SELECT 1 FROM users WHERE id=$1)) OR
                 ($3<>'profile' AND can_plan_trip($2,$1) AND ($3='trip' OR EXISTS(SELECT 1 FROM destination_places WHERE trip_id=$2 AND city_id=$4))))
                AND ($6=0 OR EXISTS(SELECT 1 FROM activity_preferences WHERE subject_id=$2 AND scope=$3 AND city_id=$4))
            ON CONFLICT(subject_id,scope,city_id) DO UPDATE SET version=activity_preferences.version+1,preferences=EXCLUDED.preferences
                WHERE activity_preferences.version=$6
            RETURNING version;
            """
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(scope == "profile" ? userId : tripId!.Value);
        command.Parameters.AddWithValue(scope);
        command.Parameters.AddWithValue(cityId);
        command.Parameters.AddWithValue(NpgsqlDbType.Jsonb, PlanningJson(preferences));
        command.Parameters.AddWithValue(expectedVersion);
        return await command.ExecuteScalarAsync(cancellationToken) is long version
            ? new(preferences, version)
            : null;
    }

    public async Task<StoredActivityPlan?> GetActivityPlanAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            $"SELECT a.plan::text,a.assessment::text,a.version,a.input_revision,a.saved_at FROM activity_plans a JOIN trips t ON t.id=a.trip_id WHERE t.id=$2 AND a.city_id=$3 AND {PlanningVisible}"
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(cityId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new(
                PlanningRead<ActivityPlan>(reader.GetString(0)),
                PlanningRead<ActivityPlanAssessment>(reader.GetString(1)),
                reader.GetInt64(2),
                reader.GetInt64(3),
                reader.GetFieldValue<DateTimeOffset>(4)
            )
            : null;
    }

    public async Task<StoredActivityPlan?> SaveActivityPlanAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        StoredActivityPlan plan,
        long expectedVersion,
        long expectedInputRevision,
        bool preserveTiming = false,
        CancellationToken cancellationToken = default
    )
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await BeginWriteTransactionAsync(
            connection,
            cancellationToken
        );
        await using (
            var guard = new NpgsqlCommand(
                "SELECT revision FROM activity_planning_versions WHERE trip_id=$1 AND can_plan_trip(trip_id,$2) FOR UPDATE",
                connection,
                transaction
            )
        )
        {
            guard.Parameters.AddWithValue(tripId);
            guard.Parameters.AddWithValue(userId);
            if (
                await guard.ExecuteScalarAsync(cancellationToken) is not long revision
                || revision != expectedInputRevision
            )
            {
                return null;
            }
        }
        await using (
            var check = new NpgsqlCommand(
                "SELECT version FROM activity_plans WHERE trip_id=$1 AND city_id=$2 FOR UPDATE",
                connection,
                transaction
            )
        )
        {
            check.Parameters.AddWithValue(tripId);
            check.Parameters.AddWithValue(cityId);
            if (
                (await check.ExecuteScalarAsync(cancellationToken) as long? ?? 0) != expectedVersion
            )
            {
                return null;
            }
        }
        // Full activity properties are preserved; membership is changed in this same transaction.
        if (!preserveTiming)
        {
            await using (
                var states = new NpgsqlCommand(
                    """
                    UPDATE activities SET properties=properties || jsonb_build_object('state',
                        CASE WHEN id=ANY($3) THEN 'Yes' WHEN id=ANY($4) THEN 'No' ELSE 'Maybe' END),updated_at=clock_timestamp()
                    WHERE trip_id=$1 AND city_id=$2 AND properties->>'state' IS DISTINCT FROM
                        CASE WHEN id=ANY($3) THEN 'Yes' WHEN id=ANY($4) THEN 'No'
                            WHEN properties->>'state' IN ('Yes','No') THEN 'Maybe' ELSE properties->>'state' END;
                    """,
                    connection,
                    transaction
                )
            )
            {
                states.Parameters.AddWithValue(tripId);
                states.Parameters.AddWithValue(cityId);
                states.Parameters.AddWithValue(plan.Plan.SelectedActivityIds);
                states.Parameters.AddWithValue(plan.Plan.ExcludedActivityIds);
                await states.ExecuteNonQueryAsync(cancellationToken);
            }
        }
        await using var save = new NpgsqlCommand(
            """
            INSERT INTO activity_plans(trip_id,city_id,version,input_revision,plan,assessment,saved_at)
            SELECT $1,$2,1,CASE WHEN $6 THEN $7 ELSE revision END,$3,$4,$5 FROM activity_planning_versions WHERE trip_id=$1
            ON CONFLICT(trip_id,city_id) DO UPDATE SET version=activity_plans.version+1,input_revision=EXCLUDED.input_revision,
                plan=EXCLUDED.plan,assessment=EXCLUDED.assessment,saved_at=EXCLUDED.saved_at
            RETURNING version,input_revision;
            """,
            connection,
            transaction
        );
        save.Parameters.AddWithValue(tripId);
        save.Parameters.AddWithValue(cityId);
        save.Parameters.AddWithValue(NpgsqlDbType.Jsonb, PlanningJson(plan.Plan));
        save.Parameters.AddWithValue(NpgsqlDbType.Jsonb, PlanningJson(plan.Assessment));
        save.Parameters.AddWithValue(plan.SavedAt);
        save.Parameters.AddWithValue(preserveTiming);
        save.Parameters.AddWithValue(plan.InputRevision);
        StoredActivityPlan saved;
        await using (var reader = await save.ExecuteReaderAsync(cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);
            saved = plan with { Version = reader.GetInt64(0), InputRevision = reader.GetInt64(1) };
        }
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        return saved;
    }

    public async Task<ActivityPlanningEvidence> GetActivityPlanningEvidenceAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            $"SELECT e.evidence::text FROM activity_planning_evidence e JOIN trips t ON t.id=e.trip_id WHERE t.id=$2 AND e.city_id=$3 AND {PlanningVisible}"
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(cityId);
        return await command.ExecuteScalarAsync(cancellationToken) is string json
            ? PlanningRead<ActivityPlanningEvidence>(json)
            : new();
    }

    public async Task<bool> SaveActivityPlanningEvidenceAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        ActivityPlanningEvidence evidence,
        long expectedInputRevision,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            WITH eligible AS (UPDATE activity_planning_versions SET revision=revision WHERE trip_id=$2 AND revision=$5 AND can_plan_trip(trip_id,$1) RETURNING trip_id)
            INSERT INTO activity_planning_evidence(trip_id,city_id,evidence) SELECT trip_id,$3,$4 FROM eligible
            ON CONFLICT(trip_id,city_id) DO UPDATE SET evidence=EXCLUDED.evidence RETURNING true;
            """
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(cityId);
        command.Parameters.AddWithValue(NpgsqlDbType.Jsonb, PlanningJson(evidence));
        command.Parameters.AddWithValue(expectedInputRevision);
        return await command.ExecuteScalarAsync(cancellationToken) is true;
    }

    private const string PlanningJobSelect = """
        SELECT (j.job || jsonb_build_object('result',j.result,'review',j.review,'error',j.error,'leaseId',j.lease_id,
            'leaseExpiresAt',j.lease_expires_at,'attempts',j.attempts,'status',o.status))::text
        FROM activity_plan_jobs j JOIN operations o ON o.id=j.operation_id
        """;

    public async Task<ActivityPlanningJob?> CreateActivityPlanningJobAsync(
        Guid userId,
        Guid tripId,
        ActivityPlanningJob job,
        CancellationToken cancellationToken = default
    )
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await BeginWriteTransactionAsync(
            connection,
            cancellationToken
        );
        await using (
            var create = new NpgsqlCommand(
                """
                WITH eligible AS (SELECT trip_id FROM activity_planning_versions WHERE trip_id=$3 AND revision=$7 AND can_plan_trip(trip_id,$2) FOR UPDATE),
                op AS (INSERT INTO operations(id,user_id,resource_id,type,status,items,completed_items)
                    SELECT $1,$2,$3,$4,$5,1,CASE WHEN $5='Completed' THEN 1 ELSE 0 END FROM eligible ON CONFLICT(id) DO NOTHING RETURNING id)
                INSERT INTO activity_plan_jobs(operation_id,user_id,trip_id,city_id,request_hash,job,result)
                SELECT id,$2,$3,$6,$8,$9,$10 FROM op;
                """,
                connection,
                transaction
            )
        )
        {
            create.Parameters.AddWithValue(job.Id);
            create.Parameters.AddWithValue(userId);
            create.Parameters.AddWithValue(tripId);
            create.Parameters.AddWithValue(
                "activityPlan" + (job.Kind == "assessment" ? "Assessment" : "Proposal")
            );
            create.Parameters.AddWithValue(job.Status);
            create.Parameters.AddWithValue(job.CityId);
            create.Parameters.AddWithValue(job.InputRevision);
            create.Parameters.AddWithValue(job.RequestHash);
            create.Parameters.AddWithValue(NpgsqlDbType.Jsonb, PlanningJson(job));
            create.Parameters.AddWithValue(
                NpgsqlDbType.Jsonb,
                job.Result is null ? DBNull.Value : PlanningJson(job.Result)
            );
            await create.ExecuteNonQueryAsync(cancellationToken);
        }
        await using var existing = new NpgsqlCommand(
            PlanningJobSelect
                + " WHERE j.operation_id=$1 AND j.user_id=$2 AND j.trip_id=$3 AND j.request_hash=$4",
            connection,
            transaction
        );
        existing.Parameters.AddWithValue(job.Id);
        existing.Parameters.AddWithValue(userId);
        existing.Parameters.AddWithValue(tripId);
        existing.Parameters.AddWithValue(job.RequestHash);
        var result = await existing.ExecuteScalarAsync(cancellationToken) as string;
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        return result is null ? null : PlanningRead<ActivityPlanningJob>(result);
    }

    public async Task<ActivityPlanningJob?> GetActivityPlanningJobAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        Guid jobId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            PlanningJobSelect
                + $" JOIN trips t ON t.id=j.trip_id WHERE j.trip_id=$2 AND j.city_id=$3 AND j.operation_id=$4 AND {PlanningVisible}"
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(cityId);
        command.Parameters.AddWithValue(jobId);
        return await command.ExecuteScalarAsync(cancellationToken) is string json
            ? PlanningRead<ActivityPlanningJob>(json)
            : null;
    }

    public async Task<ActivityPlanningJob?> ClaimActivityPlanningJobAsync(
        TimeSpan leaseDuration,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            WITH next AS (SELECT j.operation_id FROM activity_plan_jobs j JOIN operations o ON o.id=j.operation_id
                WHERE o.status IN ('pending','InProgress') AND (j.lease_expires_at IS NULL OR j.lease_expires_at<=now())
                ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED),
            claimed AS (UPDATE activity_plan_jobs j SET lease_id=$1,lease_expires_at=now()+$2,attempts=attempts+1 FROM next n WHERE j.operation_id=n.operation_id RETURNING j.*),
            op AS (UPDATE operations o SET status='InProgress',updated_at=now() FROM claimed j WHERE o.id=j.operation_id RETURNING o.id)
            SELECT (job || jsonb_build_object('leaseId',lease_id,'leaseExpiresAt',lease_expires_at,'attempts',attempts,'status','InProgress','result',result,'review',review))::text FROM claimed;
            """
        );
        command.Parameters.AddWithValue(Guid.NewGuid());
        command.Parameters.AddWithValue(leaseDuration);
        return await command.ExecuteScalarAsync(cancellationToken) is string json
            ? PlanningRead<ActivityPlanningJob>(json)
            : null;
    }

    public async Task<bool> CompleteActivityPlanningJobAsync(
        ActivityPlanningJob job,
        ActivityPlanningResult? result,
        string? error,
        bool finished,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            WITH saved AS (UPDATE activity_plan_jobs j SET result=COALESCE($3,result),error=$4
                WHERE operation_id=$1 AND lease_id=$2 AND lease_expires_at>now()
                AND EXISTS(SELECT 1 FROM operations WHERE id=$1 AND status='InProgress') RETURNING operation_id)
            UPDATE operations o SET status=$5,completed_items=CASE WHEN $5='Completed' THEN 1 ELSE 0 END,
                failed_items=CASE WHEN $5='Failed' THEN 1 ELSE 0 END,updated_at=now() FROM saved s WHERE o.id=s.operation_id RETURNING true;
            """
        );
        command.Parameters.AddWithValue(job.Id);
        command.Parameters.AddWithValue(NpgsqlDbType.Uuid, (object?)job.LeaseId ?? DBNull.Value);
        command.Parameters.AddWithValue(
            NpgsqlDbType.Jsonb,
            result is null ? DBNull.Value : PlanningJson(result)
        );
        command.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)error ?? DBNull.Value);
        command.Parameters.AddWithValue(
            finished
                ? error is null
                    ? "Completed"
                    : "Failed"
                : "InProgress"
        );
        return await command.ExecuteScalarAsync(cancellationToken) is true;
    }

    public async Task<bool> SaveActivityProposalReviewAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        Guid jobId,
        ActivityProposalReview review,
        ActivityProposalReview expectedReview,
        long expectedInputRevision,
        long expectedPlanVersion,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            "WITH guard AS (SELECT trip_id FROM activity_planning_versions WHERE trip_id=$2 AND revision=$7 AND can_plan_trip(trip_id,$1) FOR UPDATE) UPDATE activity_plan_jobs SET review=$5 WHERE operation_id=$4 AND trip_id=$2 AND city_id=$3 AND review=$6 AND EXISTS(SELECT 1 FROM guard) AND COALESCE((SELECT version FROM activity_plans WHERE trip_id=$2 AND city_id=$3),0)=$8 RETURNING true"
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(cityId);
        command.Parameters.AddWithValue(jobId);
        command.Parameters.AddWithValue(NpgsqlDbType.Jsonb, PlanningJson(review));
        command.Parameters.AddWithValue(NpgsqlDbType.Jsonb, PlanningJson(expectedReview));
        command.Parameters.AddWithValue(expectedInputRevision);
        command.Parameters.AddWithValue(expectedPlanVersion);
        return await command.ExecuteScalarAsync(cancellationToken) is true;
    }

    public async Task<string[]> GetDismissedActivitySuggestionsAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        string contextVersion,
        long planVersion,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            $"SELECT j.result::text,j.review::text FROM activity_plan_jobs j JOIN trips t ON t.id=j.trip_id WHERE t.id=$2 AND j.city_id=$3 AND j.result->>'contextVersion'=$4 AND (j.result->>'basePlanVersion')::bigint=$5 AND {PlanningVisible}"
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(cityId);
        command.Parameters.AddWithValue(contextVersion);
        command.Parameters.AddWithValue(planVersion);
        var dismissed = new HashSet<string>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var result = PlanningRead<ActivityPlanningResult>(reader.GetString(0));
            var review = PlanningRead<ActivityProposalReview>(reader.GetString(1));
            foreach (
                var suggestion in result.Suggestions.Where(s =>
                    review.DismissedSuggestionIds.Contains(s.Id)
                )
            )
            {
                dismissed.Add(suggestion.Fingerprint);
            }
        }
        return [.. dismissed];
    }

    private const string CalendarColumns = "id,user_id,trip_id,token_hash,created_at,revoked_at";

    private static ActivityCalendarSubscription ReadCalendar(NpgsqlDataReader reader) =>
        new(
            reader.GetGuid(0),
            reader.GetGuid(1),
            reader.GetGuid(2),
            reader.GetString(3),
            reader.GetFieldValue<DateTimeOffset>(4),
            reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5)
        );

    public async Task<ActivityCalendarSubscription[]> GetActivityCalendarSubscriptionsAsync(
        Guid userId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            $"SELECT {CalendarColumns} FROM activity_calendar_subscriptions WHERE user_id=$1 AND trip_id=$2 ORDER BY created_at"
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(tripId);
        var result = new List<ActivityCalendarSubscription>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(ReadCalendar(reader));
        }

        return [.. result];
    }

    public async Task<ActivityCalendarSubscription?> CreateActivityCalendarSubscriptionAsync(
        Guid userId,
        Guid tripId,
        ActivityCalendarSubscription subscription,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            $"INSERT INTO activity_calendar_subscriptions({CalendarColumns}) SELECT $3,$1,$2,$4,$5,NULL FROM trips t WHERE t.id=$2 AND {PlanningVisible} RETURNING id"
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(subscription.Id);
        command.Parameters.AddWithValue(subscription.TokenHash);
        command.Parameters.AddWithValue(subscription.CreatedAt);
        return await command.ExecuteScalarAsync(cancellationToken) is Guid ? subscription : null;
    }

    public async Task<bool> RevokeActivityCalendarSubscriptionAsync(
        Guid userId,
        Guid tripId,
        Guid subscriptionId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            "UPDATE activity_calendar_subscriptions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND trip_id=$2 AND id=$3 RETURNING true"
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(subscriptionId);
        return await command.ExecuteScalarAsync(cancellationToken) is true;
    }

    public async Task<ActivityCalendarSubscription?> FindActivityCalendarSubscriptionAsync(
        string tokenHash,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            $"SELECT {CalendarColumns} FROM activity_calendar_subscriptions WHERE token_hash=$1 AND revoked_at IS NULL"
        );
        command.Parameters.AddWithValue(tokenHash);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadCalendar(reader) : null;
    }
}
