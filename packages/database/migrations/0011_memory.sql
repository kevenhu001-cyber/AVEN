CREATE TYPE public.memory_kind AS ENUM (
  'interest', 'skill', 'project', 'goal', 'preference', 'experience', 'education', 'other'
);
CREATE TYPE public.sensitivity AS ENUM ('low', 'normal', 'high');
CREATE TYPE public.display_audience AS ENUM ('owner', 'campus', 'public');
CREATE TYPE public.context_use AS ENUM ('self_ai', 'matching', 'sharing');
CREATE TYPE public.memory_status AS ENUM (
  'pending_confirmation', 'confirmed', 'rejected', 'expired', 'deleted'
);
CREATE TYPE public.memory_source_type AS ENUM (
  'user_input', 'conversation', 'file', 'import', 'agent_extraction'
);
CREATE TYPE public.consent_source_type AS ENUM (
  'profile', 'memory_item', 'intent', 'opportunity', 'custom'
);

CREATE TABLE public.memory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_principal_id uuid NOT NULL REFERENCES public.principals (id),
  kind public.memory_kind NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  structured_value jsonb,
  sensitivity public.sensitivity NOT NULL DEFAULT 'normal',
  status public.memory_status NOT NULL DEFAULT 'pending_confirmation',
  valid_from timestamptz,
  valid_until timestamptz,
  confirmed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_memory_title CHECK (length(trim(title)) BETWEEN 1 AND 160),
  CONSTRAINT chk_memory_content CHECK (length(trim(content)) BETWEEN 1 AND 20000),
  CONSTRAINT chk_memory_validity CHECK (
    valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from
  )
);
CREATE INDEX idx_memory_owner_status ON public.memory_items (owner_principal_id, status);
CREATE INDEX idx_memory_valid_until ON public.memory_items (valid_until)
  WHERE status = 'confirmed' AND valid_until IS NOT NULL;

CREATE TABLE public.memory_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_item_id uuid NOT NULL REFERENCES public.memory_items (id) ON DELETE CASCADE,
  source_type public.memory_source_type NOT NULL,
  source_id uuid,
  source_version text,
  excerpt text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_sources_memory ON public.memory_sources (memory_item_id);
CREATE INDEX idx_memory_sources_source ON public.memory_sources (source_type, source_id);

CREATE TABLE public.context_field_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_principal_id uuid NOT NULL REFERENCES public.principals (id),
  source_type public.consent_source_type NOT NULL,
  source_id uuid NOT NULL,
  field_key text NOT NULL,
  display_audience public.display_audience NOT NULL DEFAULT 'owner',
  campus_id uuid REFERENCES public.campuses (id),
  discoverable boolean NOT NULL DEFAULT false,
  allowed_uses public.context_use[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_context_field_key CHECK (length(trim(field_key)) BETWEEN 1 AND 80),
  CONSTRAINT chk_context_source_type CHECK (source_type IN ('profile', 'memory_item')),
  CONSTRAINT chk_context_campus CHECK (display_audience = 'campus' OR campus_id IS NULL),
  CONSTRAINT chk_context_discoverable CHECK (NOT discoverable OR display_audience <> 'owner'),
  CONSTRAINT chk_context_allowed_uses CHECK (
    allowed_uses <@ ARRAY['self_ai', 'matching', 'sharing']::public.context_use[]
  )
);
CREATE UNIQUE INDEX uq_context_field_policy_source
  ON public.context_field_policies (source_type, source_id, field_key);
CREATE INDEX idx_context_field_policy_owner ON public.context_field_policies (owner_principal_id);

CREATE OR REPLACE FUNCTION app.enforce_memory_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  IF NEW.owner_principal_id IS NULL OR NEW.owner_principal_id <> app.current_user_id() THEN
    RAISE EXCEPTION 'memory owner must be the current user' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.principals p
    WHERE p.id = NEW.owner_principal_id AND p.type IN ('user', 'organization')
  ) THEN
    RAISE EXCEPTION 'memory owner must be a user or organization principal'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_memory_source_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.memory_items m
    WHERE m.id = NEW.memory_item_id AND m.owner_principal_id = app.current_user_id()
  ) THEN
    RAISE EXCEPTION 'memory source must belong to the current user'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_context_policy_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  IF NEW.owner_principal_id <> app.current_user_id() THEN
    RAISE EXCEPTION 'context policy owner must be the current user' USING ERRCODE = '42501';
  END IF;
  IF NEW.source_type = 'memory_item' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.memory_items m
      WHERE m.id = NEW.source_id AND m.owner_principal_id = NEW.owner_principal_id
    ) THEN
      RAISE EXCEPTION 'context policy memory source is not owned by the user'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.source_type = 'profile' THEN
    IF NEW.source_id <> NEW.owner_principal_id THEN
      RAISE EXCEPTION 'profile context policy must reference the owner'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported context policy source' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_memory_items_owner
BEFORE INSERT OR UPDATE ON public.memory_items
FOR EACH ROW EXECUTE FUNCTION app.enforce_memory_owner();
CREATE TRIGGER trg_memory_items_updated_at
BEFORE UPDATE ON public.memory_items
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_memory_sources_owner
BEFORE INSERT OR UPDATE ON public.memory_sources
FOR EACH ROW EXECUTE FUNCTION app.enforce_memory_source_owner();
CREATE TRIGGER trg_context_field_policies_owner
BEFORE INSERT OR UPDATE ON public.context_field_policies
FOR EACH ROW EXECUTE FUNCTION app.enforce_context_policy_source();
CREATE TRIGGER trg_context_field_policies_updated_at
BEFORE UPDATE ON public.context_field_policies
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE public.memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.memory_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE public.context_field_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_field_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY memory_items_owner_select ON public.memory_items
FOR SELECT TO aven_app
USING (owner_principal_id = app.current_principal_id());
CREATE POLICY memory_items_function_all ON public.memory_items
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY memory_items_migrator_all ON public.memory_items
FOR ALL TO aven_migrator USING (true) WITH CHECK (true);

CREATE POLICY memory_sources_owner_select ON public.memory_sources
FOR SELECT TO aven_app
USING (
  EXISTS (
    SELECT 1 FROM public.memory_items m
    WHERE m.id = memory_sources.memory_item_id
      AND m.owner_principal_id = app.current_principal_id()
  )
);
CREATE POLICY memory_sources_function_all ON public.memory_sources
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY memory_sources_migrator_all ON public.memory_sources
FOR ALL TO aven_migrator USING (true) WITH CHECK (true);

CREATE POLICY context_field_policies_owner_select ON public.context_field_policies
FOR SELECT TO aven_app
USING (owner_principal_id = app.current_principal_id());
CREATE POLICY context_field_policies_function_all ON public.context_field_policies
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY context_field_policies_migrator_all ON public.context_field_policies
FOR ALL TO aven_migrator USING (true) WITH CHECK (true);

GRANT SELECT ON public.memory_items, public.memory_sources, public.context_field_policies TO aven_app;
GRANT SELECT, INSERT, UPDATE ON public.memory_items TO aven_function_owner;
GRANT SELECT, INSERT ON public.memory_sources TO aven_function_owner;
GRANT SELECT, INSERT, UPDATE ON public.context_field_policies TO aven_function_owner;

CREATE OR REPLACE FUNCTION app.create_memory_item(
  p_kind public.memory_kind,
  p_title text,
  p_content text,
  p_structured_value jsonb,
  p_sensitivity public.sensitivity,
  p_display_audience public.display_audience,
  p_discoverable boolean,
  p_allowed_uses public.context_use[],
  p_campus_id uuid,
  p_valid_until timestamptz
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_memory_id uuid;
  v_campus_status text;
  v_uses public.context_use[] := coalesce(p_allowed_uses, '{}');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF p_title IS NULL OR length(trim(p_title)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'invalid memory title' USING ERRCODE = '22023';
  END IF;
  IF p_content IS NULL OR length(trim(p_content)) NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'invalid memory content' USING ERRCODE = '22023';
  END IF;
  IF p_valid_until IS NOT NULL AND p_valid_until <= now() THEN
    RAISE EXCEPTION 'invalid memory validity' USING ERRCODE = '22023';
  END IF;
  IF p_display_audience = 'campus' THEN
    IF p_campus_id IS NULL THEN
      RAISE EXCEPTION 'campus audience requires a campus' USING ERRCODE = '22023';
    END IF;
    SELECT c.status INTO v_campus_status FROM public.campuses c WHERE c.id = p_campus_id;
    IF v_campus_status IS NULL OR v_campus_status <> 'active' THEN
      RAISE EXCEPTION 'campus not available' USING ERRCODE = '22023';
    END IF;
  ELSIF p_campus_id IS NOT NULL THEN
    RAISE EXCEPTION 'campus id requires campus audience' USING ERRCODE = '22023';
  END IF;
  IF p_discoverable AND p_display_audience = 'owner' THEN
    RAISE EXCEPTION 'owner-only memory cannot be discoverable' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.memory_items
    (owner_principal_id, kind, title, content, structured_value, sensitivity,
     status, valid_from, valid_until, confirmed_at)
  VALUES
    (v_user_id, p_kind, trim(p_title), p_content, p_structured_value, p_sensitivity,
     'confirmed', now(), p_valid_until, now())
  RETURNING id INTO v_memory_id;
  INSERT INTO public.memory_sources (memory_item_id, source_type, source_version)
  VALUES (v_memory_id, 'user_input', 'manual');
  INSERT INTO public.context_field_policies
    (owner_principal_id, source_type, source_id, field_key, display_audience,
     campus_id, discoverable, allowed_uses)
  VALUES
    (v_user_id, 'memory_item', v_memory_id, 'content', p_display_audience,
     p_campus_id, p_discoverable, v_uses);
  RETURN v_memory_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.update_memory_item(
  p_id uuid,
  p_expected_version integer,
  p_title text,
  p_content text,
  p_structured_value jsonb,
  p_sensitivity public.sensitivity,
  p_display_audience public.display_audience,
  p_discoverable boolean,
  p_allowed_uses public.context_use[],
  p_campus_id uuid,
  p_valid_until timestamptz
) RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_new_version integer;
  v_campus_status text;
  v_uses public.context_use[] := coalesce(p_allowed_uses, '{}');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF p_title IS NULL OR length(trim(p_title)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'invalid memory title' USING ERRCODE = '22023';
  END IF;
  IF p_content IS NULL OR length(trim(p_content)) NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'invalid memory content' USING ERRCODE = '22023';
  END IF;
  IF p_valid_until IS NOT NULL AND p_valid_until <= now() THEN
    RAISE EXCEPTION 'invalid memory validity' USING ERRCODE = '22023';
  END IF;
  IF p_display_audience = 'campus' THEN
    IF p_campus_id IS NULL THEN
      RAISE EXCEPTION 'campus audience requires a campus' USING ERRCODE = '22023';
    END IF;
    SELECT c.status INTO v_campus_status FROM public.campuses c WHERE c.id = p_campus_id;
    IF v_campus_status IS NULL OR v_campus_status <> 'active' THEN
      RAISE EXCEPTION 'campus not available' USING ERRCODE = '22023';
    END IF;
  ELSIF p_campus_id IS NOT NULL THEN
    RAISE EXCEPTION 'campus id requires campus audience' USING ERRCODE = '22023';
  END IF;
  IF p_discoverable AND p_display_audience = 'owner' THEN
    RAISE EXCEPTION 'owner-only memory cannot be discoverable' USING ERRCODE = '22023';
  END IF;
  UPDATE public.memory_items
  SET title = trim(p_title),
      content = p_content,
      structured_value = p_structured_value,
      sensitivity = p_sensitivity,
      valid_until = p_valid_until,
      version = version + 1,
      updated_at = now()
  WHERE id = p_id
    AND owner_principal_id = v_user_id
    AND version = p_expected_version
    AND status <> 'deleted'
  RETURNING version INTO v_new_version;
  IF v_new_version IS NULL THEN
    RAISE EXCEPTION 'memory version conflict or not found' USING ERRCODE = '23514';
  END IF;
  UPDATE public.context_field_policies
  SET display_audience = p_display_audience,
      campus_id = p_campus_id,
      discoverable = p_discoverable,
      allowed_uses = v_uses,
      version = version + 1,
      updated_at = now()
  WHERE source_type = 'memory_item' AND source_id = p_id AND field_key = 'content';
  IF NOT FOUND THEN
    INSERT INTO public.context_field_policies
      (owner_principal_id, source_type, source_id, field_key, display_audience,
       campus_id, discoverable, allowed_uses)
    VALUES
      (v_user_id, 'memory_item', p_id, 'content', p_display_audience,
       p_campus_id, p_discoverable, v_uses);
  END IF;
  RETURN v_new_version;
END;
$$;

CREATE OR REPLACE FUNCTION app.delete_memory_item(
  p_id uuid,
  p_expected_version integer
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_new_version integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  UPDATE public.memory_items
  SET status = 'deleted', deleted_at = now(), version = version + 1, updated_at = now()
  WHERE id = p_id
    AND owner_principal_id = v_user_id
    AND version = p_expected_version
    AND status <> 'deleted'
  RETURNING version INTO v_new_version;
  IF v_new_version IS NULL THEN
    RAISE EXCEPTION 'memory version conflict or not found' USING ERRCODE = '23514';
  END IF;
  UPDATE public.context_field_policies
  SET allowed_uses = '{}', discoverable = false, version = version + 1, updated_at = now()
  WHERE source_type = 'memory_item' AND source_id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_my_memory_items(
  p_limit integer,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid,
  p_kind public.memory_kind
)
RETURNS TABLE (
  id uuid,
  kind public.memory_kind,
  title text,
  content text,
  structured_value jsonb,
  sensitivity public.sensitivity,
  status public.memory_status,
  version integer,
  valid_from timestamptz,
  valid_until timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  display_audience public.display_audience,
  discoverable boolean,
  allowed_uses text[],
  campus_id uuid,
  policy_version integer,
  source_count integer
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
  SELECT m.id, m.kind, m.title, m.content, m.structured_value, m.sensitivity,
         m.status, m.version, m.valid_from, m.valid_until, m.confirmed_at,
         m.created_at, m.updated_at,
         coalesce(p.display_audience, 'owner'),
         coalesce(p.discoverable, false),
         coalesce(p.allowed_uses, '{}'::public.context_use[])::text[],
         p.campus_id,
         coalesce(p.version, 0),
         (SELECT count(*)::integer FROM public.memory_sources s WHERE s.memory_item_id = m.id)
  FROM public.memory_items m
  LEFT JOIN public.context_field_policies p
    ON p.source_type = 'memory_item' AND p.source_id = m.id AND p.field_key = 'content'
  WHERE m.owner_principal_id = v_user_id
    AND m.status <> 'deleted'
    AND (p_kind IS NULL OR m.kind = p_kind)
    AND (
      p_cursor_created_at IS NULL
      OR (m.created_at, m.id) < (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT v_limit + 1;
END;
$$;

CREATE OR REPLACE FUNCTION app.get_memory_item(p_id uuid)
RETURNS TABLE (
  id uuid,
  kind public.memory_kind,
  title text,
  content text,
  structured_value jsonb,
  sensitivity public.sensitivity,
  status public.memory_status,
  version integer,
  valid_from timestamptz,
  valid_until timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  display_audience public.display_audience,
  discoverable boolean,
  allowed_uses text[],
  campus_id uuid,
  policy_version integer,
  source_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY
  SELECT m.id, m.kind, m.title, m.content, m.structured_value, m.sensitivity,
         m.status, m.version, m.valid_from, m.valid_until, m.confirmed_at,
         m.created_at, m.updated_at,
         coalesce(p.display_audience, 'owner'),
         coalesce(p.discoverable, false),
         coalesce(p.allowed_uses, '{}'::public.context_use[])::text[],
         p.campus_id,
         coalesce(p.version, 0),
         (SELECT count(*)::integer FROM public.memory_sources s WHERE s.memory_item_id = m.id)
  FROM public.memory_items m
  LEFT JOIN public.context_field_policies p
    ON p.source_type = 'memory_item' AND p.source_id = m.id AND p.field_key = 'content'
  WHERE m.id = p_id
    AND m.owner_principal_id = v_user_id
    AND m.status <> 'deleted'
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_memory_sources(p_memory_id uuid)
RETURNS TABLE (
  id uuid,
  source_type public.memory_source_type,
  source_id uuid,
  source_version text,
  excerpt text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memory_items m
    WHERE m.id = p_memory_id AND m.owner_principal_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'memory not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT s.id, s.source_type, s.source_id, s.source_version, s.excerpt, s.created_at
  FROM public.memory_sources s
  WHERE s.memory_item_id = p_memory_id
  ORDER BY s.created_at;
END;
$$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.create_memory_item(
  public.memory_kind, text, text, jsonb, public.sensitivity,
  public.display_audience, boolean, public.context_use[], uuid, timestamptz
) OWNER TO aven_function_owner;
ALTER FUNCTION app.update_memory_item(
  uuid, integer, text, text, jsonb, public.sensitivity,
  public.display_audience, boolean, public.context_use[], uuid, timestamptz
) OWNER TO aven_function_owner;
ALTER FUNCTION app.delete_memory_item(uuid, integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_my_memory_items(
  integer, timestamptz, uuid, public.memory_kind
) OWNER TO aven_function_owner;
ALTER FUNCTION app.get_memory_item(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_memory_sources(uuid) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.create_memory_item(
  public.memory_kind, text, text, jsonb, public.sensitivity,
  public.display_audience, boolean, public.context_use[], uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.update_memory_item(
  uuid, integer, text, text, jsonb, public.sensitivity,
  public.display_audience, boolean, public.context_use[], uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.delete_memory_item(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_my_memory_items(
  integer, timestamptz, uuid, public.memory_kind
) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_memory_item(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_memory_sources(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.create_memory_item(
  public.memory_kind, text, text, jsonb, public.sensitivity,
  public.display_audience, boolean, public.context_use[], uuid, timestamptz
) TO aven_app;
GRANT EXECUTE ON FUNCTION app.update_memory_item(
  uuid, integer, text, text, jsonb, public.sensitivity,
  public.display_audience, boolean, public.context_use[], uuid, timestamptz
) TO aven_app;
GRANT EXECUTE ON FUNCTION app.delete_memory_item(uuid, integer) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_my_memory_items(
  integer, timestamptz, uuid, public.memory_kind
) TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_memory_item(uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_memory_sources(uuid) TO aven_app;
