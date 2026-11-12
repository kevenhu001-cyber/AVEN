-- Assert conservative backfill and preserve both bodies; remove the test rows before seed checks.
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.consent_grant_items s, app.schema_migrations m
    WHERE s.id='99000000-0000-4000-8000-000000000008' AND m.version='0033_connection_retention'
      AND s.invalidated_at>=m.applied_at AND s.purged_at IS NULL AND s.value_snapshot='"开发升级正文"'::jsonb) THEN
    RAISE EXCEPTION 'unknown stale time must start at upgrade without clearing the body'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.consent_grant_items
    WHERE id='99000000-0000-4000-8000-000000000009' AND invalidated_at IS NULL AND purged_at IS NULL
      AND value_snapshot='"开发升级正文"'::jsonb) THEN
    RAISE EXCEPTION 'upgrade must preserve active snapshots'; END IF;
END $$;
BEGIN;
DELETE FROM public.consent_grant_items WHERE grant_id='99000000-0000-4000-8000-000000000004';
DELETE FROM public.connection_invitations WHERE id='99000000-0000-4000-8000-000000000005';
DELETE FROM public.consent_grants WHERE id='99000000-0000-4000-8000-000000000004';
DELETE FROM public.connection_previews WHERE id='99000000-0000-4000-8000-000000000003';
DELETE FROM public.users WHERE id IN('99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002');
DELETE FROM public.principals WHERE id IN('99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002');
COMMIT;
