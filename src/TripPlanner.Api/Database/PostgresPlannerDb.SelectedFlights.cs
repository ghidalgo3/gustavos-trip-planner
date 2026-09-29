using System.Text.Json;
using NpgsqlTypes;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public sealed partial class PostgresPlannerDb
{
    public async Task<IReadOnlyList<FlightChoiceProgress>> GetFlightChoicesAsync(
        Guid viewerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT t.flight_choices::text FROM trips t
            WHERE t.id = $1 AND (
                t.owner_user_id = $2 OR EXISTS (
                    SELECT 1 FROM parties p
                    WHERE p.trip_id = t.id AND $2 = ANY(p.user_ids)
                )
            );
            """
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(viewerUserId);
        string? json = (string?)await command.ExecuteScalarAsync(cancellationToken);
        return json is null
            ? []
            : JsonSerializer
                .Deserialize<Dictionary<string, FlightChoiceProgress>>(
                    json,
                    JsonSerializerOptions.Web
                )
                ?.Values.OrderBy(c => c.PartyId)
                .ToArray()
                ?? [];
    }

    public async Task<FlightChoiceProgress> SetFlightChoicesAsync(
        Guid ownerUserId,
        Guid tripId,
        FlightChoiceProgress choices,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            UPDATE trips t SET
                flight_choices = jsonb_set(flight_choices, ARRAY[$1::text], $2::jsonb, true),
                updated_at = now()
            WHERE t.id = $3 AND t.owner_user_id = $4
                AND EXISTS (SELECT 1 FROM parties p WHERE p.id = $5 AND p.trip_id = t.id)
            RETURNING (flight_choices ->> $1);
            """
        );
        command.Parameters.AddWithValue(choices.PartyId.ToString("D"));
        command.Parameters.AddWithValue(
            NpgsqlDbType.Jsonb,
            JsonSerializer.Serialize(choices, JsonSerializerOptions.Web)
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(ownerUserId);
        command.Parameters.AddWithValue(choices.PartyId);
        string? json = (string?)await command.ExecuteScalarAsync(cancellationToken);
        return json is null
            ? throw new InvalidOperationException("The party does not belong to this trip.")
            : JsonSerializer.Deserialize<FlightChoiceProgress>(json, JsonSerializerOptions.Web)!;
    }

    public async Task<IReadOnlyList<SelectedFlight>> GetSelectedFlightsAsync(
        Guid viewerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT t.selected_flights::text FROM trips t
            WHERE t.id = $1 AND (
                t.owner_user_id = $2 OR EXISTS (
                    SELECT 1 FROM parties p
                    WHERE p.trip_id = t.id AND $2 = ANY(p.user_ids)
                )
            );
            """
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(viewerUserId);
        string? json = (string?)await command.ExecuteScalarAsync(cancellationToken);
        return json is null
            ? []
            : JsonSerializer
                .Deserialize<Dictionary<string, SelectedFlight>>(json, JsonSerializerOptions.Web)
                ?.Values.OrderBy(f => f.PartyId)
                .ToArray()
                ?? [];
    }

    public async Task<SelectedFlight> SetSelectedFlightAsync(
        Guid ownerUserId,
        SelectedFlight selectedFlight,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            UPDATE trips t SET
                selected_flights = jsonb_set(selected_flights, ARRAY[$1::text], $2::jsonb, true),
                updated_at = now()
            WHERE t.id = $3 AND t.owner_user_id = $4
                AND EXISTS (SELECT 1 FROM parties p WHERE p.id = $5 AND p.trip_id = t.id)
            RETURNING (selected_flights ->> $1);
            """
        );
        command.Parameters.AddWithValue(selectedFlight.PartyId.ToString("D"));
        command.Parameters.AddWithValue(
            NpgsqlDbType.Jsonb,
            JsonSerializer.Serialize(selectedFlight, JsonSerializerOptions.Web)
        );
        command.Parameters.AddWithValue(selectedFlight.TripId);
        command.Parameters.AddWithValue(ownerUserId);
        command.Parameters.AddWithValue(selectedFlight.PartyId);
        string? json = (string?)await command.ExecuteScalarAsync(cancellationToken);
        return json is null
            ? throw new InvalidOperationException("The party does not belong to this trip.")
            : JsonSerializer.Deserialize<SelectedFlight>(json, JsonSerializerOptions.Web)!;
    }

    public async Task DeleteSelectedFlightAsync(
        Guid ownerUserId,
        Guid tripId,
        Guid partyId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            UPDATE trips
            SET selected_flights = selected_flights - $1, updated_at = now()
            WHERE id = $2 AND owner_user_id = $3 AND selected_flights ? $1;
            """
        );
        command.Parameters.AddWithValue(partyId.ToString("D"));
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(ownerUserId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
