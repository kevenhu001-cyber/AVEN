-- P2P-03: clear private copies while preserving invitation/idempotency metadata.
ALTER TABLE public.connection_previews ADD COLUMN purged_at timestamptz;
ALTER TABLE public.connection_previews ADD CONSTRAINT chk_connection_preview_purged
  CHECK (purged_at IS NULL OR manifest = '[]'::jsonb);
CREATE INDEX idx_connection_previews_retention ON public.connection_previews(expires_at,id)
  WHERE purged_at IS NULL;
ALTER TABLE public.consent_grant_items ADD COLUMN invalidated_at timestamptz;
CREATE INDEX idx_connection_items_retention ON public.consent_grant_items(invalidated_at,id)
  WHERE purged_at IS NULL AND invalidated_at IS NOT NULL;

-- Unknown historical stale times start here rather than inventing an earlier time.
UPDATE public.consent_grant_items s SET invalidated_at = CASE
  WHEN g.status='revoked' THEN least(g.revoked_at, g.expires_at, clock_timestamp())
  WHEN g.expires_at<=clock_timestamp() THEN g.expires_at
  ELSE clock_timestamp() END
FROM public.consent_grants g
WHERE s.grant_id=g.id AND g.purpose='connection_invitation' AND s.status<>'active';

CREATE FUNCTION app.guard_connection_item_retention() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.consent_grants WHERE id=OLD.grant_id AND purpose='connection_invitation') THEN RETURN NEW; END IF;
  IF (NEW.grant_id,NEW.source_type,NEW.source_id,NEW.source_version,NEW.policy_version,NEW.field_key)
    IS DISTINCT FROM (OLD.grant_id,OLD.source_type,OLD.source_id,OLD.source_version,OLD.policy_version,OLD.field_key) THEN
    RAISE EXCEPTION 'connection snapshot identity is immutable' USING ERRCODE='22023'; END IF;
  IF OLD.status<>'active' AND NEW.status='active' THEN
    RAISE EXCEPTION 'connection snapshot cannot reactivate' USING ERRCODE='22023'; END IF;
  IF OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at THEN
    RAISE EXCEPTION 'connection invalidation time is immutable' USING ERRCODE='22023'; END IF;
  IF NEW.status<>'active' THEN NEW.invalidated_at:=coalesce(NEW.invalidated_at,clock_timestamp()); END IF;
  IF OLD.purged_at IS NOT NULL AND NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN
    RAISE EXCEPTION 'connection purge is irreversible' USING ERRCODE='22023'; END IF;
  IF NEW.value_snapshot IS DISTINCT FROM OLD.value_snapshot OR NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN
    IF OLD.purged_at IS NOT NULL OR NEW.purged_at IS NULL OR NEW.value_snapshot<>'null'::jsonb
      OR NEW.status='active' OR NEW.invalidated_at IS NULL
      OR NEW.invalidated_at>clock_timestamp()-interval '30 days' THEN
      RAISE EXCEPTION 'connection snapshot can only be cleared after retention' USING ERRCODE='22023'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_connection_item_retention BEFORE UPDATE ON public.consent_grant_items
  FOR EACH ROW EXECUTE FUNCTION app.guard_connection_item_retention();

CREATE FUNCTION app.guard_connection_preview_retention() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF OLD.purged_at IS NOT NULL AND (NEW.manifest IS DISTINCT FROM OLD.manifest OR NEW.purged_at IS DISTINCT FROM OLD.purged_at) THEN
    RAISE EXCEPTION 'connection preview purge is irreversible' USING ERRCODE='22023'; END IF;
  IF NEW.purged_at IS DISTINCT FROM OLD.purged_at AND
    (NEW.purged_at IS NULL OR NEW.manifest<>'[]'::jsonb OR OLD.expires_at>clock_timestamp()-interval '24 hours') THEN
    RAISE EXCEPTION 'connection preview retention has not elapsed' USING ERRCODE='22023'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_connection_preview_retention BEFORE UPDATE ON public.connection_previews
  FOR EACH ROW EXECUTE FUNCTION app.guard_connection_preview_retention();

-- Editing an already elapsed source must not revive an invitation between maintenance runs.
CREATE FUNCTION app.invalidate_elapsed_connection_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF OLD.valid_until IS NOT NULL AND OLD.valid_until<=clock_timestamp() THEN
    UPDATE public.consent_grant_items s SET status='stale',invalidated_at=coalesce(s.invalidated_at,OLD.valid_until)
    FROM public.consent_grants g WHERE s.grant_id=g.id AND g.purpose='connection_invitation'
      AND s.source_type='memory_item' AND s.source_id=OLD.id AND s.status='active';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_connection_elapsed_source BEFORE UPDATE ON public.memory_items
  FOR EACH ROW EXECUTE FUNCTION app.invalidate_elapsed_connection_source();

CREATE FUNCTION app.maintain_personal_connections(p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  v_now timestamptz:=clock_timestamp(); v_row record;
  v_previews integer:=0; v_invalidated integer:=0; v_purged integer:=0;
BEGIN
  IF session_user<>'aven_worker' THEN RAISE EXCEPTION 'worker session required' USING ERRCODE='42501'; END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'invalid maintenance batch size' USING ERRCODE='22023'; END IF;

  FOR v_row IN SELECT id FROM public.connection_previews
    WHERE purged_at IS NULL AND expires_at<=v_now-interval '24 hours'
    ORDER BY expires_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.connection_previews SET manifest='[]'::jsonb,purged_at=v_now WHERE id=v_row.id;
    v_previews:=v_previews+1;
  END LOOP;

  FOR v_row IN
    SELECT s.id,g.status AS grant_status,g.expires_at,g.revoked_at,m.valid_until
    FROM public.consent_grant_items s JOIN public.consent_grants g ON g.id=s.grant_id
    LEFT JOIN public.memory_items m ON m.id=s.source_id AND m.owner_principal_id=g.grantor_principal_id
    LEFT JOIN public.context_field_policies p ON p.source_id=m.id AND p.source_type='memory_item'
      AND p.field_key='content' AND p.owner_principal_id=g.grantor_principal_id
    WHERE g.purpose='connection_invitation' AND s.status='active' AND s.purged_at IS NULL AND (
      g.status<>'active' OR g.expires_at<=v_now OR m.id IS NULL OR m.status<>'confirmed'
      OR m.deleted_at IS NOT NULL OR m.valid_until<=v_now OR p.id IS NULL OR NOT('sharing'=ANY(p.allowed_uses))
      OR (SELECT count(*) FROM public.principals x WHERE x.id IN(g.grantor_principal_id,g.grantee_principal_id)
        AND x.type='user' AND x.status='active')<>2
    )
    ORDER BY s.id LIMIT p_limit FOR UPDATE OF s SKIP LOCKED
  LOOP
    UPDATE public.consent_grant_items SET
      status=CASE WHEN v_row.grant_status='revoked' THEN 'revoked'::public.consent_item_status
        WHEN v_row.expires_at<=v_now THEN 'expired'::public.consent_item_status ELSE 'stale'::public.consent_item_status END,
      invalidated_at=least(v_now,v_row.revoked_at,v_row.expires_at,
        CASE WHEN v_row.valid_until<=v_now THEN v_row.valid_until END)
      WHERE id=v_row.id;
    v_invalidated:=v_invalidated+1;
  END LOOP;

  FOR v_row IN SELECT s.id,s.grant_id FROM public.consent_grant_items s
    JOIN public.consent_grants g ON g.id=s.grant_id
    WHERE g.purpose='connection_invitation' AND s.status<>'active' AND s.purged_at IS NULL
      AND s.invalidated_at<=v_now-interval '30 days'
    ORDER BY s.invalidated_at,s.id LIMIT p_limit FOR UPDATE OF s SKIP LOCKED
  LOOP
    UPDATE public.consent_grant_items SET value_snapshot='null'::jsonb,purged_at=v_now WHERE id=v_row.id;
    INSERT INTO public.consent_events(grant_id,event_type,actor_principal_id,metadata)
      VALUES(v_row.grant_id,'purged',NULL,jsonb_build_object('kind','connection_invitation','itemId',v_row.id,'reason','retention_elapsed'));
    v_purged:=v_purged+1;
  END LOOP;
  RETURN jsonb_build_object('previewsPurged',v_previews,'itemsInvalidated',v_invalidated,'snapshotsPurged',v_purged);
END $$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.guard_connection_item_retention() OWNER TO aven_function_owner;
ALTER FUNCTION app.guard_connection_preview_retention() OWNER TO aven_function_owner;
ALTER FUNCTION app.invalidate_elapsed_connection_source() OWNER TO aven_function_owner;
ALTER FUNCTION app.maintain_personal_connections(integer) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;
REVOKE ALL ON FUNCTION app.guard_connection_item_retention(),app.guard_connection_preview_retention(),
  app.invalidate_elapsed_connection_source(),app.maintain_personal_connections(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.maintain_personal_connections(integer) TO aven_worker;
