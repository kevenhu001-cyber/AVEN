-- M3-05: agent runtime, persisted events, SSE replay, cancellation, and retention.

CREATE TYPE public.conversation_status AS ENUM ('active', 'archived');
CREATE TYPE public.message_content_type AS ENUM ('text', 'card', 'system');
CREATE TYPE public.agent_run_status AS ENUM (
  'queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled'
);
CREATE TYPE public.agent_run_event_type AS ENUM (
  'turn.started', 'message.delta', 'tool.started', 'tool.progress',
  'tool.completed', 'action.proposed', 'turn.completed', 'turn.failed', 'turn.cancelled'
);
CREATE TYPE public.agent_source_type AS ENUM ('message', 'memory_item', 'profile', 'custom');

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES public.users (id),
  -- Relationship conversations are enabled with the M5 relationships table.
  relationship_id uuid,
  organization_id uuid REFERENCES public.organizations (id),
  status public.conversation_status NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL REFERENCES public.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_conversations_single_owner CHECK (
    num_nonnulls(owner_user_id, relationship_id, organization_id) = 1
  )
);
CREATE INDEX idx_conversations_owner ON public.conversations (owner_user_id, created_at DESC);
CREATE INDEX idx_conversations_org ON public.conversations (organization_id, created_at DESC);

CREATE TABLE public.conversation_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES public.principals (id),
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  last_read_at timestamptz,
  CONSTRAINT chk_conversation_member_role CHECK (role IN ('owner', 'member')),
  CONSTRAINT uq_conversation_members UNIQUE (conversation_id, principal_id)
);
CREATE INDEX idx_conversation_members_principal
  ON public.conversation_members (principal_id, conversation_id);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  sender_principal_id uuid NOT NULL REFERENCES public.principals (id),
  body text NOT NULL,
  content_type public.message_content_type NOT NULL DEFAULT 'text',
  version integer NOT NULL DEFAULT 1,
  derived_from_run_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT chk_messages_body CHECK (length(trim(body)) BETWEEN 1 AND 20000),
  CONSTRAINT chk_messages_version CHECK (version >= 1),
  CONSTRAINT chk_messages_metadata CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX idx_messages_conversation ON public.messages (conversation_id, created_at, id);
CREATE UNIQUE INDEX uq_messages_derived_from_run
  ON public.messages (derived_from_run_id)
  WHERE derived_from_run_id IS NOT NULL;

CREATE TABLE public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES public.principals (id),
  initiated_by_user_id uuid NOT NULL REFERENCES public.users (id),
  conversation_id uuid NOT NULL REFERENCES public.conversations (id),
  input_message_id uuid NOT NULL REFERENCES public.messages (id),
  status public.agent_run_status NOT NULL DEFAULT 'queued',
  provider text NOT NULL,
  model text NOT NULL,
  input_summary text NOT NULL DEFAULT 'user_turn',
  output_summary text,
  error_code text,
  cancel_requested_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_agent_runs_provider CHECK (length(trim(provider)) BETWEEN 1 AND 120),
  CONSTRAINT chk_agent_runs_model CHECK (length(trim(model)) BETWEEN 1 AND 120),
  CONSTRAINT chk_agent_runs_input_summary CHECK (length(input_summary) <= 500),
  CONSTRAINT chk_agent_runs_output_summary CHECK (
    output_summary IS NULL OR length(output_summary) <= 500
  ),
  CONSTRAINT chk_agent_runs_error_code CHECK (error_code IS NULL OR length(error_code) <= 120),
  CONSTRAINT chk_agent_runs_terminal CHECK (
    (status IN ('completed', 'failed', 'cancelled') AND completed_at IS NOT NULL)
    OR (status NOT IN ('completed', 'failed', 'cancelled') AND completed_at IS NULL)
  )
);
CREATE INDEX idx_agent_runs_owner ON public.agent_runs (initiated_by_user_id, created_at DESC);
CREATE INDEX idx_agent_runs_status ON public.agent_runs (status, created_at);

ALTER TABLE public.messages
  ADD CONSTRAINT fk_messages_derived_from_run
  FOREIGN KEY (derived_from_run_id) REFERENCES public.agent_runs (id) ON DELETE CASCADE;

CREATE TABLE public.agent_run_events (
  run_id uuid NOT NULL REFERENCES public.agent_runs (id) ON DELETE CASCADE,
  sequence bigint NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  event_type public.agent_run_event_type NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (run_id, sequence),
  CONSTRAINT chk_agent_event_sequence CHECK (sequence >= 1),
  CONSTRAINT chk_agent_event_schema CHECK (schema_version = 1),
  CONSTRAINT chk_agent_event_payload CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX idx_agent_run_events_expiry ON public.agent_run_events (expires_at);
CREATE UNIQUE INDEX uq_agent_run_terminal_event
  ON public.agent_run_events (run_id)
  WHERE event_type IN ('turn.completed', 'turn.failed', 'turn.cancelled');

CREATE TABLE public.agent_run_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.agent_runs (id) ON DELETE CASCADE,
  source_type public.agent_source_type NOT NULL,
  source_id uuid NOT NULL,
  source_version text,
  policy_version integer,
  consent_grant_item_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agent_run_source UNIQUE (run_id, source_type, source_id, source_version)
);
CREATE INDEX idx_agent_run_sources_run ON public.agent_run_sources (run_id);

CREATE TABLE public.idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES public.principals (id) ON DELETE CASCADE,
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  request_hash text NOT NULL,
  response_status integer,
  state text NOT NULL DEFAULT 'pending',
  result_resource_id uuid,
  response_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  CONSTRAINT chk_idempotency_state CHECK (state IN ('pending', 'completed', 'failed')),
  CONSTRAINT chk_idempotency_key CHECK (length(trim(key)) BETWEEN 1 AND 200),
  CONSTRAINT chk_idempotency_response_body CHECK (jsonb_typeof(response_body) = 'object'),
  CONSTRAINT uq_idempotency_scope UNIQUE (principal_id, key, method, path)
);
CREATE INDEX idx_idempotency_expiry ON public.idempotency_keys (expires_at);

CREATE TRIGGER trg_conversations_updated_at
BEFORE UPDATE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_agent_runs_updated_at
BEFORE UPDATE ON public.agent_runs
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_run_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_run_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_run_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY conversations_owner_select ON public.conversations
FOR SELECT TO aven_app
USING (owner_user_id = app.current_user_id());
CREATE POLICY conversations_function_all ON public.conversations
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY conversations_migrator_all ON public.conversations
FOR ALL TO aven_migrator USING (true) WITH CHECK (true);

CREATE POLICY conversation_members_owner_select ON public.conversation_members
FOR SELECT TO aven_app
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_members.conversation_id
      AND c.owner_user_id = app.current_user_id()
  )
);
CREATE POLICY conversation_members_function_all ON public.conversation_members
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY conversation_members_migrator_all ON public.conversation_members
FOR ALL TO aven_migrator USING (true) WITH CHECK (true);

CREATE POLICY messages_owner_select ON public.messages
FOR SELECT TO aven_app
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND c.owner_user_id = app.current_user_id()
  )
);
CREATE POLICY messages_function_all ON public.messages
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY messages_migrator_all ON public.messages
FOR ALL TO aven_migrator USING (true) WITH CHECK (true);

CREATE POLICY agent_runs_owner_select ON public.agent_runs
FOR SELECT TO aven_app
USING (initiated_by_user_id = app.current_user_id());
CREATE POLICY agent_runs_function_all ON public.agent_runs
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY agent_runs_migrator_all ON public.agent_runs
FOR ALL TO aven_migrator USING (true) WITH CHECK (true);

CREATE POLICY agent_run_events_owner_select ON public.agent_run_events
FOR SELECT TO aven_app
USING (
  EXISTS (
    SELECT 1 FROM public.agent_runs r
    WHERE r.id = agent_run_events.run_id
      AND r.initiated_by_user_id = app.current_user_id()
  )
);
CREATE POLICY agent_run_events_function_all ON public.agent_run_events
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY agent_run_events_migrator_all ON public.agent_run_events
FOR ALL TO aven_migrator USING (true) WITH CHECK (true);

CREATE POLICY agent_run_sources_owner_select ON public.agent_run_sources
FOR SELECT TO aven_app
USING (
  EXISTS (
    SELECT 1 FROM public.agent_runs r
    WHERE r.id = agent_run_sources.run_id
      AND r.initiated_by_user_id = app.current_user_id()
  )
);
CREATE POLICY agent_run_sources_function_all ON public.agent_run_sources
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY agent_run_sources_migrator_all ON public.agent_run_sources
FOR ALL TO aven_migrator USING (true) WITH CHECK (true);

CREATE POLICY idempotency_keys_owner_select ON public.idempotency_keys
FOR SELECT TO aven_app
USING (principal_id = app.current_principal_id());
CREATE POLICY idempotency_keys_function_all ON public.idempotency_keys
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY idempotency_keys_migrator_all ON public.idempotency_keys
FOR ALL TO aven_migrator USING (true) WITH CHECK (true);

GRANT SELECT ON public.conversations, public.conversation_members, public.messages,
  public.agent_runs, public.agent_run_events, public.agent_run_sources,
  public.idempotency_keys TO aven_app;
GRANT SELECT, INSERT, UPDATE ON public.conversations, public.conversation_members,
  public.messages, public.agent_runs, public.agent_run_sources,
  public.idempotency_keys TO aven_function_owner;
GRANT SELECT, INSERT, DELETE ON public.agent_run_events TO aven_function_owner;

CREATE OR REPLACE FUNCTION app.insert_agent_run_event(
  p_run_id uuid,
  p_event_type public.agent_run_event_type,
  p_payload jsonb,
  p_allow_terminal boolean DEFAULT false
) RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_status public.agent_run_status;
  v_sequence bigint;
BEGIN
  SELECT r.status INTO v_status FROM public.agent_runs r WHERE r.id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent run not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status IN ('completed', 'failed', 'cancelled') AND NOT p_allow_terminal THEN
    RAISE EXCEPTION 'agent run is terminal' USING ERRCODE = '23514';
  END IF;
  IF p_allow_terminal AND p_event_type NOT IN ('turn.completed', 'turn.failed', 'turn.cancelled') THEN
    RAISE EXCEPTION 'terminal event type is required' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(max(e.sequence), 0) + 1 INTO v_sequence
  FROM public.agent_run_events e WHERE e.run_id = p_run_id;
  INSERT INTO public.agent_run_events
    (run_id, sequence, event_type, payload, expires_at)
  VALUES
    (p_run_id, v_sequence, p_event_type, coalesce(p_payload, '{}'::jsonb),
     now() + interval '24 hours');
  RETURN v_sequence;
END;
$$;

CREATE OR REPLACE FUNCTION app.create_agent_turn(
  p_idempotency_key text,
  p_method text,
  p_path text,
  p_request_hash text,
  p_conversation_id uuid,
  p_input text,
  p_provider text,
  p_model text
)
RETURNS TABLE (
  run_id uuid,
  conversation_id uuid,
  status public.agent_run_status,
  created boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_existing public.idempotency_keys%ROWTYPE;
  v_conversation_id uuid;
  v_message_id uuid;
  v_run_id uuid;
  v_status public.agent_run_status;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid idempotency key' USING ERRCODE = '22023';
  END IF;
  IF p_input IS NULL OR length(trim(p_input)) NOT BETWEEN 1 AND 8000 THEN
    RAISE EXCEPTION 'invalid agent input' USING ERRCODE = '22023';
  END IF;
  IF p_provider IS NULL OR p_model IS NULL THEN
    RAISE EXCEPTION 'invalid provider metadata' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.idempotency_keys k
  WHERE k.principal_id = v_user_id
    AND k.key = p_idempotency_key
    AND k.method = p_method
    AND k.path = p_path
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency key reused with a different request'
        USING ERRCODE = 'P0003';
    END IF;
    IF v_existing.expires_at > now() AND v_existing.result_resource_id IS NOT NULL THEN
      SELECT r.conversation_id, r.status INTO v_conversation_id, v_status
      FROM public.agent_runs r
      WHERE r.id = v_existing.result_resource_id;
      IF v_conversation_id IS NOT NULL THEN
        RETURN QUERY SELECT v_existing.result_resource_id, v_conversation_id, v_status, false;
        RETURN;
      END IF;
    END IF;
    DELETE FROM public.idempotency_keys WHERE id = v_existing.id;
  END IF;

  IF p_conversation_id IS NULL THEN
    INSERT INTO public.conversations (owner_user_id, status, created_by)
    VALUES (v_user_id, 'active', v_user_id)
    RETURNING id INTO v_conversation_id;
    INSERT INTO public.conversation_members (conversation_id, principal_id, role)
    VALUES (v_conversation_id, v_user_id, 'owner');
  ELSE
    SELECT c.id INTO v_conversation_id
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND c.owner_user_id = v_user_id
      AND c.status = 'active';
    IF v_conversation_id IS NULL THEN
      RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO public.messages
    (conversation_id, sender_principal_id, body, content_type, version)
  VALUES
    (v_conversation_id, v_user_id, p_input, 'text', 1)
  RETURNING id INTO v_message_id;

  INSERT INTO public.agent_runs
    (principal_id, initiated_by_user_id, conversation_id, input_message_id,
     status, provider, model, input_summary)
  VALUES
    (v_user_id, v_user_id, v_conversation_id, v_message_id,
     'queued', p_provider, p_model, 'user_turn')
  RETURNING id INTO v_run_id;

  INSERT INTO public.agent_run_sources
    (run_id, source_type, source_id, source_version)
  VALUES
    (v_run_id, 'message', v_message_id, '1');

  INSERT INTO public.idempotency_keys
    (principal_id, key, method, path, request_hash, response_status, state,
     result_resource_id, response_body, expires_at)
  VALUES
    (v_user_id, p_idempotency_key, p_method, p_path, p_request_hash, 201, 'completed',
     v_run_id,
     jsonb_build_object(
       'run_id', v_run_id,
       'conversation_id', v_conversation_id,
       'status', 'queued'
     ),
     now() + interval '24 hours');

  RETURN QUERY SELECT v_run_id, v_conversation_id, 'queued'::public.agent_run_status, true;
END;
$$;

CREATE OR REPLACE FUNCTION app.get_agent_run(p_run_id uuid)
RETURNS TABLE (
  id uuid,
  conversation_id uuid,
  status public.agent_run_status,
  provider text,
  model text,
  input_summary text,
  output_summary text,
  error_code text,
  cancel_requested_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
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
  SELECT r.id, r.conversation_id, r.status, r.provider, r.model,
         r.input_summary, r.output_summary, r.error_code, r.cancel_requested_at,
         r.started_at, r.completed_at, r.created_at, r.updated_at
  FROM public.agent_runs r
  WHERE r.id = p_run_id AND r.initiated_by_user_id = v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.get_agent_run_stream_context(p_run_id uuid)
RETURNS TABLE (
  run_id uuid,
  status public.agent_run_status,
  created_at timestamptz,
  latest_sequence bigint,
  history_expired boolean,
  sources_valid boolean,
  terminal_event_type public.agent_run_event_type
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_run_id uuid;
  v_status public.agent_run_status;
  v_created_at timestamptz;
  v_conversation_id uuid;
  v_latest bigint;
  v_terminal public.agent_run_event_type;
  v_history boolean;
  v_sources boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  SELECT r.id, r.status, r.created_at, r.conversation_id
  INTO v_run_id, v_status, v_created_at, v_conversation_id
  FROM public.agent_runs r
  WHERE r.id = p_run_id AND r.initiated_by_user_id = v_user_id;
  IF v_run_id IS NULL THEN
    RETURN;
  END IF;

  SELECT coalesce(max(e.sequence), 0) INTO v_latest
  FROM public.agent_run_events e WHERE e.run_id = p_run_id;
  SELECT e.event_type INTO v_terminal
  FROM public.agent_run_events e
  WHERE e.run_id = p_run_id
    AND e.event_type IN ('turn.completed', 'turn.failed', 'turn.cancelled')
  ORDER BY e.sequence DESC
  LIMIT 1;

  v_history := v_created_at <= now() - interval '24 hours'
    OR EXISTS (
      SELECT 1 FROM public.agent_run_events e
      WHERE e.run_id = p_run_id AND e.expires_at <= now()
    )
    OR (
      v_status IN ('completed', 'failed', 'cancelled')
      AND NOT EXISTS (SELECT 1 FROM public.agent_run_events e WHERE e.run_id = p_run_id)
    );

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.agent_run_sources s
    WHERE s.run_id = p_run_id
      AND NOT (
        (s.source_type = 'message' AND EXISTS (
          SELECT 1 FROM public.messages m
          WHERE m.id = s.source_id
            AND m.conversation_id = v_conversation_id
            AND m.deleted_at IS NULL
        ))
        OR (s.source_type = 'memory_item' AND EXISTS (
          SELECT 1
          FROM public.memory_items m
          JOIN public.context_field_policies p
            ON p.source_type = 'memory_item'
           AND p.source_id = m.id
           AND p.field_key = 'content'
          WHERE m.id = s.source_id
            AND m.owner_principal_id = v_user_id
            AND m.status = 'confirmed'
            AND m.deleted_at IS NULL
            AND (m.valid_until IS NULL OR m.valid_until > now())
            AND p.allowed_uses @> ARRAY['self_ai']::public.context_use[]
        ))
      )
  ) INTO v_sources;

  RETURN QUERY SELECT v_run_id, v_status, v_created_at, v_latest, v_history, v_sources, v_terminal;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_agent_run_events(
  p_run_id uuid,
  p_after_sequence bigint,
  p_limit integer
)
RETURNS TABLE (
  sequence bigint,
  schema_version integer,
  event_type public.agent_run_event_type,
  payload jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF p_after_sequence IS NULL OR p_after_sequence < 0 THEN
    RAISE EXCEPTION 'invalid event cursor' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT e.sequence, e.schema_version, e.event_type, e.payload, e.created_at
  FROM public.agent_run_events e
  JOIN public.agent_runs r ON r.id = e.run_id
  WHERE e.run_id = p_run_id
    AND r.initiated_by_user_id = v_user_id
    AND e.sequence > p_after_sequence
  ORDER BY e.sequence
  LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION app.cancel_agent_run(
  p_run_id uuid,
  p_idempotency_key text,
  p_method text,
  p_path text,
  p_request_hash text
)
RETURNS TABLE (
  run_id uuid,
  status public.agent_run_status,
  accepted boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_existing public.idempotency_keys%ROWTYPE;
  v_status public.agent_run_status;
  v_accepted boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid idempotency key' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.idempotency_keys k
  WHERE k.principal_id = v_user_id
    AND k.key = p_idempotency_key
    AND k.method = p_method
    AND k.path = p_path
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency key reused with a different request'
        USING ERRCODE = 'P0003';
    END IF;
    IF v_existing.expires_at > now() AND v_existing.result_resource_id IS NOT NULL THEN
      SELECT r.status INTO v_status
      FROM public.agent_runs r
      WHERE r.id = v_existing.result_resource_id
        AND r.initiated_by_user_id = v_user_id;
      IF v_status IS NOT NULL THEN
        RETURN QUERY SELECT v_existing.result_resource_id, v_status, false;
        RETURN;
      END IF;
    END IF;
    DELETE FROM public.idempotency_keys WHERE id = v_existing.id;
  END IF;

  SELECT r.status INTO v_status
  FROM public.agent_runs r
  WHERE r.id = p_run_id AND r.initiated_by_user_id = v_user_id
  FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'agent run not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status IN ('completed', 'failed', 'cancelled') THEN
    v_accepted := false;
  ELSIF v_status = 'queued' THEN
    PERFORM app.insert_agent_run_event(
      p_run_id, 'turn.cancelled', jsonb_build_object('reason', 'user_cancelled'), true
    );
    UPDATE public.agent_runs
    SET status = 'cancelled', cancel_requested_at = now(), completed_at = now(), updated_at = now()
    WHERE id = p_run_id;
    v_status := 'cancelled';
    v_accepted := true;
  ELSIF v_status = 'running' THEN
    UPDATE public.agent_runs
    SET status = 'cancelling', cancel_requested_at = now(), updated_at = now()
    WHERE id = p_run_id;
    v_status := 'cancelling';
    v_accepted := true;
  ELSE
    v_accepted := false;
  END IF;

  INSERT INTO public.idempotency_keys
    (principal_id, key, method, path, request_hash, response_status, state,
     result_resource_id, response_body, expires_at)
  VALUES
    (v_user_id, p_idempotency_key, p_method, p_path, p_request_hash,
     CASE WHEN v_accepted THEN 202 ELSE 200 END, 'completed', p_run_id,
     jsonb_build_object('run_id', p_run_id, 'status', v_status),
     now() + interval '24 hours');

  RETURN QUERY SELECT p_run_id, v_status, v_accepted;
END;
$$;

CREATE OR REPLACE FUNCTION app.get_agent_run_for_worker(p_run_id uuid)
RETURNS TABLE (
  run_id uuid,
  principal_id uuid,
  initiated_by_user_id uuid,
  conversation_id uuid,
  input_message_id uuid,
  input_body text,
  status public.agent_run_status,
  provider text,
  model text,
  cancel_requested_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT r.id, r.principal_id, r.initiated_by_user_id, r.conversation_id,
         r.input_message_id, m.body, r.status, r.provider, r.model,
         r.cancel_requested_at
  FROM public.agent_runs r
  JOIN public.messages m ON m.id = r.input_message_id
  WHERE r.id = p_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.start_agent_run(p_run_id uuid)
RETURNS TABLE (
  status public.agent_run_status,
  claimed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_status public.agent_run_status;
BEGIN
  SELECT r.status INTO v_status FROM public.agent_runs r WHERE r.id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent run not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'queued' THEN
    UPDATE public.agent_runs
    SET status = 'running', started_at = coalesce(started_at, now()), updated_at = now()
    WHERE id = p_run_id;
    RETURN QUERY SELECT 'running'::public.agent_run_status, true;
  ELSE
    RETURN QUERY SELECT v_status, false;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app.append_agent_run_event(
  p_run_id uuid,
  p_event_type public.agent_run_event_type,
  p_payload jsonb
) RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  RETURN app.insert_agent_run_event(p_run_id, p_event_type, p_payload, false);
END;
$$;

CREATE OR REPLACE FUNCTION app.bind_agent_run_source(
  p_run_id uuid,
  p_source_type public.agent_source_type,
  p_source_id uuid,
  p_source_version text,
  p_policy_version integer,
  p_consent_grant_item_id uuid
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_run public.agent_runs%ROWTYPE;
  v_source_id uuid;
BEGIN
  SELECT * INTO v_run FROM public.agent_runs r WHERE r.id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent run not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'agent run is terminal' USING ERRCODE = '23514';
  END IF;
  IF p_source_type = 'memory_item' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.memory_items m
      WHERE m.id = p_source_id
        AND m.owner_principal_id = v_run.initiated_by_user_id
        AND m.status = 'confirmed'
        AND m.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'memory source is not available' USING ERRCODE = '42501';
    END IF;
  ELSIF p_source_type = 'message' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = p_source_id
        AND m.conversation_id = v_run.conversation_id
        AND m.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'message source is not available' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported agent source type' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agent_run_sources
    (run_id, source_type, source_id, source_version, policy_version, consent_grant_item_id)
  VALUES
    (p_run_id, p_source_type, p_source_id, p_source_version, p_policy_version,
     p_consent_grant_item_id)
  ON CONFLICT (run_id, source_type, source_id, source_version) DO NOTHING
  RETURNING id INTO v_source_id;
  IF v_source_id IS NULL THEN
    SELECT s.id INTO v_source_id
    FROM public.agent_run_sources s
    WHERE s.run_id = p_run_id
      AND s.source_type = p_source_type
      AND s.source_id = p_source_id
      AND s.source_version IS NOT DISTINCT FROM p_source_version;
  END IF;
  RETURN v_source_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_memory_for_use_for_worker(
  p_owner_id uuid,
  p_use public.context_use,
  p_limit integer
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  version integer,
  policy_version integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
BEGIN
  IF p_use IS NULL THEN
    RAISE EXCEPTION 'memory use is required' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT m.id, m.title, m.content, m.version, p.version
  FROM public.memory_items m
  JOIN public.context_field_policies p
    ON p.source_type = 'memory_item'
   AND p.source_id = m.id
   AND p.field_key = 'content'
  WHERE m.owner_principal_id = p_owner_id
    AND m.status = 'confirmed'
    AND m.deleted_at IS NULL
    AND (m.valid_until IS NULL OR m.valid_until > clock_timestamp())
    AND p_use = ANY(p.allowed_uses)
  ORDER BY m.updated_at DESC
  LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION app.append_agent_message(
  p_run_id uuid,
  p_body text
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_run public.agent_runs%ROWTYPE;
  v_message_id uuid;
BEGIN
  SELECT * INTO v_run FROM public.agent_runs r WHERE r.id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent run not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status IN ('completed', 'failed', 'cancelled') THEN
    SELECT m.id INTO v_message_id FROM public.messages m WHERE m.derived_from_run_id = p_run_id;
    IF v_message_id IS NOT NULL THEN
      RETURN v_message_id;
    END IF;
    RAISE EXCEPTION 'agent run is terminal' USING ERRCODE = '23514';
  END IF;
  IF p_body IS NULL OR length(trim(p_body)) NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'invalid agent message' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.messages
    (conversation_id, sender_principal_id, body, content_type, version, derived_from_run_id)
  VALUES
    (v_run.conversation_id, v_run.principal_id, p_body, 'text', 1, p_run_id)
  ON CONFLICT (derived_from_run_id) WHERE derived_from_run_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_message_id;
  IF v_message_id IS NULL THEN
    SELECT m.id INTO v_message_id FROM public.messages m WHERE m.derived_from_run_id = p_run_id;
  END IF;
  RETURN v_message_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.finish_agent_run(
  p_run_id uuid,
  p_status public.agent_run_status,
  p_terminal_event_type public.agent_run_event_type,
  p_payload jsonb,
  p_output_summary text,
  p_error_code text
) RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_status public.agent_run_status;
  v_sequence bigint;
BEGIN
  SELECT r.status INTO v_status FROM public.agent_runs r WHERE r.id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent run not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status IN ('completed', 'failed', 'cancelled') THEN
    SELECT e.sequence INTO v_sequence
    FROM public.agent_run_events e
    WHERE e.run_id = p_run_id
      AND e.event_type IN ('turn.completed', 'turn.failed', 'turn.cancelled')
    ORDER BY e.sequence DESC
    LIMIT 1;
    RETURN coalesce(v_sequence, 0);
  END IF;
  IF (p_status = 'completed' AND p_terminal_event_type <> 'turn.completed')
     OR (p_status = 'failed' AND p_terminal_event_type <> 'turn.failed')
     OR (p_status = 'cancelled' AND p_terminal_event_type <> 'turn.cancelled')
     OR p_status NOT IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid agent terminal state' USING ERRCODE = '22023';
  END IF;
  IF v_status = 'cancelling' AND p_status <> 'cancelled' THEN
    RAISE EXCEPTION 'agent run cancellation is pending' USING ERRCODE = '23514';
  END IF;
  v_sequence := app.insert_agent_run_event(
    p_run_id, p_terminal_event_type, p_payload, true
  );
  UPDATE public.agent_runs
  SET status = p_status,
      completed_at = now(),
      output_summary = p_output_summary,
      error_code = p_error_code,
      updated_at = now()
  WHERE id = p_run_id;
  RETURN v_sequence;
END;
$$;

CREATE OR REPLACE FUNCTION app.is_agent_run_cancel_requested(p_run_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_cancelled boolean;
BEGIN
  SELECT (r.cancel_requested_at IS NOT NULL OR r.status = 'cancelling')
  INTO v_cancelled
  FROM public.agent_runs r
  WHERE r.id = p_run_id;
  RETURN coalesce(v_cancelled, false);
END;
$$;

CREATE OR REPLACE FUNCTION app.purge_agent_run_events(p_retention_hours integer)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_hours integer := greatest(1, coalesce(p_retention_hours, 24));
  v_count integer;
BEGIN
  DELETE FROM public.agent_run_events
  WHERE expires_at <= now()
     OR created_at <= now() - make_interval(hours => v_hours);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.insert_agent_run_event(uuid, public.agent_run_event_type, jsonb, boolean)
  OWNER TO aven_function_owner;
ALTER FUNCTION app.create_agent_turn(text, text, text, text, uuid, text, text, text)
  OWNER TO aven_function_owner;
ALTER FUNCTION app.get_agent_run(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.get_agent_run_stream_context(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_agent_run_events(uuid, bigint, integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.cancel_agent_run(uuid, text, text, text, text) OWNER TO aven_function_owner;
ALTER FUNCTION app.get_agent_run_for_worker(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.start_agent_run(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.append_agent_run_event(uuid, public.agent_run_event_type, jsonb)
  OWNER TO aven_function_owner;
ALTER FUNCTION app.bind_agent_run_source(uuid, public.agent_source_type, uuid, text, integer, uuid)
  OWNER TO aven_function_owner;
ALTER FUNCTION app.list_memory_for_use_for_worker(uuid, public.context_use, integer)
  OWNER TO aven_function_owner;
ALTER FUNCTION app.append_agent_message(uuid, text) OWNER TO aven_function_owner;
ALTER FUNCTION app.finish_agent_run(
  uuid, public.agent_run_status, public.agent_run_event_type, jsonb, text, text
) OWNER TO aven_function_owner;
ALTER FUNCTION app.is_agent_run_cancel_requested(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.purge_agent_run_events(integer) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.insert_agent_run_event(
  uuid, public.agent_run_event_type, jsonb, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_agent_turn(text, text, text, text, uuid, text, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_agent_run(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_agent_run_stream_context(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_agent_run_events(uuid, bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.cancel_agent_run(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_agent_run_for_worker(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.start_agent_run(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.append_agent_run_event(
  uuid, public.agent_run_event_type, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.bind_agent_run_source(
  uuid, public.agent_source_type, uuid, text, integer, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_memory_for_use_for_worker(
  uuid, public.context_use, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.append_agent_message(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.finish_agent_run(
  uuid, public.agent_run_status, public.agent_run_event_type, jsonb, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_agent_run_cancel_requested(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.purge_agent_run_events(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.create_agent_turn(
  text, text, text, text, uuid, text, text, text
) TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_agent_run(uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_agent_run_stream_context(uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_agent_run_events(uuid, bigint, integer) TO aven_app;
GRANT EXECUTE ON FUNCTION app.cancel_agent_run(uuid, text, text, text, text) TO aven_app;

GRANT EXECUTE ON FUNCTION app.get_agent_run_for_worker(uuid) TO aven_worker;
GRANT EXECUTE ON FUNCTION app.start_agent_run(uuid) TO aven_worker;
GRANT EXECUTE ON FUNCTION app.append_agent_run_event(
  uuid, public.agent_run_event_type, jsonb
) TO aven_worker;
GRANT EXECUTE ON FUNCTION app.bind_agent_run_source(
  uuid, public.agent_source_type, uuid, text, integer, uuid
) TO aven_worker;
GRANT EXECUTE ON FUNCTION app.list_memory_for_use_for_worker(
  uuid, public.context_use, integer
) TO aven_worker;
GRANT EXECUTE ON FUNCTION app.append_agent_message(uuid, text) TO aven_worker;
GRANT EXECUTE ON FUNCTION app.finish_agent_run(
  uuid, public.agent_run_status, public.agent_run_event_type, jsonb, text, text
) TO aven_worker;
GRANT EXECUTE ON FUNCTION app.is_agent_run_cancel_requested(uuid) TO aven_worker;
GRANT EXECUTE ON FUNCTION app.purge_agent_run_events(integer) TO aven_worker;
