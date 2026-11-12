-- M6-06A2: Event coordination in-app notifications.

-- 1. Event coordination events audit table
CREATE TABLE public.event_coordination_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES public.users(id),
  event_type text NOT NULL CHECK(event_type IN ('proposed','confirmed','cancelled','declined')),
  version integer NOT NULL CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_event_coordination_events ON public.event_coordination_events(event_id, created_at);

ALTER TABLE public.event_coordination_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_coordination_events FORCE ROW LEVEL SECURITY;
CREATE POLICY event_coordination_events_function ON public.event_coordination_events
  FOR ALL TO aven_function_owner USING(true) WITH CHECK(true);
CREATE POLICY event_coordination_events_migrator ON public.event_coordination_events
  FOR ALL TO aven_migrator USING(true) WITH CHECK(true);
CREATE POLICY event_coordination_events_worker ON public.event_coordination_events
  FOR SELECT TO aven_worker USING(app.is_worker());

GRANT SELECT, INSERT ON public.event_coordination_events TO aven_function_owner;
GRANT SELECT ON public.event_coordination_events TO aven_worker;

-- 2. Update notification_deliveries constraints and columns
ALTER TABLE public.notification_deliveries DROP CONSTRAINT notification_deliveries_event_id_fkey;
ALTER TABLE public.notification_deliveries ADD COLUMN coordination_event_id uuid REFERENCES public.event_coordination_events(id);

ALTER TABLE public.notification_deliveries DROP CONSTRAINT notification_deliveries_kind_check;
ALTER TABLE public.notification_deliveries ADD CONSTRAINT notification_deliveries_kind_check
  CHECK(kind IN ('sent','accepted','declined','withdrawn','revoked','proposed','confirmed','cancelled'));

-- 3. Update notifications table
ALTER TABLE public.notifications ALTER COLUMN invitation_id DROP NOT NULL;
ALTER TABLE public.notifications ADD COLUMN coordination_event_id uuid REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
  CHECK(kind IN ('sent','accepted','declined','withdrawn','revoked','proposed','confirmed','cancelled'));

ALTER TABLE public.notifications ADD CONSTRAINT chk_notification_target
  CHECK((invitation_id IS NOT NULL AND coordination_event_id IS NULL) OR (invitation_id IS NULL AND coordination_event_id IS NOT NULL));

CREATE INDEX idx_notifications_coordination_event ON public.notifications(coordination_event_id, recipient_user_id);

-- 4. Update notification_preferences
ALTER TABLE public.notification_preferences ADD COLUMN event_invitations boolean NOT NULL DEFAULT true;
ALTER TABLE public.notification_preferences ADD COLUMN event_updates boolean NOT NULL DEFAULT true;

-- 5. Helper function for event notification visibility
CREATE OR REPLACE FUNCTION app.event_notification_visible(p_event uuid, p_recipient uuid, p_kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.events e
    WHERE e.id = p_event
      AND (session_user = 'aven_worker' OR (p_recipient = app.current_user_id() AND app.current_user_id() = app.current_principal_id()))
      AND EXISTS(SELECT 1 FROM public.principals x WHERE x.id = p_recipient AND x.type = 'user' AND x.status = 'active')
      AND (
        e.organizer_principal_id = p_recipient
        OR EXISTS (
          SELECT 1 FROM public.event_participants ep
          WHERE ep.event_id = e.id AND ep.principal_id = p_recipient
        )
      )
      AND CASE p_kind
        WHEN 'proposed' THEN e.status IN ('proposed', 'pending_confirmation')
        WHEN 'confirmed' THEN e.status = 'confirmed'
        WHEN 'cancelled' THEN e.status = 'cancelled'
        WHEN 'declined' THEN true
        ELSE false
      END
  );
$$;

-- 6. Update notifications RLS policy
DROP POLICY notifications_recipient ON public.notifications;
CREATE POLICY notifications_recipient ON public.notifications FOR SELECT TO aven_app USING(
  recipient_user_id = app.current_user_id() AND app.current_user_id() = app.current_principal_id()
  AND created_at > clock_timestamp() - interval '90 days'
  AND (
    (invitation_id IS NOT NULL AND app.connection_notification_visible(invitation_id, recipient_user_id, kind))
    OR
    (coordination_event_id IS NOT NULL AND app.event_notification_visible(coordination_event_id, recipient_user_id, kind))
  )
);

-- 7. Update notification JSON formatting
CREATE OR REPLACE FUNCTION app.notification_json(p public.notifications) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,app,pg_temp AS $$
  SELECT jsonb_build_object(
    'id', p.id,
    'kind', p.kind,
    'target', CASE
      WHEN p.invitation_id IS NOT NULL THEN jsonb_build_object('type', 'connection_invitation', 'id', p.invitation_id)
      ELSE jsonb_build_object('type', 'event', 'id', p.coordination_event_id)
    END,
    'createdAt', p.created_at,
    'readAt', p.read_at
  );
$$;

-- 8. Update list_notifications
CREATE OR REPLACE FUNCTION app.list_notifications(p_limit integer, p_cursor_at timestamptz, p_cursor_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); rows jsonb; page jsonb; last_row jsonb; unread integer;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR (p_cursor_at IS NULL)<>(p_cursor_id IS NULL) THEN RAISE EXCEPTION 'invalid notification cursor' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(app.notification_json(n) ORDER BY n.created_at DESC,n.id DESC),'[]') INTO rows
    FROM (SELECT * FROM public.notifications WHERE recipient_user_id=u AND created_at>clock_timestamp()-interval '90 days'
      AND (
        (invitation_id IS NOT NULL AND app.connection_notification_visible(invitation_id,u,kind))
        OR
        (coordination_event_id IS NOT NULL AND app.event_notification_visible(coordination_event_id,u,kind))
      )
      AND (p_cursor_at IS NULL OR (created_at,id)<(p_cursor_at,p_cursor_id))
      ORDER BY created_at DESC,id DESC LIMIT p_limit+1) n;
  SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]') INTO page FROM jsonb_array_elements(rows) WITH ORDINALITY a(value,ord) WHERE ord<=p_limit;
  SELECT count(*) INTO unread FROM public.notifications WHERE recipient_user_id=u AND read_at IS NULL
    AND created_at>clock_timestamp()-interval '90 days'
    AND (
      (invitation_id IS NOT NULL AND app.connection_notification_visible(invitation_id,u,kind))
      OR
      (coordination_event_id IS NOT NULL AND app.event_notification_visible(coordination_event_id,u,kind))
    );
  last_row:=page->(jsonb_array_length(page)-1);
  RETURN jsonb_build_object('data',page,'unreadCount',unread,'nextCursor',CASE WHEN jsonb_array_length(rows)>p_limit
    THEN jsonb_build_object('createdAt',last_row->'createdAt','id',last_row->'id') ELSE 'null'::jsonb END);
END $$;

-- 9. Update read_notification
CREATE OR REPLACE FUNCTION app.read_notification(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); n public.notifications;
BEGIN
  UPDATE public.notifications SET read_at=coalesce(read_at,clock_timestamp()) WHERE id=p_id AND recipient_user_id=u
    AND created_at>clock_timestamp()-interval '90 days'
    AND (
      (invitation_id IS NOT NULL AND app.connection_notification_visible(invitation_id,u,kind))
      OR
      (coordination_event_id IS NOT NULL AND app.event_notification_visible(coordination_event_id,u,kind))
    )
    RETURNING * INTO n;
  IF NOT FOUND THEN RAISE EXCEPTION 'notification unavailable' USING ERRCODE='P0002'; END IF;
  RETURN app.notification_json(n);
END $$;

-- 10. Update get_notification_preferences and update_notification_preferences
CREATE OR REPLACE FUNCTION app.get_notification_preferences() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); p public.notification_preferences;
BEGIN
  SELECT * INTO p FROM public.notification_preferences WHERE user_id=u;
  RETURN jsonb_build_object(
    'connectionInvitations', coalesce(p.connection_invitations, true),
    'connectionUpdates', coalesce(p.connection_updates, true),
    'eventInvitations', coalesce(p.event_invitations, true),
    'eventUpdates', coalesce(p.event_updates, true),
    'version', coalesce(p.version, 0)
  );
END $$;

CREATE OR REPLACE FUNCTION app.update_notification_preferences(
  p_invites boolean,
  p_updates boolean,
  p_version integer,
  p_event_invites boolean DEFAULT NULL,
  p_event_updates boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); cur public.notification_preferences;
BEGIN
  IF p_version IS NULL OR p_version<0 THEN RAISE EXCEPTION 'invalid preference' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('notification_preferences:'||u::text,0));
  SELECT * INTO cur FROM public.notification_preferences WHERE user_id=u FOR UPDATE;
  IF coalesce(cur.version,0)<>p_version THEN RAISE EXCEPTION 'preference conflict' USING ERRCODE='40001'; END IF;
  INSERT INTO public.notification_preferences(user_id,connection_invitations,connection_updates,event_invitations,event_updates)
    VALUES(
      u,
      coalesce(p_invites, cur.connection_invitations, true),
      coalesce(p_updates, cur.connection_updates, true),
      coalesce(p_event_invites, cur.event_invitations, true),
      coalesce(p_event_updates, cur.event_updates, true)
    )
    ON CONFLICT(user_id) DO UPDATE SET
      connection_invitations=coalesce(p_invites, notification_preferences.connection_invitations),
      connection_updates=coalesce(p_updates, notification_preferences.connection_updates),
      event_invitations=coalesce(p_event_invites, notification_preferences.event_invitations),
      event_updates=coalesce(p_event_updates, notification_preferences.event_updates),
      version=notification_preferences.version+1;
  RETURN app.get_notification_preferences();
END $$;

-- 11. Trigger to enqueue event coordination notifications
CREATE OR REPLACE FUNCTION app.enqueue_event_coordination_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  rec RECORD;
  v_delivery_id uuid;
BEGIN
  FOR rec IN (
    SELECT ep.principal_id AS user_id
    FROM public.event_participants ep
    JOIN public.principals pr ON pr.id = ep.principal_id AND pr.type = 'user' AND pr.status = 'active'
    WHERE ep.event_id = NEW.event_id
      AND (
        (NEW.event_type IN ('proposed', 'cancelled', 'declined') AND ep.principal_id <> NEW.actor_user_id)
        OR
        (NEW.event_type = 'confirmed')
      )
  ) LOOP
    v_delivery_id := gen_random_uuid();
    INSERT INTO public.outbox_events(id, aggregate_type, aggregate_id, event_type, payload)
      VALUES(v_delivery_id, 'event', NEW.event_id, 'notification.requested', jsonb_build_object('eventId', v_delivery_id, 'coordinationEventId', NEW.id));
    INSERT INTO public.notification_deliveries(event_id, recipient_user_id, kind, coordination_event_id)
      VALUES(v_delivery_id, rec.user_id, NEW.event_type, NEW.id);
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_event_coordination_notification AFTER INSERT ON public.event_coordination_events
  FOR EACH ROW EXECUTE FUNCTION app.enqueue_event_coordination_notification();

-- 12. Update app.deliver_notification to handle both connection and event notifications
CREATE OR REPLACE FUNCTION app.deliver_notification(p_id uuid, p_generation integer, p_attempt integer) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  d public.notification_deliveries;
  pref public.notification_preferences;
  allowed boolean;
  e_conn public.connection_events;
  e_ev public.event_coordination_events;
BEGIN
  IF session_user<>'aven_worker' THEN RAISE EXCEPTION 'worker required' USING ERRCODE='42501'; END IF;
  IF p_generation IS NULL OR p_generation<0 OR p_attempt IS NULL OR p_attempt<1 OR p_attempt>5 THEN RAISE EXCEPTION 'invalid delivery' USING ERRCODE='22023'; END IF;
  SELECT * INTO d FROM public.notification_deliveries WHERE event_id=p_id FOR UPDATE;
  IF NOT FOUND OR d.generation<>p_generation THEN RETURN 'ignored'; END IF;
  IF d.status<>'pending' THEN RETURN d.status; END IF;

  SELECT * INTO pref FROM public.notification_preferences WHERE user_id=d.recipient_user_id;

  IF d.kind IN ('sent','accepted','declined','withdrawn','revoked') THEN
    SELECT * INTO STRICT e_conn FROM public.connection_events WHERE id=d.event_id;
    IF NOT EXISTS(SELECT 1 FROM public.outbox_events o WHERE o.id=d.event_id AND o.event_type='notification.requested'
      AND o.aggregate_type='connection_invitation' AND o.aggregate_id=e_conn.invitation_id AND o.payload=jsonb_build_object('eventId',e_conn.id)) THEN
      RAISE EXCEPTION 'invalid notification source' USING ERRCODE='22023';
    END IF;
    allowed:=CASE WHEN d.kind='sent' THEN coalesce(pref.connection_invitations,true) ELSE coalesce(pref.connection_updates,true) END;
    IF allowed AND e_conn.created_at>clock_timestamp()-interval '90 days' AND app.connection_notification_visible(e_conn.invitation_id,d.recipient_user_id,d.kind) THEN
      INSERT INTO public.notifications(event_id,recipient_user_id,invitation_id,kind) VALUES(d.event_id,d.recipient_user_id,e_conn.invitation_id,d.kind) ON CONFLICT(event_id) DO NOTHING;
      UPDATE public.notification_deliveries SET status='delivered',completed_at=clock_timestamp(),attempts=greatest(attempts,p_attempt),last_error_code=NULL WHERE event_id=p_id;
      RETURN 'delivered';
    END IF;
  ELSE
    SELECT * INTO STRICT e_ev FROM public.event_coordination_events WHERE id=d.coordination_event_id;
    IF NOT EXISTS(SELECT 1 FROM public.outbox_events o WHERE o.id=d.event_id AND o.event_type='notification.requested'
      AND o.aggregate_type='event' AND o.aggregate_id=e_ev.event_id) THEN
      RAISE EXCEPTION 'invalid notification source' USING ERRCODE='22023';
    END IF;
    allowed:=CASE WHEN d.kind='proposed' THEN coalesce(pref.event_invitations,true) ELSE coalesce(pref.event_updates,true) END;
    IF allowed AND e_ev.created_at>clock_timestamp()-interval '90 days' AND app.event_notification_visible(e_ev.event_id,d.recipient_user_id,d.kind) THEN
      INSERT INTO public.notifications(event_id,recipient_user_id,coordination_event_id,kind) VALUES(d.event_id,d.recipient_user_id,e_ev.event_id,d.kind) ON CONFLICT(event_id) DO NOTHING;
      UPDATE public.notification_deliveries SET status='delivered',completed_at=clock_timestamp(),attempts=greatest(attempts,p_attempt),last_error_code=NULL WHERE event_id=p_id;
      RETURN 'delivered';
    END IF;
  END IF;

  UPDATE public.notification_deliveries SET status='suppressed',completed_at=clock_timestamp(),attempts=greatest(attempts,p_attempt),last_error_code=NULL WHERE event_id=p_id;
  RETURN 'suppressed';
END $$;

-- 13. Hook event operations to record event_coordination_events

-- 13a. Update app.propose_event_time
CREATE OR REPLACE FUNCTION app.propose_event_time(
  p_event_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_timezone text DEFAULT 'Asia/Shanghai',
  p_expected_version integer DEFAULT 1
) RETURNS TABLE (
  event_id uuid,
  new_version integer,
  new_status public.event_status,
  start_at timestamptz,
  end_at timestamptz,
  proposal_id uuid
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_now timestamptz := clock_timestamp();
  v_event public.events;
  v_proposal_id uuid;
  v_next_version integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  IF p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'end_at must be strictly after start_at' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_event
  FROM public.events
  WHERE events.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_event.version <> p_expected_version THEN
    RAISE EXCEPTION 'event version conflict' USING ERRCODE = '40001';
  END IF;

  IF v_event.status IN ('cancelled', 'ended') THEN
    RAISE EXCEPTION 'event is in terminal state' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.event_participants
  WHERE event_participants.event_id = p_event_id
    AND event_participants.principal_id = v_user_id;

  IF NOT FOUND AND v_event.organizer_principal_id <> v_user_id THEN
    RAISE EXCEPTION 'access denied to propose time for event' USING ERRCODE = '42501';
  END IF;

  v_next_version := v_event.version + 1;

  UPDATE public.event_proposals
  SET status = 'superseded'
  WHERE event_proposals.event_id = p_event_id
    AND event_proposals.status = 'proposed';

  INSERT INTO public.event_proposals (
    event_id,
    version,
    start_at,
    end_at,
    timezone,
    status,
    created_at
  ) VALUES (
    p_event_id,
    v_next_version,
    p_start_at,
    p_end_at,
    coalesce(p_timezone, 'Asia/Shanghai'),
    'proposed',
    v_now
  )
  RETURNING event_proposals.id INTO v_proposal_id;

  UPDATE public.events
  SET
    start_at = p_start_at,
    end_at = p_end_at,
    timezone = coalesce(p_timezone, events.timezone),
    status = 'pending_confirmation',
    version = v_next_version,
    updated_at = v_now
  WHERE events.id = p_event_id;

  UPDATE public.event_participants
  SET
    response = CASE WHEN principal_id = v_user_id THEN 'accepted'::public.event_participant_response ELSE 'pending'::public.event_participant_response END,
    responded_at = CASE WHEN principal_id = v_user_id THEN v_now ELSE NULL END,
    updated_at = v_now
  WHERE event_participants.event_id = p_event_id;

  INSERT INTO public.event_coordination_events (
    event_id,
    actor_user_id,
    event_type,
    version,
    created_at
  ) VALUES (
    p_event_id,
    v_user_id,
    'proposed',
    v_next_version,
    v_now
  );

  RETURN QUERY
  SELECT
    v_event.id,
    v_next_version,
    'pending_confirmation'::public.event_status,
    p_start_at,
    p_end_at,
    v_proposal_id;
END;
$$;

-- 13b. Update app.respond_event_participant
CREATE OR REPLACE FUNCTION app.respond_event_participant(
  p_event_id uuid,
  p_response public.event_participant_response,
  p_expected_version integer DEFAULT NULL
) RETURNS TABLE (
  event_id uuid,
  status public.event_status,
  version integer,
  my_response public.event_participant_response,
  all_accepted boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_now timestamptz := clock_timestamp();
  v_event public.events;
  v_pending_count integer;
  v_all_accepted boolean := false;
  v_new_status public.event_status;
  v_final_version integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_event
  FROM public.events
  WHERE events.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_expected_version IS NOT NULL AND v_event.version <> p_expected_version THEN
    RAISE EXCEPTION 'event version conflict' USING ERRCODE = '40001';
  END IF;

  IF v_event.status IN ('cancelled', 'ended') THEN
    RAISE EXCEPTION 'event is in terminal state' USING ERRCODE = '22023';
  END IF;

  UPDATE public.event_participants
  SET
    response = p_response,
    responded_at = v_now,
    updated_at = v_now
  WHERE event_participants.event_id = p_event_id
    AND event_participants.principal_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'participant not invited to event' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_pending_count
  FROM public.event_participants
  WHERE event_participants.event_id = p_event_id
    AND event_participants.response <> 'accepted';

  v_all_accepted := (v_pending_count = 0);
  v_new_status := v_event.status;
  v_final_version := v_event.version;

  IF v_all_accepted THEN
    v_new_status := 'confirmed';
    v_final_version := v_event.version + 1;
    UPDATE public.events
    SET
      status = 'confirmed',
      version = v_final_version,
      updated_at = v_now
    WHERE events.id = p_event_id;

    UPDATE public.event_proposals
    SET status = 'accepted'
    WHERE event_proposals.event_id = p_event_id
      AND event_proposals.version = v_event.version;

    INSERT INTO public.event_coordination_events (
      event_id,
      actor_user_id,
      event_type,
      version,
      created_at
    ) VALUES (
      p_event_id,
      v_user_id,
      'confirmed',
      v_final_version,
      v_now
    );
  ELSIF p_response = 'declined' THEN
    INSERT INTO public.event_coordination_events (
      event_id,
      actor_user_id,
      event_type,
      version,
      created_at
    ) VALUES (
      p_event_id,
      v_user_id,
      'declined',
      v_final_version,
      v_now
    );
  END IF;

  RETURN QUERY
  SELECT
    v_event.id,
    v_new_status,
    v_final_version,
    p_response,
    v_all_accepted;
END;
$$;

-- 13c. Update app.cancel_event
CREATE OR REPLACE FUNCTION app.cancel_event(
  p_event_id uuid,
  p_reason text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_now timestamptz := clock_timestamp();
  v_event public.events;
  v_is_participant boolean;
  v_next_version integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_event
  FROM public.events
  WHERE events.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event not found' USING ERRCODE = 'P0002';
  END IF;

  v_is_participant := (v_event.organizer_principal_id = v_user_id) OR EXISTS (
    SELECT 1 FROM public.event_participants
    WHERE event_participants.event_id = p_event_id
      AND event_participants.principal_id = v_user_id
  );

  IF NOT v_is_participant THEN
    RAISE EXCEPTION 'access denied to cancel event' USING ERRCODE = '42501';
  END IF;

  v_next_version := v_event.version + 1;

  UPDATE public.events
  SET
    status = 'cancelled',
    version = v_next_version,
    updated_at = v_now
  WHERE events.id = p_event_id;

  INSERT INTO public.event_coordination_events (
    event_id,
    actor_user_id,
    event_type,
    version,
    created_at
  ) VALUES (
    p_event_id,
    v_user_id,
    'cancelled',
    v_next_version,
    v_now
  );

  RETURN true;
END;
$$;

-- 14. Function permissions and ownership
DO $$ DECLARE signature text; BEGIN
  GRANT CREATE ON SCHEMA app TO aven_function_owner;
  FOREACH signature IN ARRAY ARRAY[
    'event_notification_visible(uuid,uuid,text)',
    'enqueue_event_coordination_notification()',
    'notification_json(public.notifications)',
    'list_notifications(integer,timestamptz,uuid)',
    'read_notification(uuid)',
    'get_notification_preferences()',
    'update_notification_preferences(boolean,boolean,integer,boolean,boolean)',
    'deliver_notification(uuid,integer,integer)',
    'propose_event_time(uuid,timestamptz,timestamptz,text,integer)',
    'respond_event_participant(uuid,public.event_participant_response,integer)',
    'cancel_event(uuid,text)'
  ] LOOP
    EXECUTE 'ALTER FUNCTION app.'||signature||' OWNER TO aven_function_owner';
    EXECUTE 'REVOKE ALL ON FUNCTION app.'||signature||' FROM PUBLIC';
  END LOOP;
  REVOKE CREATE ON SCHEMA app FROM aven_function_owner;
END $$;

GRANT EXECUTE ON FUNCTION
  app.event_notification_visible(uuid,uuid,text),
  app.list_notifications(integer,timestamptz,uuid),
  app.read_notification(uuid),
  app.get_notification_preferences(),
  app.update_notification_preferences(boolean,boolean,integer,boolean,boolean),
  app.propose_event_time(uuid,timestamptz,timestamptz,text,integer),
  app.respond_event_participant(uuid,public.event_participant_response,integer),
  app.cancel_event(uuid,text)
TO aven_app;

GRANT EXECUTE ON FUNCTION
  app.deliver_notification(uuid,integer,integer),
  app.event_notification_visible(uuid,uuid,text)
TO aven_worker;
