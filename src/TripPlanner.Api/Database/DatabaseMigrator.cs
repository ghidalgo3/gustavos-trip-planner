using Npgsql;

namespace TripPlanner.Api.Database;

public sealed class DatabaseMigrator(NpgsqlDataSource dataSource, ILogger<DatabaseMigrator> logger)
    : IDatabaseMigrator
{
    public async Task MigrateAsync(CancellationToken cancellationToken = default)
    {
        Migration[] migrations = await LoadMigrationsAsync(cancellationToken);
        await using NpgsqlConnection connection = await dataSource.OpenConnectionAsync(
            cancellationToken
        );
        await using NpgsqlTransaction transaction = await connection.BeginTransactionAsync(
            cancellationToken
        );

        await ExecuteAsync(
            connection,
            transaction,
            """
            CREATE SCHEMA IF NOT EXISTS gustavo_planner;
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_roles WHERE rolname = 'gustavo_planner_contributor'
                ) THEN
                    ALTER SCHEMA gustavo_planner OWNER TO gustavo_planner_contributor;
                END IF;
            END;
            $$;
            SET LOCAL search_path TO gustavo_planner, public;
            """,
            cancellationToken
        );

        await ExecuteAsync(
            connection,
            transaction,
            "SELECT pg_advisory_xact_lock(1937003881);",
            cancellationToken
        );
        await ExecuteAsync(
            connection,
            transaction,
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version bigint PRIMARY KEY,
                name text NOT NULL,
                applied_at timestamptz NOT NULL DEFAULT now()
            );
            """,
            cancellationToken
        );

        foreach (Migration migration in migrations)
        {
            await using var appliedCommand = new NpgsqlCommand(
                "SELECT name FROM schema_migrations WHERE version = $1;",
                connection,
                transaction
            );
            appliedCommand.Parameters.AddWithValue(migration.Version);
            object? appliedName = await appliedCommand.ExecuteScalarAsync(cancellationToken);
            if (appliedName is string name)
            {
                if (!StringComparer.Ordinal.Equals(name, migration.Name))
                {
                    throw new InvalidOperationException(
                        $"Database migration version {migration.Version} was applied as "
                            + $"'{name}', but the current file is '{migration.Name}'."
                    );
                }

                continue;
            }

            logger.LogInformation(
                "Applying database migration {Version}: {Name}",
                migration.Version,
                migration.Name
            );
            await ExecuteAsync(connection, transaction, migration.Sql, cancellationToken);

            await using var recordCommand = new NpgsqlCommand(
                "INSERT INTO schema_migrations (version, name) VALUES ($1, $2);",
                connection,
                transaction
            );
            recordCommand.Parameters.AddWithValue(migration.Version);
            recordCommand.Parameters.AddWithValue(migration.Name);
            await recordCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        // DROP SCHEMA removes both table grants and schema-scoped default
        // privileges. Restore contributor access whenever startup recreates it.
        await ExecuteAsync(
            connection,
            transaction,
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_roles WHERE rolname = 'gustavo_planner_contributor'
                ) THEN
                    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
                        ON ALL TABLES IN SCHEMA gustavo_planner
                        TO gustavo_planner_contributor;
                    GRANT USAGE, SELECT, UPDATE
                        ON ALL SEQUENCES IN SCHEMA gustavo_planner
                        TO gustavo_planner_contributor;
                    ALTER DEFAULT PRIVILEGES IN SCHEMA gustavo_planner
                        GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
                        ON TABLES TO gustavo_planner_contributor;
                    ALTER DEFAULT PRIVILEGES IN SCHEMA gustavo_planner
                        GRANT USAGE, SELECT, UPDATE
                        ON SEQUENCES TO gustavo_planner_contributor;
                END IF;
            END;
            $$;
            """,
            cancellationToken
        );

        await transaction.CommitAsync(cancellationToken);
    }

    private static async Task<Migration[]> LoadMigrationsAsync(CancellationToken cancellationToken)
    {
        string migrationsDirectory = Path.Combine(AppContext.BaseDirectory, "migrations");
        if (!Directory.Exists(migrationsDirectory))
        {
            throw new DirectoryNotFoundException(
                $"Database migrations directory was not found: {migrationsDirectory}"
            );
        }

        string[] paths = Directory.GetFiles(
            migrationsDirectory,
            "*.sql",
            SearchOption.TopDirectoryOnly
        );
        var migrations = new List<Migration>(paths.Length);
        foreach (string path in paths.OrderBy(Path.GetFileName, StringComparer.Ordinal))
        {
            string fileName = Path.GetFileName(path);
            int separatorIndex = fileName.IndexOf('_');
            if (
                separatorIndex != 4
                || !long.TryParse(fileName.AsSpan(0, separatorIndex), out long version)
                || !fileName.EndsWith(".sql", StringComparison.Ordinal)
                || fileName.Length <= separatorIndex + 1 + ".sql".Length
            )
            {
                throw new InvalidOperationException(
                    $"Migration filename '{fileName}' must match 0001_MigrationName.sql."
                );
            }

            string sql = await File.ReadAllTextAsync(path, cancellationToken);
            migrations.Add(new Migration(version, fileName, sql));
        }

        long[] duplicateVersions = migrations
            .GroupBy(migration => migration.Version)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToArray();
        if (duplicateVersions.Length > 0)
        {
            throw new InvalidOperationException(
                $"Duplicate database migration versions: {string.Join(", ", duplicateVersions)}."
            );
        }

        return migrations.ToArray();
    }

    private static async Task ExecuteAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string sql,
        CancellationToken cancellationToken
    )
    {
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private sealed record Migration(long Version, string Name, string Sql);
}
