-- Readiness must verify the applied schema version without using the migration
-- role. Only version metadata is exposed; checksums and execution times are not
-- needed by the application but are harmless to read.
GRANT SELECT ON app.schema_migrations TO aven_app, aven_worker;
