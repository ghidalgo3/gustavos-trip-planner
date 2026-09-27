import os

import psycopg
from psycopg import sql

connection_options = {
    "host": os.environ["POSTGRES_HOST"],
    "port": 5432,
    "user": os.environ["ADMIN_NAME"],
    "password": os.environ["PGPASSWORD"],
    "sslmode": "require",
}
app_role = os.environ["APP_ROLE"]
contributor_role = os.environ["CONTRIBUTOR_NAME"]
user_role = os.environ["USER_DATABASE_ROLE"]
user_principal_id = os.environ["USER_PRINCIPAL_ID"]

with psycopg.connect(dbname="postgres", **connection_options, autocommit=True) as connection:
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (app_role,))
        if cursor.fetchone() is None:
            cursor.execute(
                "SELECT pgaadauth_create_principal(%s, false, false)", (app_role,)
            )

        cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (user_role,))
        if cursor.fetchone() is None:
            cursor.execute(
                "SELECT pgaadauth_create_principal_with_oid(%s, %s, 'user', false, false)",
                (user_role, user_principal_id),
            )

        cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (contributor_role,))
        if cursor.fetchone() is None:
            cursor.execute(
                sql.SQL("CREATE ROLE {} NOLOGIN").format(sql.Identifier(contributor_role))
            )
        cursor.execute(
            sql.SQL("GRANT CREATE ON DATABASE tripplanner TO {}").format(
                sql.Identifier(contributor_role)
            )
        )

with psycopg.connect(dbname="tripplanner", **connection_options, autocommit=True) as connection:
    with connection.cursor() as cursor:
        cursor.execute(
            sql.SQL("CREATE SCHEMA IF NOT EXISTS gustavo_planner AUTHORIZATION {}").format(
                sql.Identifier(contributor_role)
            )
        )
        cursor.execute(
            sql.SQL("ALTER SCHEMA gustavo_planner OWNER TO {}").format(
                sql.Identifier(contributor_role)
            )
        )
        cursor.execute(
            sql.SQL("GRANT CONNECT ON DATABASE tripplanner TO {}").format(
                sql.Identifier(contributor_role)
            )
        )
        cursor.execute(
            sql.SQL("GRANT USAGE, CREATE ON SCHEMA gustavo_planner TO {}").format(
                sql.Identifier(contributor_role)
            )
        )
        cursor.execute(
            sql.SQL(
                "GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER "
                "ON ALL TABLES IN SCHEMA gustavo_planner TO {}"
            ).format(sql.Identifier(contributor_role))
        )
        cursor.execute(
            sql.SQL("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA gustavo_planner TO {}").format(
                sql.Identifier(contributor_role)
            )
        )
        cursor.execute(
            sql.SQL(
                "ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA gustavo_planner "
                "GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO {}"
            ).format(sql.Identifier(app_role), sql.Identifier(contributor_role))
        )
        cursor.execute(
            sql.SQL(
                "ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA gustavo_planner "
                "GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {}"
            ).format(sql.Identifier(app_role), sql.Identifier(contributor_role))
        )
        cursor.execute(
            sql.SQL("GRANT {} TO {}").format(
                sql.Identifier(contributor_role), sql.Identifier(user_role)
            )
        )

print(f"Granted {contributor_role} to {user_role} on tripplanner.")
