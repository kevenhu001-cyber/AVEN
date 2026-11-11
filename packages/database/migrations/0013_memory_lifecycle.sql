-- M3-03: memory lifecycle.
-- Adds append-only, metadata-only memory events; due-memory expiration; and
-- retention purges for deleted memories and old events.

CREATE TYPE public.memory_event_type AS ENUM (
  'created', 'candidate_created', 'confirmed', 'rejected',
  'updated', 'expired', 'deleted', 'purged'
);

CREATE TABLE public.memory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_item_id uuid NOT NULL,
  owner_principal_id uuid NOT NULL REFERENCES public.principals (id) ON DELETE CASCADE,
  event_type public.memory_event_type NOT NULL,
  actor_type text NOT NULL DEFAULT 'user',
  actor_principal_id uuid,
  from_status public.memory_status,
  to_status public.memory_status,
  version integer NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_memory_event_actor_type CHECK (actor_type IN ('user', 'system')),
  CONSTRAINT chk_memory_event_version CHECK (version >= 1),
  CONSTRAINT chk_memory_event_metadata CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX idx_memory_events_memory ON public.memory_events (memory_item_id, created_at DESC);
CREATE INDEX idx_memory_events_owner ON public.memory_events (owner_principal_id, created_at DESC);
CREATE INDEX idx_memory_events_created ON public.memory_events (created_at);

CREATE OR REPLACE FUNCTION app.enforce_memory_event_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  IF NEW.metadata - ARRAY[
       'sourceType', 'allowedUses', 'displayAudience',
       'changedFields', 'reason', 'retentionDays'
     ] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'memory event metadata contains unsupported keys'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_memory_events_metadata
BEFORE INSERT OR UPDATE ON public.memory_events
FOR EACH ROW EXECUTE FUNCTION app.enforce_memory_event_metadata();

ALTER TABLE public.memory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_events FORCE ROW LEVEL SECURITY;

CREATE POLICY memory_events_owner_select ON public.memory_events
FOR SELECT TO aven_app
USING (owner_principal_id = app.current_principal_id());
CREATE POLICY memory_events_function_all ON public.memory_events
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY memory_events_migrator_all ON public.memory_events
FOR ALL TO aven_migrator USING (true) WITH CHECK (true);

GRANT SELECT ON public.memory_events TO aven_app;
GRANT SELECT, INSERT, DELETE ON public.memory_events TO aven_function_owner;
GRANT DELETE ON public.memory_items TO aven_function_owner;
GRANT DELETE ON public.context_field_policies TO aven_function_owner;

-- The trigger records metadata only. It never copies title, content, structured
-- values, or source excerpts into the audit table.
CREATE OR REPLACE FUNCTION app.audit_memory_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_actor uuid := app.current_user_id();
  v_actor_type text := CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END;
  v_event_type public.memory_event_type;
  v_from_status public.memory_status;
  v_to_status public.memory_status;
  v_metadata jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_from_status := NULL;
    v_to_status := NEW.status;
    v_event_type := CASE NEW.status
      WHEN 'confirmed' THEN 'created'
      WHEN 'pending_confirmation' THEN 'candidate_created'
      WHEN 'rejected' THEN 'rejected'
      WHEN 'expired' THEN 'expired'
      WHEN 'deleted' THEN 'deleted'
    END;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = OLD.status AND NEW.version = OLD.version THEN
      RETURN NEW;
    END IF;
    v_from_status := OLD.status;
    v_to_status := NEW.status;
    IF OLD.status = 'pending_confirmation' AND NEW.status = 'confirmed' THEN
      v_event_type := 'confirmed';
    ELSIF OLD.status = 'pending_confirmation' AND NEW.status = 'rejected' THEN
      v_event_type := 'rejected';
      v_metadata := jsonb_build_object('reason', 'user_rejected');
    ELSIF OLD.status = 'confirmed' AND NEW.status = 'expired' THEN
      v_event_type := 'expired';
      v_metadata := jsonb_build_object('reason', 'valid_until_elapsed');
    ELSIF NEW.status = 'deleted' AND OLD.status <> 'deleted' THEN
      v_event_type := 'deleted';
      v_metadata := jsonb_build_object(
        'reason',
        CASE WHEN v_actor_type = 'user' THEN 'user_deleted' ELSE 'system_deleted' END
      );
    ELSE
      v_event_type := 'updated';
      v_metadata := jsonb_build_object('reason', 'version_changed');
    END IF;
  ELSE
    v_from_status := OLD.status;
    v_to_status := NULL;
    v_event_type := 'purged';
    v_metadata := jsonb_build_object('reason', 'retention_elapsed');
  END IF;

  INSERT INTO public.memory_events
    (memory_item_id, owner_principal_id, event_type, actor_type, actor_principal_id,
     from_status, to_status, version, metadata)
  VALUES
    (CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
     CASE WHEN TG_OP = 'DELETE' THEN OLD.owner_principal_id ELSE NEW.owner_principal_id END,
     v_event_type,
     v_actor_type,
     CASE WHEN v_actor_type = 'user' THEN v_actor ELSE NULL END,
     v_from_status,
     v_to_status,
     CASE WHEN TG_OP = 'DELETE' THEN OLD.version ELSE NEW.version END,
     v_metadata);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_memory_events(
  p_memory_id uuid,
  p_limit integer,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid
)
RETURNS TABLE (
  id uuid,
  event_type public.memory_event_type,
  actor_type text,
  from_status public.memory_status,
  to_status public.memory_status,
  version integer,
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY
  SELECT e.id, e.event_type, e.actor_type, e.from_status, e.to_status,
         e.version, e.metadata, e.created_at
  FROM public.memory_events e
  WHERE e.owner_principal_id = v_user_id
    AND e.memory_item_id = p_memory_id
    AND (
      p_cursor_created_at IS NULL
      OR (e.created_at, e.id) < (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT v_limit + 1;
END;
$$;

CREATE OR REPLACE FUNCTION app.expire_due_memories(p_limit integer)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 1000));
  v_count integer := 0;
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT m.id
    FROM public.memory_items m
    WHERE m.status = 'confirmed'
      AND m.valid_until IS NOT NULL
      AND m.valid_until <= now()
    ORDER BY m.valid_until, m.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.memory_items
    SET status = 'expired', version = version + 1, updated_at = now()
    WHERE id = v_row.id;
    UPDATE public.context_field_policies
    SET allowed_uses = '{}', discoverable = false, version = version + 1, updated_at = now()
    WHERE source_type = 'memory_item' AND source_id = v_row.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION app.purge_deleted_memories(p_retention_days integer)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_days integer := greatest(0, coalesce(p_retention_days, 30));
  v_count integer := 0;
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT m.id
    FROM public.memory_items m
    WHERE m.status = 'deleted'
      AND m.deleted_at IS NOT NULL
      AND m.deleted_at <= now() - make_interval(days => v_days)
    ORDER BY m.deleted_at, m.id
    LIMIT 1000
    FOR UPDATE SKIP LOCKED
  LOOP
    DELETE FROM public.context_field_policies
    WHERE source_type = 'memory_item' AND source_id = v_row.id;
    DELETE FROM public.memory_items WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION app.purge_memory_events(p_retention_days integer)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_days integer := greatest(0, coalesce(p_retention_days, 365));
  v_count integer;
BEGIN
  DELETE FROM public.memory_events
  WHERE created_at <= now() - make_interval(days => v_days);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.audit_memory_item() OWNER TO aven_function_owner;
ALTER FUNCTION app.list_memory_events(uuid, integer, timestamptz, uuid)
  OWNER TO aven_function_owner;
ALTER FUNCTION app.expire_due_memories(integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.purge_deleted_memories(integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.purge_memory_events(integer) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

CREATE TRIGGER trg_memory_items_audit
AFTER INSERT OR UPDATE OR DELETE ON public.memory_items
FOR EACH ROW EXECUTE FUNCTION app.audit_memory_item();

REVOKE ALL ON FUNCTION app.audit_memory_item() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_memory_events(uuid, integer, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.expire_due_memories(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.purge_deleted_memories(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.purge_memory_events(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.list_memory_events(uuid, integer, timestamptz, uuid)
  TO aven_app;
GRANT EXECUTE ON FUNCTION app.expire_due_memories(integer) TO aven_worker;
GRANT EXECUTE ON FUNCTION app.purge_deleted_memories(integer) TO aven_worker;
GRANT EXECUTE ON FUNCTION app.purge_memory_events(integer) TO aven_worker;
