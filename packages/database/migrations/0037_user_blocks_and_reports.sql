-- 0037_user_blocks_and_reports.sql
-- User blocking (block_lists), content/user reporting (reports), and connection invitation rate limiting.

-- 1. Table: public.block_lists
CREATE TABLE public.block_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_block_lists_owner_blocked UNIQUE (owner_user_id, blocked_user_id),
  CONSTRAINT chk_block_lists_no_self_block CHECK (owner_user_id <> blocked_user_id),
  CONSTRAINT chk_block_lists_reason_length CHECK (reason IS NULL OR char_length(reason) <= 500)
);

CREATE INDEX idx_block_lists_owner ON public.block_lists (owner_user_id);
CREATE INDEX idx_block_lists_blocked ON public.block_lists (blocked_user_id);

ALTER TABLE public.block_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.block_lists FORCE ROW LEVEL SECURITY;

CREATE POLICY block_lists_migrator_all ON public.block_lists TO aven_migrator USING (true) WITH CHECK (true);
CREATE POLICY block_lists_function_all ON public.block_lists TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY block_lists_owner_select ON public.block_lists FOR SELECT TO aven_app
  USING (owner_user_id = app.current_user_id());

GRANT SELECT ON public.block_lists TO aven_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.block_lists TO aven_function_owner;

-- 2. Table: public.reports
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('user', 'peer_message', 'connection_invitation', 'event')),
  target_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('spam', 'harassment', 'inappropriate_content', 'privacy_violation', 'other')),
  details text NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  resolution text NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz NULL,
  CONSTRAINT chk_reports_details_length CHECK (details IS NULL OR char_length(details) <= 1000)
);

CREATE INDEX idx_reports_reporter ON public.reports (reporter_user_id);
CREATE INDEX idx_reports_status_created ON public.reports (status, created_at DESC);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports FORCE ROW LEVEL SECURITY;

CREATE POLICY reports_migrator_all ON public.reports TO aven_migrator USING (true) WITH CHECK (true);
CREATE POLICY reports_function_all ON public.reports TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY reports_reporter_select ON public.reports FOR SELECT TO aven_app
  USING (reporter_user_id = app.current_user_id());

GRANT SELECT ON public.reports TO aven_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO aven_function_owner;

-- 3. Stored Functions for Block Lists

-- 3.1 Check if either user has blocked the other
CREATE OR REPLACE FUNCTION app.is_blocked(p_user_a uuid, p_user_b uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF p_user_a IS NULL OR p_user_b IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.block_lists
    WHERE (owner_user_id = p_user_a AND blocked_user_id = p_user_b)
       OR (owner_user_id = p_user_b AND blocked_user_id = p_user_a)
  );
END $$;

-- 3.2 Block user
CREATE OR REPLACE FUNCTION app.block_user(p_blocked_user_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  u uuid := app.peer_actor();
  v_res public.block_lists;
BEGIN
  IF p_blocked_user_id IS NULL THEN
    RAISE EXCEPTION 'blocked user id required' USING ERRCODE='22023';
  END IF;
  IF u = p_blocked_user_id THEN
    RAISE EXCEPTION 'cannot block self' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.principals WHERE id = p_blocked_user_id AND status = 'active' AND type = 'user') THEN
    RAISE EXCEPTION 'target user unavailable' USING ERRCODE='P0002';
  END IF;

  INSERT INTO public.block_lists (owner_user_id, blocked_user_id, reason)
  VALUES (u, p_blocked_user_id, trim(p_reason))
  ON CONFLICT (owner_user_id, blocked_user_id) DO UPDATE
    SET reason = EXCLUDED.reason
  RETURNING * INTO v_res;

  RETURN jsonb_build_object(
    'id', v_res.id,
    'ownerUserId', v_res.owner_user_id,
    'blockedUserId', v_res.blocked_user_id,
    'reason', v_res.reason,
    'createdAt', v_res.created_at
  );
END $$;

-- 3.3 Unblock user
CREATE OR REPLACE FUNCTION app.unblock_user(p_blocked_user_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  u uuid := app.peer_actor();
BEGIN
  IF p_blocked_user_id IS NULL THEN
    RAISE EXCEPTION 'blocked user id required' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.block_lists WHERE owner_user_id = u AND blocked_user_id = p_blocked_user_id;
  RETURN FOUND;
END $$;

-- 3.4 List my blocks
CREATE OR REPLACE FUNCTION app.list_blocks()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  u uuid := app.peer_actor();
  v_res jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(b)), '[]'::jsonb) INTO v_res FROM (
    SELECT
      id,
      blocked_user_id AS "blockedUserId",
      reason,
      created_at AS "createdAt"
    FROM public.block_lists
    WHERE owner_user_id = u
    ORDER BY created_at DESC, id DESC
  ) b;
  RETURN jsonb_build_object('blocks', v_res);
END $$;

-- 4. Stored Functions for Reports

-- 4.1 Submit report
CREATE OR REPLACE FUNCTION app.submit_report(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_details text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  u uuid := app.peer_actor();
  v_report public.reports;
BEGIN
  IF p_target_type IS NULL OR p_target_type NOT IN ('user', 'peer_message', 'connection_invitation', 'event') THEN
    RAISE EXCEPTION 'invalid target type' USING ERRCODE='22023';
  END IF;
  IF p_target_id IS NULL THEN
    RAISE EXCEPTION 'target id required' USING ERRCODE='22023';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('spam', 'harassment', 'inappropriate_content', 'privacy_violation', 'other') THEN
    RAISE EXCEPTION 'invalid report reason' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.reports (reporter_user_id, target_type, target_id, reason, details)
  VALUES (u, p_target_type, p_target_id, p_reason, trim(p_details))
  RETURNING * INTO v_report;

  RETURN jsonb_build_object(
    'id', v_report.id,
    'reporterUserId', v_report.reporter_user_id,
    'targetType', v_report.target_type,
    'targetId', v_report.target_id,
    'reason', v_report.reason,
    'details', v_report.details,
    'status', v_report.status,
    'createdAt', v_report.created_at
  );
END $$;

-- 4.2 List my reports
CREATE OR REPLACE FUNCTION app.list_my_reports()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  u uuid := app.peer_actor();
  v_res jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_res FROM (
    SELECT
      id,
      target_type AS "targetType",
      target_id AS "targetId",
      reason,
      details,
      status,
      created_at AS "createdAt"
    FROM public.reports
    WHERE reporter_user_id = u
    ORDER BY created_at DESC, id DESC
  ) r;
  RETURN jsonb_build_object('reports', v_res);
END $$;

-- 5. Update app.send_connection_invitation with Block Check and 24h Rate Limit
CREATE OR REPLACE FUNCTION app.send_connection_invitation(p_preview uuid, p_key uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  u uuid := app.peer_actor();
  v public.connection_previews;
  existing public.connection_invitations;
  m jsonb;
  v_invitation_id uuid := gen_random_uuid();
  v_grant_id uuid := gen_random_uuid();
  x jsonb;
  v_recent_invitations integer;
BEGIN
  IF p_key IS NULL THEN RAISE EXCEPTION 'idempotency key required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v FROM public.connection_previews WHERE connection_previews.id=p_preview AND actor_user_id=u;
  IF NOT FOUND THEN RAISE EXCEPTION 'preview unavailable' USING ERRCODE='P0002'; END IF;

  -- Serializes retries and opposite-direction invitations for this unordered pair.
  PERFORM pg_advisory_xact_lock(hashtextextended(least(u,v.recipient_user_id)::text||greatest(u,v.recipient_user_id)::text,0));
  SELECT * INTO existing FROM public.connection_invitations WHERE sender_user_id=u AND idempotency_key=p_key;
  IF FOUND THEN
    IF existing.preview_id<>p_preview THEN RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='40001'; END IF;
    RETURN app.get_connection_invitation(existing.id);
  END IF;

  -- Block check: bidirectional block prevents invitation creation
  IF app.is_blocked(u, v.recipient_user_id) THEN
    RAISE EXCEPTION 'cannot send invitation: user is blocked' USING ERRCODE='42501';
  END IF;

  -- Rate limit check: max 20 invitations in 24 hours per user
  SELECT count(*) INTO v_recent_invitations
  FROM public.connection_invitations
  WHERE sender_user_id = u
    AND created_at > clock_timestamp() - interval '24 hours';
  IF v_recent_invitations >= 20 THEN
    RAISE EXCEPTION 'invitation rate limit exceeded' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v FROM public.connection_previews WHERE connection_previews.id=p_preview FOR UPDATE;
  IF v.consumed_at IS NOT NULL OR v.expires_at<=clock_timestamp() OR v.grant_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'preview consumed or expired' USING ERRCODE='40001'; END IF;
  PERFORM p.id FROM public.principals p WHERE p.id IN(u,v.recipient_user_id) AND p.type='user' AND p.status='active' ORDER BY p.id FOR SHARE;
  IF NOT EXISTS(SELECT 1 FROM public.principals WHERE principals.id=v.recipient_user_id AND status='active' AND type='user') THEN
    RAISE EXCEPTION 'recipient unavailable' USING ERRCODE='40001'; END IF;
  m:=app.peer_source_manifest(u,v.memory_item_ids);
  IF m<>v.manifest THEN RAISE EXCEPTION 'source changed; preview again' USING ERRCODE='40001'; END IF;

  -- Expired/revoked pending invitations cease blocking a new explicit invitation.
  UPDATE public.connection_invitations i SET status='withdrawn',version=version+1
    WHERE least(i.sender_user_id,i.recipient_user_id)=least(u,v.recipient_user_id)
      AND greatest(i.sender_user_id,i.recipient_user_id)=greatest(u,v.recipient_user_id)
      AND i.status='pending' AND (i.expires_at<=clock_timestamp() OR EXISTS(
        SELECT 1 FROM public.consent_grants g WHERE g.id=i.grant_id AND (g.status<>'active' OR g.expires_at<=clock_timestamp())));
  INSERT INTO public.consent_grants(id,grantor_principal_id,grantee_principal_id,purpose,expires_at,connection_invitation_id)
    VALUES(v_grant_id,u,v.recipient_user_id,'connection_invitation',v.grant_expires_at,v_invitation_id);
  INSERT INTO public.connection_invitations(id,sender_user_id,recipient_user_id,preview_id,idempotency_key,grant_id,expires_at)
    VALUES(v_invitation_id,u,v.recipient_user_id,p_preview,p_key,v_grant_id,v.grant_expires_at);
  FOR x IN SELECT * FROM jsonb_array_elements(m) LOOP
    INSERT INTO public.consent_grant_items(grant_id,source_type,source_id,source_version,policy_version,field_key,value_snapshot)
      VALUES(v_grant_id,'memory_item',(x->>'sourceId')::uuid,(x->>'sourceVersion')::int,(x->>'policyVersion')::int,'content',x->'value');
  END LOOP;
  INSERT INTO public.consent_events(grant_id,event_type,actor_principal_id,metadata)
    VALUES(v_grant_id,'granted',u,jsonb_build_object('kind','connection_invitation','invitationId',v_invitation_id));
  INSERT INTO public.connection_events(invitation_id,actor_user_id,event_type,version) VALUES(v_invitation_id,u,'sent',1);
  UPDATE public.connection_previews SET consumed_at=clock_timestamp(),result_invitation_id=v_invitation_id WHERE connection_previews.id=p_preview;
  RETURN app.get_connection_invitation(v_invitation_id);
END $$;

-- 6. Update app.send_peer_message with Block Check
CREATE OR REPLACE FUNCTION app.send_peer_message(p_connection_id uuid, p_content text, p_client_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  u uuid := app.peer_actor();
  v_conn record;
  v_other_user uuid;
  v_msg public.peer_messages;
BEGIN
  IF p_connection_id IS NULL THEN
    RAISE EXCEPTION 'connection id required' USING ERRCODE='22023';
  END IF;
  IF p_client_message_id IS NULL THEN
    RAISE EXCEPTION 'client message id required' USING ERRCODE='22023';
  END IF;
  IF p_content IS NULL OR char_length(trim(p_content)) < 1 OR char_length(p_content) > 4000 THEN
    RAISE EXCEPTION 'invalid message content' USING ERRCODE='22023';
  END IF;

  SELECT user_low, user_high INTO v_conn FROM public.peer_connections WHERE id = p_connection_id;
  IF NOT FOUND OR u NOT IN (v_conn.user_low, v_conn.user_high) THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE='P0002';
  END IF;

  v_other_user := CASE WHEN u = v_conn.user_low THEN v_conn.user_high ELSE v_conn.user_low END;
  IF app.is_blocked(u, v_other_user) THEN
    RAISE EXCEPTION 'cannot send message: user is blocked' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_msg FROM public.peer_messages
  WHERE connection_id = p_connection_id AND client_message_id = p_client_message_id;
  IF FOUND THEN
    IF v_msg.sender_user_id = u AND v_msg.content = p_content THEN
      RETURN jsonb_build_object(
        'id', v_msg.id,
        'connectionId', v_msg.connection_id,
        'senderUserId', v_msg.sender_user_id,
        'content', v_msg.content,
        'clientMessageId', v_msg.client_message_id,
        'createdAt', v_msg.created_at
      );
    ELSE
      RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='23505';
    END IF;
  END IF;

  INSERT INTO public.peer_messages (connection_id, sender_user_id, content, client_message_id)
  VALUES (p_connection_id, u, p_content, p_client_message_id)
  RETURNING * INTO v_msg;

  RETURN jsonb_build_object(
    'id', v_msg.id,
    'connectionId', v_msg.connection_id,
    'senderUserId', v_msg.sender_user_id,
    'content', v_msg.content,
    'clientMessageId', v_msg.client_message_id,
    'createdAt', v_msg.created_at
  );
END $$;

-- 7. Function Ownership and Permissions
GRANT CREATE ON SCHEMA app TO aven_function_owner;

ALTER FUNCTION app.is_blocked(uuid, uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.block_user(uuid, text) OWNER TO aven_function_owner;
ALTER FUNCTION app.unblock_user(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_blocks() OWNER TO aven_function_owner;
ALTER FUNCTION app.submit_report(text, uuid, text, text) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_my_reports() OWNER TO aven_function_owner;
ALTER FUNCTION app.send_connection_invitation(uuid, uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.send_peer_message(uuid, text, uuid) OWNER TO aven_function_owner;

REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.is_blocked(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION app.block_user(uuid, text) FROM public;
REVOKE ALL ON FUNCTION app.unblock_user(uuid) FROM public;
REVOKE ALL ON FUNCTION app.list_blocks() FROM public;
REVOKE ALL ON FUNCTION app.submit_report(text, uuid, text, text) FROM public;
REVOKE ALL ON FUNCTION app.list_my_reports() FROM public;

GRANT EXECUTE ON FUNCTION app.is_blocked(uuid, uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.block_user(uuid, text) TO aven_app;
GRANT EXECUTE ON FUNCTION app.unblock_user(uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_blocks() TO aven_app;
GRANT EXECUTE ON FUNCTION app.submit_report(text, uuid, text, text) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_my_reports() TO aven_app;
