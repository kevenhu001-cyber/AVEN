-- M2-04: force RLS for every table that carries tenant/user data. The
-- migration role is the only explicit exception so seed and maintenance can
-- still run; runtime roles remain subject to their existing policies.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('public', 'principals'),
      ('public', 'users'),
      ('public', 'user_private'),
      ('public', 'credentials'),
      ('public', 'sessions'),
      ('public', 'email_verification_tokens'),
      ('public', 'password_reset_tokens'),
      ('public', 'campuses'),
      ('public', 'campus_memberships'),
      ('public', 'organizations'),
      ('public', 'organization_memberships'),
      ('public', 'organization_invitations'),
      ('public', 'platform_role_assignments'),
      ('public', 'outbox_events'),
      ('public', 'job_receipts'),
      ('app', 'sample_tasks'),
      ('app', 'sample_task_results'),
      ('app', 'sample_external_effects')
    ) AS t(schema_name, table_name)
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR ALL TO aven_migrator USING (true) WITH CHECK (true)',
      item.table_name || '_migrator_all',
      item.schema_name,
      item.table_name
    );
    EXECUTE format(
      'ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
      item.schema_name,
      item.table_name
    );
  END LOOP;
END;
$$;
