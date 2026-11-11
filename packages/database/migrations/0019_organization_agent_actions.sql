-- M4-04 & M4-05: Organization Agent, Opportunity Action Draft & Confirmation, and Boundary Enforcement

-- 1. Function to create organization agent turn
CREATE OR REPLACE FUNCTION app.create_organization_agent_turn(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_input text,
  p_idempotency_key text,
  p_method text,
  p_path text,
  p_request_hash text,
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
#variable_conflict use_column
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

  IF NOT app.is_org_member(p_organization_id) THEN
    RAISE EXCEPTION 'not organization member' USING ERRCODE = '42501';
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
    INSERT INTO public.conversations (organization_id, status, created_by)
    VALUES (p_organization_id, 'active', v_user_id)
    RETURNING id INTO v_conversation_id;

    INSERT INTO public.conversation_members (conversation_id, principal_id, role)
    VALUES (v_conversation_id, v_user_id, 'owner');
  ELSE
    SELECT c.id INTO v_conversation_id
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND c.organization_id = p_organization_id
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
    (p_organization_id, v_user_id, v_conversation_id, v_message_id,
     'queued', p_provider, p_model, 'org_turn')
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
     v_run_id, jsonb_build_object('run_id', v_run_id, 'conversation_id', v_conversation_id),
     now() + interval '24 hours');

  INSERT INTO public.outbox_events
    (topic, partition_key, payload)
  VALUES
    ('agent.run.requested', v_run_id::text, jsonb_build_object(
      'run_id', v_run_id,
      'principal_id', p_organization_id,
      'initiated_by_user_id', v_user_id,
      'conversation_id', v_conversation_id,
      'input_message_id', v_message_id,
      'provider', p_provider,
      'model', p_model
    ));

  RETURN QUERY SELECT v_run_id, v_conversation_id, 'queued'::public.agent_run_status, true;
END;
$$;

-- 2. Function to create organization action (such as opportunity.create proposal)
CREATE OR REPLACE FUNCTION app.create_organization_action(
  p_organization_id uuid,
  p_action_type text,
  p_payload jsonb,
  p_run_id uuid,
  p_expires_in_seconds integer,
  p_token_hash text
)
RETURNS TABLE (
  id uuid,
  action_type text,
  status public.action_status,
  draft_version integer,
  run_id uuid,
  organization_id uuid,
  draft_payload jsonb,
  expires_at timestamptz,
  confirmed_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_action_id uuid;
  v_expires integer := greatest(1, least(coalesce(p_expires_in_seconds, 600), 86400));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  IF NOT app.is_org_member(p_organization_id) THEN
    RAISE EXCEPTION 'not organization member' USING ERRCODE = '42501';
  END IF;

  IF p_action_type IS NULL OR length(trim(p_action_type)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'invalid action type' USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid action payload' USING ERRCODE = '22023';
  END IF;
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid token hash' USING ERRCODE = '22023';
  END IF;

  IF p_run_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.agent_runs r
      WHERE r.id = p_run_id
        AND r.principal_id = p_organization_id
    ) THEN
      RAISE EXCEPTION 'agent run not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO public.actions
    (run_id, principal_id, organization_id, action_type, draft_version,
     draft_payload, status, confirmation_token_hash, expires_at)
  VALUES
    (p_run_id, v_user_id, p_organization_id, p_action_type, 1, p_payload,
     'pending_confirmation', p_token_hash, now() + make_interval(secs => v_expires))
  RETURNING id INTO v_action_id;

  RETURN QUERY
  SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
         a.draft_payload, a.expires_at, a.confirmed_at, a.executed_at, a.result,
         a.created_at, a.updated_at
  FROM public.actions a WHERE a.id = v_action_id;
END;
$$;

-- 3. Confirm opportunity create action
CREATE OR REPLACE FUNCTION app.confirm_opportunity_create_action(
  p_action_id uuid,
  p_expected_draft_version integer,
  p_token_hash text,
  p_idempotency_key text,
  p_method text,
  p_path text,
  p_request_hash text
)
RETURNS TABLE (
  id uuid,
  action_type text,
  status public.action_status,
  draft_version integer,
  run_id uuid,
  organization_id uuid,
  draft_payload jsonb,
  expires_at timestamptz,
  confirmed_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  executed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_action public.actions%ROWTYPE;
  v_existing public.idempotency_keys%ROWTYPE;
  v_opp_id uuid;
  v_org_id uuid;
  v_title text;
  v_summary text;
  v_description text;
  v_domains text[];
  v_requirements text[];
  v_stage public.opportunity_stage;
  v_hours integer;
  v_location text;
  v_remote_ok boolean;
  v_headcount integer;
  v_deadline timestamptz;
  v_visibility public.opportunity_visibility;
  v_contact_user_id uuid;
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
      SELECT * INTO v_action
      FROM public.actions a
      WHERE a.id = v_existing.result_resource_id;
      IF v_action.id IS NOT NULL THEN
        RETURN QUERY
        SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
               a.draft_payload, a.expires_at, a.confirmed_at, a.executed_at, a.result,
               a.created_at, a.updated_at, false
        FROM public.actions a WHERE a.id = v_action.id;
        RETURN;
      END IF;
    END IF;
    DELETE FROM public.idempotency_keys WHERE id = v_existing.id;
  END IF;

  SELECT * INTO v_action
  FROM public.actions a
  WHERE a.id = p_action_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'action not found' USING ERRCODE = 'P0002';
  END IF;

  v_org_id := v_action.organization_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'action is not an organization action' USING ERRCODE = '22023';
  END IF;

  -- Security check: confirm caller must currently be an active admin or owner or can represent
  IF NOT (app.is_org_admin(v_org_id) OR app.can_represent(v_org_id)) THEN
    RAISE EXCEPTION 'not authorized to confirm organization opportunity action' USING ERRCODE = '42501';
  END IF;

  IF v_action.confirmation_token_hash <> p_token_hash THEN
    RAISE EXCEPTION 'action confirmation token is invalid' USING ERRCODE = 'P0004';
  END IF;

  IF v_action.status = 'succeeded' THEN
    INSERT INTO public.idempotency_keys
      (principal_id, key, method, path, request_hash, response_status, state,
       result_resource_id, response_body, expires_at)
    VALUES
      (v_user_id, p_idempotency_key, p_method, p_path, p_request_hash, 200, 'completed',
       v_action.id, jsonb_build_object('action_id', v_action.id), now() + interval '24 hours')
    ON CONFLICT (principal_id, key, method, path) DO NOTHING;

    RETURN QUERY
    SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
           a.draft_payload, a.expires_at, a.confirmed_at, a.executed_at, a.result,
           a.created_at, a.updated_at, false
    FROM public.actions a WHERE a.id = v_action.id;
    RETURN;
  END IF;

  IF v_action.status <> 'pending_confirmation' THEN
    RETURN QUERY
    SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
           a.draft_payload, a.expires_at, a.confirmed_at, a.executed_at, a.result,
           a.created_at, a.updated_at, false
    FROM public.actions a WHERE a.id = v_action.id;
    RETURN;
  END IF;

  IF v_action.draft_version <> p_expected_draft_version THEN
    RAISE EXCEPTION 'action draft version conflict' USING ERRCODE = 'P0005';
  END IF;

  IF v_action.expires_at <= now() THEN
    UPDATE public.actions SET status = 'expired', updated_at = now() WHERE id = v_action.id;
    RETURN QUERY
    SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
           a.draft_payload, a.expires_at, a.confirmed_at, a.executed_at, a.result,
           a.created_at, a.updated_at, false
    FROM public.actions a WHERE a.id = v_action.id;
    RETURN;
  END IF;

  IF v_action.action_type <> 'opportunity.create' THEN
    RAISE EXCEPTION 'unsupported action type' USING ERRCODE = '22023';
  END IF;

  -- Extract opportunity draft parameters
  v_title := v_action.draft_payload ->> 'title';
  v_summary := v_action.draft_payload ->> 'summary';
  v_description := v_action.draft_payload ->> 'description';
  v_stage := COALESCE((v_action.draft_payload ->> 'stage')::public.opportunity_stage, 'any'::public.opportunity_stage);
  v_hours := (v_action.draft_payload ->> 'commitmentHoursPerWeek')::integer;
  v_location := v_action.draft_payload ->> 'location';
  v_remote_ok := COALESCE((v_action.draft_payload ->> 'remoteOk')::boolean, false);
  v_headcount := COALESCE((v_action.draft_payload ->> 'headcount')::integer, 1);
  v_deadline := (v_action.draft_payload ->> 'deadline')::timestamptz;
  v_visibility := COALESCE((v_action.draft_payload ->> 'visibility')::public.opportunity_visibility, 'campus'::public.opportunity_visibility);
  v_contact_user_id := (v_action.draft_payload ->> 'contactUserId')::uuid;

  IF v_contact_user_id IS NULL THEN
    v_contact_user_id := v_user_id;
  END IF;

  -- Check domains and requirements array
  SELECT array_agg(elem::text) INTO v_domains
  FROM jsonb_array_elements_text(COALESCE(v_action.draft_payload -> 'domains', '[]'::jsonb)) AS elem;

  SELECT array_agg(elem::text) INTO v_requirements
  FROM jsonb_array_elements_text(COALESCE(v_action.draft_payload -> 'requirements', '[]'::jsonb)) AS elem;

  -- Call opportunity creation
  v_opp_id := app.create_opportunity_draft(
    v_org_id,
    v_title,
    v_summary,
    v_description,
    COALESCE(v_domains, '{}'),
    COALESCE(v_requirements, '{}'),
    v_stage,
    v_hours,
    v_location,
    v_remote_ok,
    v_headcount,
    v_deadline,
    v_visibility,
    v_contact_user_id
  );

  UPDATE public.actions
  SET status = 'succeeded',
      confirmed_at = now(),
      executed_at = now(),
      result = jsonb_build_object(
        'opportunityId', v_opp_id,
        'organizationId', v_org_id,
        'status', 'draft'
      ),
      idempotency_key = p_idempotency_key,
      updated_at = now()
  WHERE id = v_action.id;

  INSERT INTO public.idempotency_keys
    (principal_id, key, method, path, request_hash, response_status, state,
     result_resource_id, response_body, expires_at)
  VALUES
    (v_user_id, p_idempotency_key, p_method, p_path, p_request_hash, 200, 'completed',
     v_action.id, jsonb_build_object('action_id', v_action.id, 'opportunity_id', v_opp_id),
     now() + interval '24 hours')
  ON CONFLICT (principal_id, key, method, path) DO NOTHING;

  RETURN QUERY
  SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
         a.draft_payload, a.expires_at, a.confirmed_at, a.executed_at, a.result,
         a.created_at, a.updated_at, true
  FROM public.actions a WHERE a.id = v_action.id;
END;
$$;

-- 4. Update get_action to allow organization members to read actions belonging to their organization
CREATE OR REPLACE FUNCTION app.get_action(p_action_id uuid)
RETURNS TABLE (
  id uuid,
  action_type text,
  status public.action_status,
  draft_version integer,
  run_id uuid,
  organization_id uuid,
  draft_payload jsonb,
  expires_at timestamptz,
  confirmed_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY
  SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
         a.draft_payload, a.expires_at, a.confirmed_at, a.executed_at, a.result,
         a.created_at, a.updated_at
  FROM public.actions a
  WHERE a.id = p_action_id
    AND (
      a.principal_id = v_user_id
      OR (a.organization_id IS NOT NULL AND app.is_org_member(a.organization_id))
    );
END;
$$;

-- 5. Permissions
GRANT CREATE ON SCHEMA app TO aven_function_owner;

ALTER FUNCTION app.create_organization_agent_turn(uuid,uuid,text,text,text,text,text,text,text) OWNER TO aven_function_owner;
ALTER FUNCTION app.create_organization_action(uuid,text,jsonb,uuid,integer,text) OWNER TO aven_function_owner;
ALTER FUNCTION app.confirm_opportunity_create_action(uuid,integer,text,text,text,text,text) OWNER TO aven_function_owner;
ALTER FUNCTION app.get_action(uuid) OWNER TO aven_function_owner;

REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.create_organization_agent_turn(uuid,uuid,text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_organization_action(uuid,text,jsonb,uuid,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.confirm_opportunity_create_action(uuid,integer,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_action(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.create_organization_agent_turn(uuid,uuid,text,text,text,text,text,text,text) TO aven_app;
GRANT EXECUTE ON FUNCTION app.create_organization_action(uuid,text,jsonb,uuid,integer,text) TO aven_app;
GRANT EXECUTE ON FUNCTION app.confirm_opportunity_create_action(uuid,integer,text,text,text,text,text) TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_action(uuid) TO aven_app;
