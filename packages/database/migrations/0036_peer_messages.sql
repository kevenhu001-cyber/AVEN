-- Migration: 0036_peer_messages.sql
-- Peer connection messaging: contracts, pagination, soft-deletion, and retention

CREATE TABLE public.peer_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.peer_connections(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES public.users(id),
  content text NOT NULL,
  client_message_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_by_sender boolean NOT NULL DEFAULT false,
  deleted_by_recipient boolean NOT NULL DEFAULT false,
  purged_at timestamptz,
  CONSTRAINT chk_peer_messages_content CHECK (
    (purged_at IS NULL AND char_length(trim(content)) >= 1 AND char_length(content) <= 4000)
    OR (purged_at IS NOT NULL AND content = '')
  ),
  CONSTRAINT uq_peer_messages_client_id UNIQUE (connection_id, client_message_id)
);

CREATE INDEX idx_peer_messages_pagination ON public.peer_messages (connection_id, created_at DESC, id DESC);
CREATE INDEX idx_peer_messages_sender ON public.peer_messages (sender_user_id);

ALTER TABLE public.peer_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY peer_messages_function_all ON public.peer_messages
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY peer_messages_migrator_all ON public.peer_messages
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
CREATE POLICY peer_messages_participant_select ON public.peer_messages
  FOR SELECT TO aven_app
  USING (
    app.current_principal_id() = app.current_user_id()
    AND EXISTS (
      SELECT 1 FROM public.peer_connections c
      WHERE c.id = peer_messages.connection_id
        AND app.current_user_id() IN (c.user_low, c.user_high)
    )
    AND (
      (sender_user_id = app.current_user_id() AND NOT deleted_by_sender)
      OR (sender_user_id <> app.current_user_id() AND NOT deleted_by_recipient)
    )
  );

GRANT SELECT ON public.peer_messages TO aven_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.peer_messages TO aven_function_owner;
GRANT SELECT, UPDATE ON public.peer_messages TO aven_worker;

-- 1. Send peer message
CREATE OR REPLACE FUNCTION app.send_peer_message(p_connection_id uuid, p_content text, p_client_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  u uuid := app.peer_actor();
  v_conn record;
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

-- 2. List peer messages (reverse chronological cursor pagination)
CREATE OR REPLACE FUNCTION app.list_peer_messages(
  p_connection_id uuid,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  u uuid := app.peer_actor();
  v_conn record;
  l integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_messages jsonb := '[]'::jsonb;
  v_last jsonb;
  v_next_cursor jsonb := NULL;
BEGIN
  IF p_connection_id IS NULL THEN
    RAISE EXCEPTION 'connection id required' USING ERRCODE='22023';
  END IF;

  SELECT user_low, user_high INTO v_conn FROM public.peer_connections WHERE id = p_connection_id;
  IF NOT FOUND OR u NOT IN (v_conn.user_low, v_conn.user_high) THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE='P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(m)), '[]'::jsonb) INTO v_messages FROM (
    SELECT
      id,
      connection_id AS "connectionId",
      sender_user_id AS "senderUserId",
      content,
      client_message_id AS "clientMessageId",
      created_at AS "createdAt"
    FROM public.peer_messages
    WHERE connection_id = p_connection_id
      AND (
        (sender_user_id = u AND NOT deleted_by_sender)
        OR (sender_user_id <> u AND NOT deleted_by_recipient)
      )
      AND (
        p_cursor_created_at IS NULL
        OR (created_at, id) < (p_cursor_created_at, p_cursor_id)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT l
  ) m;

  IF jsonb_array_length(v_messages) = l THEN
    v_last := v_messages->(l - 1);
    v_next_cursor := jsonb_build_object(
      'createdAt', v_last->>'createdAt',
      'id', v_last->>'id'
    );
  END IF;

  RETURN jsonb_build_object(
    'connectionId', p_connection_id,
    'messages', v_messages,
    'nextCursor', v_next_cursor
  );
END $$;

-- 3. Soft-delete peer message
CREATE OR REPLACE FUNCTION app.delete_peer_message(p_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  u uuid := app.peer_actor();
  v_msg_rec record;
BEGIN
  IF p_message_id IS NULL THEN
    RAISE EXCEPTION 'message id required' USING ERRCODE='22023';
  END IF;

  SELECT m.id, m.sender_user_id, c.user_low, c.user_high
  INTO v_msg_rec
  FROM public.peer_messages m
  JOIN public.peer_connections c ON c.id = m.connection_id
  WHERE m.id = p_message_id;

  IF NOT FOUND OR u NOT IN (v_msg_rec.user_low, v_msg_rec.user_high) THEN
    RAISE EXCEPTION 'message not found' USING ERRCODE='P0002';
  END IF;

  IF v_msg_rec.sender_user_id = u THEN
    UPDATE public.peer_messages SET deleted_by_sender = true WHERE id = p_message_id;
  ELSE
    UPDATE public.peer_messages SET deleted_by_recipient = true WHERE id = p_message_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'messageId', p_message_id
  );
END $$;

-- 4. Maintain peer messages (hard purge double-deleted messages by worker)
CREATE OR REPLACE FUNCTION app.maintain_peer_messages(p_batch_size integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  b integer := LEAST(GREATEST(COALESCE(p_batch_size, 100), 1), 1000);
  v_purged_count integer := 0;
BEGIN
  IF session_user <> 'aven_worker' THEN
    RAISE EXCEPTION 'worker session required' USING ERRCODE='42501';
  END IF;

  WITH to_purge AS (
    SELECT id FROM public.peer_messages
    WHERE deleted_by_sender = true
      AND deleted_by_recipient = true
      AND purged_at IS NULL
    ORDER BY id
    LIMIT b
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.peer_messages m
  SET content = '', purged_at = clock_timestamp()
  FROM to_purge
  WHERE m.id = to_purge.id;

  GET DIAGNOSTICS v_purged_count = ROW_COUNT;
  RETURN jsonb_build_object('purged', v_purged_count);
END $$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.send_peer_message(uuid, text, uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_peer_messages(uuid, timestamptz, uuid, integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.delete_peer_message(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.maintain_peer_messages(integer) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.send_peer_message(uuid, text, uuid),
  app.list_peer_messages(uuid, timestamptz, uuid, integer),
  app.delete_peer_message(uuid),
  app.maintain_peer_messages(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.send_peer_message(uuid, text, uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_peer_messages(uuid, timestamptz, uuid, integer) TO aven_app;
GRANT EXECUTE ON FUNCTION app.delete_peer_message(uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.maintain_peer_messages(integer) TO aven_worker;
