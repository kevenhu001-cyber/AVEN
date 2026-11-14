-- Migration: 0044_conversation_history
-- Read-side history for personal agent conversations.
--
-- Every turn is already persisted durably: the user's input lands in
-- public.messages (derived_from_run_id IS NULL) and the Worker writes the final
-- reply to the same table (derived_from_run_id = run id). agent_run_events are
-- purged after 24 hours, so restoring a conversation must read messages, not
-- events. These functions add owner-scoped reads only; there is no new write
-- surface and no change to the turn lifecycle or RLS policy on the tables.

CREATE FUNCTION app.list_conversations(p_limit integer, p_cursor_at timestamptz, p_cursor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  u uuid := app.peer_actor();
  rows jsonb;
  page jsonb;
  last_row jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50
     OR (p_cursor_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid conversation cursor' USING ERRCODE = '22023';
  END IF;
  WITH recent AS (
    SELECT c.id, c.created_at, c.updated_at
    FROM public.conversations c
    WHERE c.owner_user_id = u
      AND c.status = 'active'
      AND (p_cursor_at IS NULL OR (c.created_at, c.id) < (p_cursor_at, p_cursor_id))
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT p_limit + 1
  ),
  titled AS (
    SELECT r.id, r.created_at, r.updated_at,
      (
        SELECT m.body
        FROM public.messages m
        WHERE m.conversation_id = r.id
          AND m.derived_from_run_id IS NULL
          AND m.deleted_at IS NULL
          AND length(trim(m.body)) > 0
        ORDER BY m.created_at ASC, m.id ASC
        LIMIT 1
      ) AS title
    FROM recent r
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object('id', t.id, 'title', left(t.title, 200), 'createdAt', t.created_at, 'updatedAt', t.updated_at)
      ORDER BY t.created_at DESC, t.id DESC
    ),
    '[]'::jsonb
  ) INTO rows
  FROM titled t
  WHERE t.title IS NOT NULL;
  -- A conversation whose first user message is gone has nothing to show.
  SELECT coalesce(jsonb_agg(value ORDER BY ord), '[]') INTO page
    FROM jsonb_array_elements(rows) WITH ORDINALITY a(value, ord)
    WHERE ord <= p_limit;
  last_row := page->(jsonb_array_length(page) - 1);
  RETURN jsonb_build_object(
    'data', page,
    'nextCursor', CASE WHEN jsonb_array_length(rows) > p_limit
      THEN jsonb_build_object('createdAt', last_row->'createdAt', 'id', last_row->'id')
      ELSE 'null'::jsonb END
  );
END $$;

CREATE FUNCTION app.list_conversation_messages(
  p_conversation_id uuid,
  p_limit integer,
  p_cursor_at timestamptz,
  p_cursor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  u uuid := app.peer_actor();
  rows jsonb;
  page jsonb;
  last_row jsonb;
BEGIN
  IF p_conversation_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 200
     OR (p_cursor_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid conversation message cursor' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id AND c.owner_user_id = u AND c.status = 'active'
  ) THEN
    RAISE EXCEPTION 'conversation not available' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(row_json ORDER BY created_at ASC, id ASC), '[]') INTO rows
    FROM (
      SELECT jsonb_build_object(
        'id', m.id,
        'body', m.body,
        'contentType', m.content_type,
        'derivedFromRunId', m.derived_from_run_id,
        'createdAt', m.created_at,
        'editedAt', m.edited_at
      ) AS row_json, m.created_at, m.id
      FROM public.messages m
      WHERE m.conversation_id = p_conversation_id
        AND m.deleted_at IS NULL
        AND (p_cursor_at IS NULL OR (m.created_at, m.id) > (p_cursor_at, p_cursor_id))
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT p_limit + 1
    ) feed;
  SELECT coalesce(jsonb_agg(value ORDER BY ord), '[]') INTO page
    FROM jsonb_array_elements(rows) WITH ORDINALITY a(value, ord)
    WHERE ord <= p_limit;
  last_row := page->(jsonb_array_length(page) - 1);
  RETURN jsonb_build_object(
    'data', page,
    'nextCursor', CASE WHEN jsonb_array_length(rows) > p_limit
      THEN jsonb_build_object('createdAt', last_row->'createdAt', 'id', last_row->'id')
      ELSE 'null'::jsonb END
  );
END $$;

REVOKE ALL ON FUNCTION app.list_conversations(integer, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_conversations(integer, timestamptz, uuid) TO aven_app;
REVOKE ALL ON FUNCTION app.list_conversation_messages(uuid, integer, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_conversation_messages(uuid, integer, timestamptz, uuid) TO aven_app;
