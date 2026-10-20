#!/bin/sh
# Uruchamiane raz przy inicjalizacji wolumenu bazy.
# migrator = właściciel schematu (tylko krok migrate), app = DML bez superusera i bez ownera
# (dzięki temu RLS z E2 obowiązuje konto aplikacji).
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE migrator LOGIN PASSWORD '${MIGRATOR_DB_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE app LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

REVOKE ALL ON DATABASE ${POSTGRES_DB} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO migrator, app;
GRANT CREATE ON DATABASE ${POSTGRES_DB} TO migrator; -- drizzle tworzy własny schemat z dziennikiem migracji
ALTER SCHEMA public OWNER TO migrator;
GRANT USAGE ON SCHEMA public TO app;

ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app;
SQL
