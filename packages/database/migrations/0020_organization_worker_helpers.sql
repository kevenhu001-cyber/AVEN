-- Migration 0020: Organization Worker Helpers and Turn Outbox Fix

-- 1. Fix create_organization_agent_turn: remove incorrect outbox_events insert
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

-- 2. Worker helper: get organization details
CREATE OR REPLACE FUNCTION app.get_organization_for_worker(p_organization_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  website_url text,
  logo_url text,
  campus_name text,
  member_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id,
         o.name,
         o.description,
         o.website_url,
         o.logo_url,
         c.name AS campus_name,
         (SELECT count(*)::integer FROM public.organization_memberships m
          WHERE m.organization_id = o.id AND m.status = 'active') AS member_count
  FROM public.organizations o
  LEFT JOIN public.campuses c ON c.id = o.campus_id
  WHERE o.id = p_organization_id;
END;
$$;

-- 3. Worker helper: list opportunities for organization
CREATE OR REPLACE FUNCTION app.list_organization_opportunities_for_worker(
  p_organization_id uuid,
  p_limit integer
)
RETURNS TABLE (
  id uuid,
  title text,
  summary text,
  stage public.opportunity_stage,
  status public.opportunity_status,
  visibility public.opportunity_visibility,
  headcount integer,
  deadline timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
BEGIN
  RETURN QUERY
  SELECT o.id, o.title, o.summary, o.stage, o.status, o.visibility, o.headcount, o.deadline
  FROM public.opportunities o
  WHERE o.organization_id = p_organization_id
  ORDER BY o.created_at DESC
  LIMIT v_limit;
END;
$$;

-- 4. Worker helper: create organization action draft
CREATE OR REPLACE FUNCTION app.create_organization_action_for_worker(
  p_organization_id uuid,
  p_user_id uuid,
  p_run_id uuid,
  p_action_type text,
  p_payload jsonb,
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
  expires_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_action_id uuid;
  v_expires integer := greatest(1, least(coalesce(p_expires_in_seconds, 600), 86400));
BEGIN
  INSERT INTO public.actions
    (run_id, principal_id, organization_id, action_type, draft_version,
     draft_payload, status, confirmation_token_hash, expires_at)
  VALUES
    (p_run_id, p_user_id, p_organization_id, p_action_type, 1, p_payload,
     'pending_confirmation', p_token_hash, now() + make_interval(secs => v_expires))
  RETURNING actions.id INTO v_action_id;

  RETURN QUERY
  SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
         a.draft_payload, a.expires_at
  FROM public.actions a WHERE a.id = v_action_id;
END;
$$;

-- 5. Permissions
GRANT CREATE ON SCHEMA app TO aven_function_owner;

ALTER FUNCTION app.create_organization_agent_turn(uuid,uuid,text,text,text,text,text,text,text) OWNER TO aven_function_owner;
ALTER FUNCTION app.get_organization_for_worker(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_organization_opportunities_for_worker(uuid, integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.create_organization_action_for_worker(uuid, uuid, uuid, text, jsonb, integer, text) OWNER TO aven_function_owner;

REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.create_organization_agent_turn(uuid,uuid,text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_organization_for_worker(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_organization_opportunities_for_worker(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_organization_action_for_worker(uuid, uuid, uuid, text, jsonb, integer, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.create_organization_agent_turn(uuid,uuid,text,text,text,text,text,text,text) TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_organization_for_worker(uuid) TO aven_worker;
GRANT EXECUTE ON FUNCTION app.list_organization_opportunities_for_worker(uuid, integer) TO aven_worker;
GRANT EXECUTE ON FUNCTION app.create_organization_action_for_worker(uuid, uuid, uuid, text, jsonb, integer, text) TO aven_worker;
