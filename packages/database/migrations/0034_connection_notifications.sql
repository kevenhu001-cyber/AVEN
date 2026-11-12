-- M6-06A1: metadata-only personal connection notifications.
CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.users(id),
  connection_invitations boolean NOT NULL DEFAULT true,
  connection_updates boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE TABLE public.notification_deliveries (
  event_id uuid PRIMARY KEY REFERENCES public.connection_events(id),
  recipient_user_id uuid NOT NULL REFERENCES public.users(id),
  kind text NOT NULL CHECK(kind IN ('sent','accepted','declined','withdrawn','revoked')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','suppressed','dead')),
  generation integer NOT NULL DEFAULT 0 CHECK(generation>=0),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  last_error_code text CHECK(last_error_code IS NULL OR last_error_code='DELIVERY_FAILED'),
  last_queued_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(event_id) REFERENCES public.outbox_events(id)
);
CREATE INDEX idx_notification_deliveries_pending ON public.notification_deliveries(last_queued_at,event_id) WHERE status='pending';
CREATE INDEX idx_notification_deliveries_dead ON public.notification_deliveries(created_at DESC,event_id DESC) WHERE status='dead';
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES public.notification_deliveries(event_id),
  recipient_user_id uuid NOT NULL REFERENCES public.users(id),
  invitation_id uuid NOT NULL REFERENCES public.connection_invitations(id),
  kind text NOT NULL CHECK(kind IN ('sent','accepted','declined','withdrawn','revoked')),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_notifications_recipient ON public.notifications(recipient_user_id,created_at DESC,id DESC);
CREATE INDEX idx_notifications_retention ON public.notifications(created_at,id);
CREATE TABLE public.notification_delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.notification_deliveries(event_id),
  actor_user_id uuid REFERENCES public.users(id),
  event_type text NOT NULL CHECK(event_type IN ('dead','retried')),
  generation integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(event_id,event_type,generation)
);
CREATE INDEX idx_notification_delivery_events_event ON public.notification_delivery_events(event_id,created_at);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['notification_preferences','notification_deliveries','notifications','notification_delivery_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO aven_function_owner USING(true) WITH CHECK(true)',t||'_function',t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO aven_migrator USING(true) WITH CHECK(true)',t||'_migrator',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON public.notification_preferences,public.notification_deliveries,public.notifications TO aven_function_owner;
GRANT DELETE ON public.notifications TO aven_function_owner;
GRANT SELECT,INSERT ON public.notification_delivery_events TO aven_function_owner;
CREATE POLICY notification_deliveries_worker ON public.notification_deliveries FOR SELECT TO aven_worker USING(app.is_worker());
GRANT SELECT ON public.notification_deliveries TO aven_worker;
CREATE POLICY notification_outbox_function ON public.outbox_events FOR ALL TO aven_function_owner
  USING(event_type='notification.requested') WITH CHECK(event_type='notification.requested');
GRANT SELECT ON public.outbox_events TO aven_function_owner;
GRANT INSERT(id,aggregate_type,aggregate_id,event_type,payload) ON public.outbox_events TO aven_function_owner;
GRANT UPDATE(status,available_at,locked_at,locked_by,lease_expires_at,processed_at,last_error,attempts) ON public.outbox_events TO aven_function_owner;

CREATE FUNCTION app.connection_notification_visible(p_invitation uuid,p_recipient uuid,p_kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.connection_invitations i JOIN public.consent_grants g ON g.id=i.grant_id
  WHERE i.id=p_invitation AND (session_user='aven_worker' OR (p_recipient=app.current_user_id() AND app.current_user_id()=app.current_principal_id()))
    AND (SELECT count(*) FROM public.principals x WHERE x.id IN(i.sender_user_id,i.recipient_user_id) AND x.type='user' AND x.status='active')=2
    AND CASE p_kind
      WHEN 'sent' THEN p_recipient=i.recipient_user_id AND i.status='pending' AND i.expires_at>clock_timestamp()
        AND g.status='active' AND g.expires_at>clock_timestamp() AND EXISTS(
          SELECT 1 FROM public.consent_grant_items s JOIN public.memory_items m ON m.id=s.source_id
          JOIN public.context_field_policies p ON p.source_id=m.id AND p.source_type='memory_item' AND p.field_key='content'
          WHERE s.grant_id=g.id AND s.status='active' AND s.purged_at IS NULL
            AND m.owner_principal_id=i.sender_user_id AND p.owner_principal_id=i.sender_user_id
            AND m.status='confirmed' AND m.deleted_at IS NULL AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())
            AND 'sharing'=ANY(p.allowed_uses))
      WHEN 'accepted' THEN p_recipient=i.sender_user_id AND i.status='accepted'
      WHEN 'declined' THEN p_recipient=i.sender_user_id AND i.status='declined'
      WHEN 'withdrawn' THEN p_recipient=i.recipient_user_id AND i.status='withdrawn'
      WHEN 'revoked' THEN p_recipient=i.recipient_user_id AND g.status='revoked'
      ELSE false END);
$$;
CREATE POLICY notifications_recipient ON public.notifications FOR SELECT TO aven_app USING(
  recipient_user_id=app.current_user_id() AND app.current_user_id()=app.current_principal_id()
  AND created_at>clock_timestamp()-interval '90 days'
  AND app.connection_notification_visible(invitation_id,recipient_user_id,kind));
GRANT SELECT ON public.notifications TO aven_app;

CREATE FUNCTION app.enqueue_connection_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE v public.connection_invitations; u uuid;
BEGIN
  SELECT * INTO STRICT v FROM public.connection_invitations WHERE id=NEW.invitation_id;
  u:=CASE WHEN NEW.event_type IN('accepted','declined') THEN v.sender_user_id ELSE v.recipient_user_id END;
  INSERT INTO public.outbox_events(id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(NEW.id,'connection_invitation',NEW.invitation_id,'notification.requested',jsonb_build_object('eventId',NEW.id));
  INSERT INTO public.notification_deliveries(event_id,recipient_user_id,kind) VALUES(NEW.id,u,NEW.event_type);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_connection_notification AFTER INSERT ON public.connection_events
  FOR EACH ROW EXECUTE FUNCTION app.enqueue_connection_notification();

CREATE FUNCTION app.notification_json(p public.notifications) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,app,pg_temp AS $$
 SELECT jsonb_build_object('id',p.id,'kind',p.kind,'target',jsonb_build_object('type','connection_invitation','id',p.invitation_id),'createdAt',p.created_at,'readAt',p.read_at);
$$;
CREATE FUNCTION app.list_notifications(p_limit integer,p_cursor_at timestamptz,p_cursor_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); rows jsonb; page jsonb; last_row jsonb; unread integer;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR (p_cursor_at IS NULL)<>(p_cursor_id IS NULL) THEN RAISE EXCEPTION 'invalid notification cursor' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(app.notification_json(n) ORDER BY n.created_at DESC,n.id DESC),'[]') INTO rows
    FROM (SELECT * FROM public.notifications WHERE recipient_user_id=u AND created_at>clock_timestamp()-interval '90 days'
      AND app.connection_notification_visible(invitation_id,u,kind) AND (p_cursor_at IS NULL OR (created_at,id)<(p_cursor_at,p_cursor_id))
      ORDER BY created_at DESC,id DESC LIMIT p_limit+1) n;
  SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]') INTO page FROM jsonb_array_elements(rows) WITH ORDINALITY a(value,ord) WHERE ord<=p_limit;
  SELECT count(*) INTO unread FROM public.notifications WHERE recipient_user_id=u AND read_at IS NULL
    AND created_at>clock_timestamp()-interval '90 days' AND app.connection_notification_visible(invitation_id,u,kind);
  last_row:=page->(jsonb_array_length(page)-1);
  RETURN jsonb_build_object('data',page,'unreadCount',unread,'nextCursor',CASE WHEN jsonb_array_length(rows)>p_limit
    THEN jsonb_build_object('createdAt',last_row->'createdAt','id',last_row->'id') ELSE 'null'::jsonb END);
END $$;
CREATE FUNCTION app.read_notification(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); n public.notifications;
BEGIN
  UPDATE public.notifications SET read_at=coalesce(read_at,clock_timestamp()) WHERE id=p_id AND recipient_user_id=u
    AND created_at>clock_timestamp()-interval '90 days' AND app.connection_notification_visible(invitation_id,u,kind) RETURNING * INTO n;
  IF NOT FOUND THEN RAISE EXCEPTION 'notification unavailable' USING ERRCODE='P0002'; END IF;
  RETURN app.notification_json(n);
END $$;
CREATE FUNCTION app.get_notification_preferences() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); p public.notification_preferences;
BEGIN
  SELECT * INTO p FROM public.notification_preferences WHERE user_id=u;
  RETURN jsonb_build_object('connectionInvitations',coalesce(p.connection_invitations,true),'connectionUpdates',coalesce(p.connection_updates,true),'version',coalesce(p.version,0));
END $$;
CREATE FUNCTION app.update_notification_preferences(p_invites boolean,p_updates boolean,p_version integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); v integer;
BEGIN
  IF p_invites IS NULL OR p_updates IS NULL OR p_version IS NULL OR p_version<0 THEN RAISE EXCEPTION 'invalid preference' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('notification_preferences:'||u::text,0));
  SELECT version INTO v FROM public.notification_preferences WHERE user_id=u FOR UPDATE;
  IF coalesce(v,0)<>p_version THEN RAISE EXCEPTION 'preference conflict' USING ERRCODE='40001'; END IF;
  INSERT INTO public.notification_preferences(user_id,connection_invitations,connection_updates) VALUES(u,p_invites,p_updates)
    ON CONFLICT(user_id) DO UPDATE SET connection_invitations=p_invites,connection_updates=p_updates,version=notification_preferences.version+1;
  RETURN app.get_notification_preferences();
END $$;

CREATE FUNCTION app.deliver_notification(p_id uuid,p_generation integer,p_attempt integer) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE d public.notification_deliveries; e public.connection_events; pref public.notification_preferences; allowed boolean;
BEGIN
  IF session_user<>'aven_worker' THEN RAISE EXCEPTION 'worker required' USING ERRCODE='42501'; END IF;
  IF p_generation IS NULL OR p_generation<0 OR p_attempt IS NULL OR p_attempt<1 OR p_attempt>5 THEN RAISE EXCEPTION 'invalid delivery' USING ERRCODE='22023'; END IF;
  SELECT * INTO d FROM public.notification_deliveries WHERE event_id=p_id FOR UPDATE;
  IF NOT FOUND OR d.generation<>p_generation THEN RETURN 'ignored'; END IF;
  IF d.status<>'pending' THEN RETURN d.status; END IF;
  SELECT * INTO STRICT e FROM public.connection_events WHERE id=d.event_id;
  IF NOT EXISTS(SELECT 1 FROM public.outbox_events o WHERE o.id=d.event_id AND o.event_type='notification.requested'
    AND o.aggregate_type='connection_invitation' AND o.aggregate_id=e.invitation_id AND o.payload=jsonb_build_object('eventId',e.id)) THEN
    RAISE EXCEPTION 'invalid notification source' USING ERRCODE='22023'; END IF;
  SELECT * INTO pref FROM public.notification_preferences WHERE user_id=d.recipient_user_id;
  allowed:=CASE WHEN d.kind='sent' THEN coalesce(pref.connection_invitations,true) ELSE coalesce(pref.connection_updates,true) END;
  IF allowed AND e.created_at>clock_timestamp()-interval '90 days' AND app.connection_notification_visible(e.invitation_id,d.recipient_user_id,d.kind) THEN
    INSERT INTO public.notifications(event_id,recipient_user_id,invitation_id,kind) VALUES(d.event_id,d.recipient_user_id,e.invitation_id,d.kind) ON CONFLICT(event_id) DO NOTHING;
    UPDATE public.notification_deliveries SET status='delivered',completed_at=clock_timestamp(),attempts=greatest(attempts,p_attempt),last_error_code=NULL WHERE event_id=p_id;
    RETURN 'delivered';
  END IF;
  UPDATE public.notification_deliveries SET status='suppressed',completed_at=clock_timestamp(),attempts=greatest(attempts,p_attempt),last_error_code=NULL WHERE event_id=p_id;
  RETURN 'suppressed';
END $$;
CREATE FUNCTION app.fail_notification_delivery(p_id uuid,p_generation integer,p_attempt integer) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE d public.notification_deliveries;
BEGIN
  IF session_user<>'aven_worker' THEN RAISE EXCEPTION 'worker required' USING ERRCODE='42501'; END IF;
  IF p_generation IS NULL OR p_generation<0 OR p_attempt IS NULL OR p_attempt<1 OR p_attempt>5 THEN RAISE EXCEPTION 'invalid attempt' USING ERRCODE='22023'; END IF;
  SELECT * INTO d FROM public.notification_deliveries WHERE event_id=p_id FOR UPDATE;
  IF NOT FOUND OR d.generation<>p_generation OR d.status<>'pending' THEN RETURN; END IF;
  UPDATE public.notification_deliveries SET attempts=greatest(attempts,p_attempt),last_error_code='DELIVERY_FAILED',
    status=CASE WHEN p_attempt=5 THEN 'dead' ELSE 'pending' END WHERE event_id=p_id;
  IF p_attempt=5 THEN INSERT INTO public.notification_delivery_events(event_id,event_type,generation) VALUES(p_id,'dead',p_generation) ON CONFLICT DO NOTHING; END IF;
END $$;
CREATE FUNCTION app.mark_notification_enqueued(p_id uuid,p_generation integer) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF session_user<>'aven_worker' THEN RAISE EXCEPTION 'worker required' USING ERRCODE='42501'; END IF;
  UPDATE public.notification_deliveries SET last_queued_at=clock_timestamp() WHERE event_id=p_id AND generation=p_generation AND status='pending';
END $$;
CREATE FUNCTION app.list_dead_notifications() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  PERFORM app.peer_actor();
  IF NOT app.is_platform_admin() THEN RAISE EXCEPTION 'platform administrator required' USING ERRCODE='42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',event_id,'kind',kind,'generation',generation,'attempts',attempts,'errorCode',last_error_code,'createdAt',created_at) ORDER BY created_at DESC,event_id DESC)
    FROM (SELECT * FROM public.notification_deliveries WHERE status='dead' ORDER BY created_at DESC,event_id DESC LIMIT 100) d),'[]');
END $$;
CREATE FUNCTION app.retry_notification_delivery(p_id uuid,p_generation integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); d public.notification_deliveries;
BEGIN
  IF NOT app.is_platform_admin() THEN RAISE EXCEPTION 'platform administrator required' USING ERRCODE='42501'; END IF;
  SELECT * INTO d FROM public.notification_deliveries WHERE event_id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'delivery unavailable' USING ERRCODE='P0002'; END IF;
  IF p_generation IS NULL OR d.status<>'dead' OR d.generation<>p_generation THEN RAISE EXCEPTION 'delivery conflict' USING ERRCODE='40001'; END IF;
  UPDATE public.notification_deliveries SET status='pending',generation=generation+1,attempts=0,last_error_code=NULL,last_queued_at=NULL,completed_at=NULL WHERE event_id=p_id;
  UPDATE public.outbox_events SET status='pending',available_at=clock_timestamp(),attempts=0,locked_at=NULL,locked_by=NULL,lease_expires_at=NULL,processed_at=NULL,last_error=NULL WHERE id=p_id;
  INSERT INTO public.notification_delivery_events(event_id,actor_user_id,event_type,generation) VALUES(p_id,u,'retried',d.generation+1);
  RETURN jsonb_build_object('id',p_id,'generation',d.generation+1,'status','pending');
END $$;
CREATE FUNCTION app.purge_old_notifications(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE n integer;
BEGIN
  IF session_user<>'aven_worker' THEN RAISE EXCEPTION 'worker required' USING ERRCODE='42501'; END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'invalid batch' USING ERRCODE='22023'; END IF;
  WITH old AS(SELECT id FROM public.notifications WHERE created_at<=clock_timestamp()-interval '90 days' ORDER BY created_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED)
    DELETE FROM public.notifications WHERE id IN(SELECT id FROM old);
  GET DIAGNOSTICS n=ROW_COUNT;
  RETURN n;
END $$;
DO $$ DECLARE signature text; BEGIN
  GRANT CREATE ON SCHEMA app TO aven_function_owner;
  FOREACH signature IN ARRAY ARRAY[
    'connection_notification_visible(uuid,uuid,text)','enqueue_connection_notification()','notification_json(public.notifications)',
    'list_notifications(integer,timestamptz,uuid)','read_notification(uuid)','get_notification_preferences()',
    'update_notification_preferences(boolean,boolean,integer)','deliver_notification(uuid,integer,integer)',
    'fail_notification_delivery(uuid,integer,integer)','mark_notification_enqueued(uuid,integer)',
    'list_dead_notifications()','retry_notification_delivery(uuid,integer)','purge_old_notifications(integer)'
  ] LOOP
    EXECUTE 'ALTER FUNCTION app.'||signature||' OWNER TO aven_function_owner';
    EXECUTE 'REVOKE ALL ON FUNCTION app.'||signature||' FROM PUBLIC';
  END LOOP;
  REVOKE CREATE ON SCHEMA app FROM aven_function_owner;
END $$;
GRANT EXECUTE ON FUNCTION app.connection_notification_visible(uuid,uuid,text),app.list_notifications(integer,timestamptz,uuid),app.read_notification(uuid),
  app.get_notification_preferences(),app.update_notification_preferences(boolean,boolean,integer),app.list_dead_notifications(),app.retry_notification_delivery(uuid,integer) TO aven_app;
GRANT EXECUTE ON FUNCTION app.deliver_notification(uuid,integer,integer),app.fail_notification_delivery(uuid,integer,integer),
  app.mark_notification_enqueued(uuid,integer),app.purge_old_notifications(integer) TO aven_worker;
