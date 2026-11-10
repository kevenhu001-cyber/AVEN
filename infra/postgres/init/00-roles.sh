#!/usr/bin/env bash
set -Eeuo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${AVEN_MIGRATOR_PASSWORD:?AVEN_MIGRATOR_PASSWORD is required}"
: "${AVEN_APP_PASSWORD:?AVEN_APP_PASSWORD is required}"
: "${AVEN_WORKER_PASSWORD:?AVEN_WORKER_PASSWORD is required}"
: "${AVEN_AUTH_PASSWORD:?AVEN_AUTH_PASSWORD is required}"

# Roles are cluster-wide. Passwords come from the local .env file and are never
# committed. The application roles receive no DDL, no BYPASSRLS, and no role
# membership that could be escalated with SET ROLE.
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname postgres \
  -v migrator_password="$AVEN_MIGRATOR_PASSWORD" \
  -v app_password="$AVEN_APP_PASSWORD" \
  -v worker_password="$AVEN_WORKER_PASSWORD" \
  -v auth_password="$AVEN_AUTH_PASSWORD" \
  -v db_name="$POSTGRES_DB" <<'SQL'
SELECT 'CREATE ROLE aven_migrator LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aven_migrator');
\gexec
ALTER ROLE aven_migrator WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'migrator_password';

SELECT 'CREATE ROLE aven_app LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aven_app');
\gexec
ALTER ROLE aven_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'app_password';

SELECT 'CREATE ROLE aven_worker LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aven_worker');
\gexec
ALTER ROLE aven_worker WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'worker_password';

SELECT 'CREATE ROLE aven_auth LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aven_auth');
\gexec
ALTER ROLE aven_auth WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'auth_password';

SELECT 'CREATE ROLE aven_function_owner NOLOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aven_function_owner');
\gexec
ALTER ROLE aven_function_owner WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- The migration role may transfer function ownership to the NOLOGIN function
-- owner. Runtime roles must not be members of any other aven role.
GRANT aven_function_owner TO aven_migrator;

SELECT 'CREATE DATABASE aven_test OWNER aven_migrator'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'aven_test');
\gexec

ALTER DATABASE :"db_name" OWNER TO aven_migrator;
ALTER DATABASE aven_test OWNER TO aven_migrator;

REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
REVOKE ALL ON DATABASE aven_test FROM PUBLIC;
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
REVOKE ALL ON DATABASE template1 FROM PUBLIC;

GRANT CONNECT ON DATABASE :"db_name" TO aven_migrator, aven_app, aven_worker, aven_auth;
GRANT CONNECT ON DATABASE aven_test TO aven_migrator, aven_app, aven_worker, aven_auth;
GRANT CONNECT ON DATABASE postgres TO aven_migrator;
GRANT TEMPORARY ON DATABASE :"db_name" TO aven_migrator;
GRANT TEMPORARY ON DATABASE aven_test TO aven_migrator;
SQL

for db in "$POSTGRES_DB" aven_test; do
  psql -v ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname "$db" <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO aven_migrator;
GRANT USAGE ON SCHEMA public TO aven_app, aven_worker, aven_auth, aven_function_owner;
SQL
done
