import os

import psycopg
from psycopg import sql

reader = os.environ["READER_NAME"]
principal = os.environ["READER_PRINCIPAL_ID"]
production_role = sql.Identifier(os.environ["PRODUCTION_ROLE"])

with psycopg.connect(dbname="postgres") as connection:
    existing = connection.execute(
        "SELECT 1 FROM pg_roles WHERE rolname = %s", (reader,)
    ).fetchone()
    if existing is None:
        connection.execute(
            "SELECT pgaadauth_create_principal_with_oid(%s, %s, 'service', false, false)",
            (reader, principal),
        )

with psycopg.connect(dbname="tripplanner") as connection:
    for statement in (
        "GRANT CONNECT ON DATABASE tripplanner TO {reader}",
        "GRANT USAGE ON SCHEMA gustavo_planner TO {reader}",
        "GRANT SELECT ON ALL TABLES IN SCHEMA gustavo_planner TO {reader}",
        "GRANT SELECT ON ALL SEQUENCES IN SCHEMA gustavo_planner TO {reader}",
        "ALTER DEFAULT PRIVILEGES FOR ROLE {app} IN SCHEMA gustavo_planner "
        "GRANT SELECT ON TABLES TO {reader}",
        "ALTER DEFAULT PRIVILEGES FOR ROLE {app} IN SCHEMA gustavo_planner "
        "GRANT SELECT ON SEQUENCES TO {reader}",
    ):
        connection.execute(
            sql.SQL(statement).format(reader=sql.Identifier(reader), app=production_role)
        )

    # PostgreSQL can grant fewer privileges with a warning. Verify the copy
    # account can actually read every existing table and sequence.
    inaccessible = connection.execute(
        """
        SELECT c.relname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'gustavo_planner'
          AND ((c.relkind IN ('r', 'p', 'm') AND NOT has_table_privilege(%s, c.oid, 'SELECT'))
            OR (c.relkind = 'S' AND NOT has_sequence_privilege(%s, c.oid, 'SELECT')))
        """,
        (reader, reader),
    ).fetchall()
    if inaccessible:
        raise RuntimeError(f"Preview copy role cannot read: {inaccessible}")
