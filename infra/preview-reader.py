import os

import psycopg
from psycopg import sql

reader = os.environ["READER_NAME"]
slot = os.environ["SLOT_NAME"]
production_role = sql.Identifier(os.environ["PRODUCTION_ROLE"])
owner = "tripplanner_preview_owner"
template = "tripplanner_preview_template"


with psycopg.connect(dbname="postgres", autocommit=True) as connection:
    for name, oid in ((reader, os.environ["READER_PRINCIPAL_ID"]),
                      (slot, os.environ["SLOT_PRINCIPAL_ID"])):
        if connection.execute("SELECT FROM pg_roles WHERE rolname = %s", (name,)).fetchone() is None:
            connection.execute(
                "SELECT pgaadauth_create_principal_with_oid(%s, %s, 'service', false, false)",
                (name, oid),
            )
    connection.execute(sql.SQL("ALTER ROLE {} CREATEDB").format(sql.Identifier(reader)))
    if connection.execute("SELECT FROM pg_roles WHERE rolname = %s", (owner,)).fetchone() is None:
        connection.execute(sql.SQL("CREATE ROLE {} NOLOGIN").format(sql.Identifier(owner)))
    for name in (reader, slot):
        connection.execute(sql.SQL("GRANT {} TO {} WITH INHERIT TRUE, SET TRUE").format(
            sql.Identifier(owner), sql.Identifier(name)
        ))

    allow_connections = connection.execute(
        "SELECT datallowconn FROM pg_database WHERE datname = %s", (template,)
    ).fetchone()
    if allow_connections is None:
        connection.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(template)))
        connection.execute(sql.SQL("REVOKE CONNECT ON DATABASE {} FROM PUBLIC").format(sql.Identifier(template)))
    if allow_connections is None or allow_connections[0]:
        with psycopg.connect(dbname=template) as template_connection:
            template_connection.execute("CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public")
        connection.execute(sql.SQL("ALTER DATABASE {} WITH IS_TEMPLATE TRUE ALLOW_CONNECTIONS FALSE").format(
            sql.Identifier(template)
        ))

with psycopg.connect(dbname="tripplanner") as connection:
    slot_can_modify_production = connection.execute(
        """
        SELECT has_schema_privilege(%s, 'gustavo_planner', 'USAGE,CREATE')
            OR has_schema_privilege(%s, 'public', 'CREATE')
            OR has_database_privilege(%s, current_database(), 'CREATE')
        """,
        (slot, slot, slot),
    ).fetchone()[0]
    if slot_can_modify_production:
        raise RuntimeError("The preview slot role has access to production objects.")

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
          AND CASE
            WHEN c.relkind IN ('r', 'p', 'm') THEN NOT has_table_privilege(%s, c.oid, 'SELECT')
            WHEN c.relkind = 'S' THEN NOT has_sequence_privilege(%s, c.oid, 'SELECT')
            ELSE false
          END
        """,
        (reader, reader),
    ).fetchall()
    if inaccessible:
        raise RuntimeError(f"Preview copy role cannot read: {inaccessible}")
