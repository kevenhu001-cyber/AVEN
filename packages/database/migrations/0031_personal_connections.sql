-- Personal invitations are separate from opportunity/organization referrals.
CREATE TABLE public.connection_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES public.users(id),
  recipient_user_id uuid NOT NULL REFERENCES public.users(id),
  memory_item_ids uuid[] NOT NULL,
  manifest jsonb NOT NULL,
  grant_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  result_invitation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (actor_user_id <> recipient_user_id),
  CHECK (cardinality(memory_item_ids) BETWEEN 1 AND 10)
);
CREATE INDEX idx_connection_previews_actor ON public.connection_previews(actor_user_id, expires_at);
CREATE TABLE public.connection_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id uuid NOT NULL REFERENCES public.users(id),
  recipient_user_id uuid NOT NULL REFERENCES public.users(id),
  preview_id uuid NOT NULL UNIQUE REFERENCES public.connection_previews(id),
  idempotency_key uuid NOT NULL,
  grant_id uuid NOT NULL UNIQUE REFERENCES public.consent_grants(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','withdrawn')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  sender_confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recipient_decided_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (sender_user_id <> recipient_user_id),
  UNIQUE(sender_user_id,idempotency_key)
);
CREATE UNIQUE INDEX uq_connection_invitation_pair ON public.connection_invitations
  (least(sender_user_id,recipient_user_id),greatest(sender_user_id,recipient_user_id))
  WHERE status IN ('pending','accepted');
CREATE INDEX idx_connection_invitations_recipient ON public.connection_invitations(recipient_user_id,created_at DESC,id DESC);
CREATE INDEX idx_connection_invitations_sender ON public.connection_invitations(sender_user_id,created_at DESC,id DESC);
ALTER TABLE public.connection_previews ADD CONSTRAINT fk_connection_preview_result
  FOREIGN KEY(result_invitation_id) REFERENCES public.connection_invitations(id);
ALTER TABLE public.consent_grants ADD COLUMN connection_invitation_id uuid
  REFERENCES public.connection_invitations(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.consent_grants ADD CONSTRAINT chk_connection_grant_binding CHECK (
  (purpose <> 'connection_invitation' AND connection_invitation_id IS NULL)
  OR (purpose = 'connection_invitation' AND connection_invitation_id IS NOT NULL AND referral_id IS NULL AND event_id IS NULL)
);
CREATE TABLE public.peer_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_low uuid NOT NULL REFERENCES public.users(id),
  user_high uuid NOT NULL REFERENCES public.users(id),
  invitation_id uuid NOT NULL UNIQUE REFERENCES public.connection_invitations(id),
  established_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (user_low < user_high),
  UNIQUE(user_low,user_high)
);
CREATE INDEX idx_peer_connections_high ON public.peer_connections(user_high);
CREATE TABLE public.connection_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES public.connection_invitations(id),
  actor_user_id uuid NOT NULL REFERENCES public.users(id),
  event_type text NOT NULL CHECK(event_type IN ('sent','accepted','declined','withdrawn','revoked')),
  version integer NOT NULL CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_connection_events_invitation ON public.connection_events(invitation_id,created_at);

ALTER TABLE public.connection_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connection_previews FORCE ROW LEVEL SECURITY;
ALTER TABLE public.connection_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connection_invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.peer_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE public.connection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connection_events FORCE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['connection_previews','connection_invitations','peer_connections','connection_events'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO aven_function_owner USING (true) WITH CHECK (true)',t||'_function_all',t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO aven_migrator USING (true) WITH CHECK (true)',t||'_migrator_all',t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO aven_function_owner',t);
  END LOOP;
END $$;
CREATE POLICY connection_invitations_participant ON public.connection_invitations FOR SELECT TO aven_app
  USING (app.current_principal_id() = app.current_user_id() AND app.current_user_id() IN (sender_user_id,recipient_user_id));
CREATE POLICY peer_connections_participant ON public.peer_connections FOR SELECT TO aven_app
  USING (app.current_principal_id() = app.current_user_id() AND app.current_user_id() IN (user_low,user_high));
GRANT SELECT ON public.connection_invitations, public.peer_connections TO aven_app;

CREATE FUNCTION app.peer_actor() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid := app.current_user_id();
BEGIN
  IF u IS NULL OR u IS DISTINCT FROM app.current_principal_id() OR NOT EXISTS(
    SELECT 1 FROM public.users x JOIN public.principals p ON p.id=x.id WHERE x.id=u AND p.status='active' AND p.type='user'
  ) THEN RAISE EXCEPTION 'active personal context required' USING ERRCODE='28000'; END IF;
  RETURN u;
END $$;

-- Locks the source and policy rows in a stable order. No title or metadata is shared.
CREATE FUNCTION app.peer_source_manifest(p_actor uuid,p_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE r record; result jsonb := '[]';
BEGIN
  IF p_actor IS DISTINCT FROM app.peer_actor() OR p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 10
    OR EXISTS(SELECT 1 FROM unnest(p_ids) x WHERE x IS NULL)
    OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> cardinality(p_ids)
    THEN RAISE EXCEPTION 'invalid source selection' USING ERRCODE='22023'; END IF;
  FOR r IN SELECT m.id,m.content,m.version,m.valid_until,p.version AS policy_version
    FROM public.memory_items m JOIN public.context_field_policies p
      ON p.source_id=m.id AND p.source_type='memory_item' AND p.field_key='content'
    WHERE m.id=ANY(p_ids) AND m.owner_principal_id=p_actor AND p.owner_principal_id=p_actor
      AND m.status='confirmed' AND m.deleted_at IS NULL
      AND (m.valid_from IS NULL OR m.valid_from<=clock_timestamp())
      AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())
      AND 'sharing'=ANY(p.allowed_uses)
    ORDER BY m.id FOR SHARE OF m,p
  LOOP
    result := result || jsonb_build_array(jsonb_build_object('sourceId',r.id,'value',r.content,
      'sourceVersion',r.version,'policyVersion',r.policy_version,'validUntil',r.valid_until));
  END LOOP;
  IF jsonb_array_length(result)<>cardinality(p_ids) THEN
    RAISE EXCEPTION 'selected source unavailable' USING ERRCODE='22023';
  END IF;
  RETURN result;
END $$;

CREATE FUNCTION app.create_connection_preview(p_recipient uuid,p_ids uuid[],p_days integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); m jsonb; v public.connection_previews; expiry timestamptz;
BEGIN
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 7 OR p_recipient=u THEN
    RAISE EXCEPTION 'invalid preview' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users x JOIN public.principals p ON p.id=x.id
    WHERE x.id=p_recipient AND p.type='user' AND p.status='active') THEN
    RAISE EXCEPTION 'recipient unavailable' USING ERRCODE='P0002'; END IF;
  m:=app.peer_source_manifest(u,p_ids);
  SELECT least(clock_timestamp()+make_interval(days=>p_days),min((x->>'validUntil')::timestamptz)) INTO expiry FROM jsonb_array_elements(m) x;
  INSERT INTO public.connection_previews(actor_user_id,recipient_user_id,memory_item_ids,manifest,grant_expires_at,expires_at)
    VALUES(u,p_recipient,p_ids,m,expiry,least(clock_timestamp()+interval '10 minutes',expiry)) RETURNING * INTO v;
  RETURN jsonb_build_object('id',v.id,'recipientUserId',p_recipient,'purpose','connection_invitation',
    'snapshot',m,'grantExpiresAt',v.grant_expires_at,'expiresAt',v.expires_at);
END $$;

CREATE FUNCTION app.get_connection_invitation(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); v public.connection_invitations; g public.consent_grants; c uuid;
BEGIN
  SELECT * INTO v FROM public.connection_invitations WHERE id=p_id AND u IN(sender_user_id,recipient_user_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO g FROM public.consent_grants WHERE id=v.grant_id;
  SELECT id INTO c FROM public.peer_connections WHERE invitation_id=v.id;
  RETURN jsonb_build_object('id',v.id,'senderUserId',v.sender_user_id,'recipientUserId',v.recipient_user_id,
    'status',CASE WHEN v.status='pending' AND v.expires_at<=clock_timestamp() THEN 'expired' ELSE v.status END,
    'version',v.version,'grantId',v.grant_id,'grantStatus',CASE WHEN g.status='active' AND g.expires_at<=clock_timestamp() THEN 'expired' ELSE g.status::text END,
    'senderConfirmedAt',v.sender_confirmed_at,'recipientDecidedAt',v.recipient_decided_at,
    'expiresAt',v.expires_at,'createdAt',v.created_at,'connectionId',c);
END $$;

CREATE FUNCTION app.send_connection_invitation(p_preview uuid,p_key uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); v public.connection_previews; existing public.connection_invitations;
  m jsonb; v_invitation_id uuid:=gen_random_uuid(); v_grant_id uuid:=gen_random_uuid(); x jsonb;
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

-- Authorization is always checked at the main database read, never via a cached response.
CREATE FUNCTION app.connection_snapshot(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); v public.connection_invitations; g public.consent_grants; result jsonb;
BEGIN
  SELECT * INTO v FROM public.connection_invitations WHERE id=p_id AND u IN(sender_user_id,recipient_user_id) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO g FROM public.consent_grants WHERE id=v.grant_id FOR SHARE;
  IF v.status NOT IN('pending','accepted') OR g.status<>'active' OR g.expires_at<=clock_timestamp()
    OR g.purpose<>'connection_invitation' OR g.connection_invitation_id<>v.id
    OR g.grantor_principal_id<>v.sender_user_id OR g.grantee_principal_id<>v.recipient_user_id
    OR (SELECT count(*) FROM public.principals WHERE id IN(v.sender_user_id,v.recipient_user_id) AND type='user' AND status='active')<>2
    THEN RETURN '[]'::jsonb; END IF;
  SELECT jsonb_agg(jsonb_build_object('sourceId',s.source_id,'field',s.field_key,'value',s.value_snapshot) ORDER BY s.source_id)
    INTO result FROM public.consent_grant_items s
    JOIN public.memory_items m ON m.id=s.source_id AND m.owner_principal_id=v.sender_user_id
    JOIN public.context_field_policies p ON p.source_id=m.id AND p.source_type='memory_item' AND p.field_key='content'
    WHERE s.grant_id=g.id AND s.status='active' AND s.source_type='memory_item' AND s.field_key='content'
      AND m.status='confirmed' AND m.deleted_at IS NULL AND (m.valid_from IS NULL OR m.valid_from<=clock_timestamp())
      AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()) AND p.owner_principal_id=v.sender_user_id AND 'sharing'=ANY(p.allowed_uses);
  RETURN coalesce(result,'[]');
END $$;

CREATE FUNCTION app.decide_connection_invitation(p_id uuid,p_decision text,p_version integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); v public.connection_invitations; g public.consent_grants;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN('accepted','declined') OR p_version IS NULL OR p_version<1 THEN
    RAISE EXCEPTION 'invalid decision' USING ERRCODE='22023'; END IF;
  SELECT * INTO v FROM public.connection_invitations WHERE id=p_id AND recipient_user_id=u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='P0002'; END IF;
  IF v.status=p_decision AND v.version=p_version+1 THEN RETURN app.get_connection_invitation(v.id); END IF;
  IF v.status<>'pending' OR v.version<>p_version OR v.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'invitation conflict' USING ERRCODE='40001'; END IF;
  SELECT * INTO g FROM public.consent_grants WHERE id=v.grant_id FOR UPDATE;
  IF g.status<>'active' OR g.expires_at<=clock_timestamp() OR jsonb_array_length(app.connection_snapshot(v.id))=0 THEN
    RAISE EXCEPTION 'invitation consent unavailable' USING ERRCODE='40001'; END IF;
  IF p_decision='accepted' THEN
    INSERT INTO public.peer_connections(user_low,user_high,invitation_id)
      VALUES(least(v.sender_user_id,v.recipient_user_id),greatest(v.sender_user_id,v.recipient_user_id),v.id);
  ELSE
    UPDATE public.consent_grants SET status='revoked',revoked_at=clock_timestamp(),revoked_by=u,version=version+1,updated_at=clock_timestamp() WHERE id=v.grant_id;
    INSERT INTO public.consent_events(grant_id,event_type,actor_principal_id,metadata) VALUES(v.grant_id,'revoked',u,jsonb_build_object('kind','connection_invitation','reason','declined')); 
  END IF;
  UPDATE public.connection_invitations SET status=p_decision,recipient_decided_at=clock_timestamp(),version=version+1 WHERE id=p_id;
  INSERT INTO public.connection_events(invitation_id,actor_user_id,event_type,version) VALUES(p_id,u,p_decision,p_version+1);
  RETURN app.get_connection_invitation(p_id);
END $$;

CREATE FUNCTION app.revoke_connection_invitation(p_id uuid,p_withdraw boolean,p_version integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); v public.connection_invitations; g public.consent_grants;
BEGIN
  SELECT * INTO v FROM public.connection_invitations WHERE id=p_id AND sender_user_id=u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='P0002'; END IF;
  IF p_withdraw AND v.status='withdrawn' AND v.version=p_version+1 THEN RETURN app.get_connection_invitation(p_id); END IF;
  IF p_withdraw AND (v.status<>'pending' OR p_version IS NULL OR v.version<>p_version) THEN
    RAISE EXCEPTION 'withdraw conflict' USING ERRCODE='40001'; END IF;
  SELECT * INTO g FROM public.consent_grants WHERE id=v.grant_id FOR UPDATE;
  IF g.status<>'revoked' THEN
    PERFORM app.revoke_consent(v.grant_id,'Connection invitation revoked');
    INSERT INTO public.connection_events(invitation_id,actor_user_id,event_type,version) VALUES(p_id,u,CASE WHEN p_withdraw THEN 'withdrawn' ELSE 'revoked' END,v.version+1);
    UPDATE public.connection_invitations SET version=version+1,status=CASE WHEN p_withdraw OR status='pending' THEN 'withdrawn' ELSE status END WHERE id=p_id;
  END IF;
  RETURN app.get_connection_invitation(p_id);
END $$;

CREATE FUNCTION app.list_connection_invitations() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); result jsonb;
BEGIN
  SELECT jsonb_agg(app.get_connection_invitation(x.id) ORDER BY x.created_at DESC,x.id DESC) INTO result
    FROM (SELECT id,created_at FROM public.connection_invitations WHERE u IN(sender_user_id,recipient_user_id) ORDER BY created_at DESC,id DESC LIMIT 100) x;
  RETURN coalesce(result,'[]');
END $$;
CREATE FUNCTION app.list_peer_connections() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE u uuid:=app.peer_actor(); result jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('id',x.id,'userLow',x.user_low,'userHigh',x.user_high,'invitationId',x.invitation_id,'establishedAt',x.established_at) ORDER BY x.established_at DESC,x.id DESC)
  INTO result FROM (SELECT * FROM public.peer_connections WHERE u IN(user_low,user_high) ORDER BY established_at DESC,id DESC LIMIT 100) x;
  RETURN coalesce(result,'[]');
END $$;

-- Fail closed permanently when a source is deleted, expires, or sharing is tightened.
CREATE FUNCTION app.invalidate_connection_sources() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE source uuid;
BEGIN
  IF TG_TABLE_NAME='memory_items' THEN
    source:=NEW.id;
    IF NEW.status='confirmed' AND NEW.deleted_at IS NULL AND (NEW.valid_until IS NULL OR NEW.valid_until>clock_timestamp()) THEN RETURN NEW; END IF;
  ELSE
    source:=NEW.source_id;
    IF NEW.source_type<>'memory_item' OR NEW.field_key<>'content' OR 'sharing'=ANY(NEW.allowed_uses) THEN RETURN NEW; END IF;
  END IF;
  UPDATE public.consent_grant_items s SET status='stale'
    FROM public.consent_grants g WHERE s.grant_id=g.id AND g.connection_invitation_id IS NOT NULL
      AND s.source_type='memory_item' AND s.source_id=source AND s.status='active';
  RETURN NEW;
END $$;
CREATE TRIGGER trg_connection_memory_invalidation AFTER UPDATE ON public.memory_items
  FOR EACH ROW EXECUTE FUNCTION app.invalidate_connection_sources();
CREATE TRIGGER trg_connection_policy_invalidation AFTER UPDATE ON public.context_field_policies
  FOR EACH ROW EXECUTE FUNCTION app.invalidate_connection_sources();

-- All new functions have fixed search_path and no PUBLIC entry point.
DO $$
DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'peer_actor()','peer_source_manifest(uuid,uuid[])','create_connection_preview(uuid,uuid[],integer)',
    'get_connection_invitation(uuid)','send_connection_invitation(uuid,uuid)','connection_snapshot(uuid)',
    'decide_connection_invitation(uuid,text,integer)','revoke_connection_invitation(uuid,boolean,integer)',
    'list_connection_invitations()','list_peer_connections()','invalidate_connection_sources()'
  ] LOOP
    EXECUTE 'GRANT CREATE ON SCHEMA app TO aven_function_owner';
    EXECUTE 'ALTER FUNCTION app.'||signature||' OWNER TO aven_function_owner';
    EXECUTE 'REVOKE CREATE ON SCHEMA app FROM aven_function_owner';
    EXECUTE 'REVOKE ALL ON FUNCTION app.'||signature||' FROM PUBLIC';
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.create_connection_preview(uuid,uuid[],integer),app.get_connection_invitation(uuid),
  app.send_connection_invitation(uuid,uuid),app.connection_snapshot(uuid),app.decide_connection_invitation(uuid,text,integer),
  app.revoke_connection_invitation(uuid,boolean,integer),app.list_connection_invitations(),app.list_peer_connections() TO aven_app;
