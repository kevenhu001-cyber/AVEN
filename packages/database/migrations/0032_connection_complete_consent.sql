-- Require every originally selected item at acceptance; partial stale snapshots cannot confirm an older preview.
CREATE OR REPLACE FUNCTION app.decide_connection_invitation(p_id uuid,p_decision text,p_version integer) RETURNS jsonb
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
  IF g.status<>'active' OR g.expires_at<=clock_timestamp() OR jsonb_array_length(app.connection_snapshot(v.id))=0
    OR jsonb_array_length(app.connection_snapshot(v.id))<>(SELECT count(*) FROM public.consent_grant_items WHERE grant_id=v.grant_id) THEN
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

