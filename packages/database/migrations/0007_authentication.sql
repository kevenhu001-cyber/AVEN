ALTER TABLE public.sessions ADD COLUMN csrf_token_hash text;
ALTER TABLE public.sessions
  ADD CONSTRAINT chk_sessions_csrf_hash
  CHECK (csrf_token_hash IS NULL OR length(csrf_token_hash) = 64);
CREATE INDEX idx_sessions_user_created ON public.sessions (user_id, created_at DESC);

ALTER TABLE public.user_private
  ADD CONSTRAINT chk_user_private_email_normalized
  CHECK (
    email_normalized = lower(trim(email_normalized))
    AND length(email_normalized) BETWEEN 3 AND 320
  );

CREATE OR REPLACE FUNCTION app.register_user(
  p_email text,
  p_password_hash text,
  p_display_name text,
  p_verification_hash text,
  p_verification_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) < 3 OR length(trim(p_email)) > 320 THEN
    RAISE EXCEPTION 'invalid email' USING ERRCODE = '22023';
  END IF;
  IF p_password_hash IS NULL OR length(p_password_hash) < 20 THEN
    RAISE EXCEPTION 'invalid password hash' USING ERRCODE = '22023';
  END IF;
  IF p_verification_expires_at <= now() THEN
    RAISE EXCEPTION 'invalid verification expiry' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.principals (type, display_name)
  VALUES ('user', p_display_name)
  RETURNING id INTO v_user_id;
  INSERT INTO public.users (id) VALUES (v_user_id);
  INSERT INTO public.user_private (user_id, email_normalized)
  VALUES (v_user_id, lower(trim(p_email)));
  INSERT INTO public.credentials (user_id, password_hash, password_updated_at)
  VALUES (v_user_id, p_password_hash, now());
  INSERT INTO public.email_verification_tokens (user_id, token_hash, expires_at)
  VALUES (v_user_id, p_verification_hash, p_verification_expires_at);
  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.auth_lookup(p_email text)
RETURNS TABLE (
  user_id uuid,
  password_hash text,
  principal_status public.principal_status,
  email_verified_at timestamptz,
  display_name text,
  locale text,
  timezone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT u.id, c.password_hash, p.status, up.email_verified_at, p.display_name, u.locale, u.timezone
  FROM public.user_private up
  JOIN public.users u ON u.id = up.user_id
  JOIN public.principals p ON p.id = u.id
  JOIN public.credentials c ON c.user_id = u.id AND c.type = 'password'
  WHERE up.email_normalized = lower(trim(p_email))
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.password_lookup(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT password_hash
  FROM public.credentials
  WHERE user_id = p_user_id AND type = 'password'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.create_session(
  p_user_id uuid,
  p_token_hash text,
  p_csrf_hash text,
  p_client public.session_client,
  p_user_agent text,
  p_ip_hash text,
  p_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_session_id uuid;
BEGIN
  IF p_expires_at <= now() THEN
    RAISE EXCEPTION 'invalid session expiry' USING ERRCODE = '22023';
  END IF;
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid token hash' USING ERRCODE = '22023';
  END IF;
  IF p_csrf_hash IS NOT NULL AND length(p_csrf_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid csrf hash' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.sessions
    (user_id, token_hash, csrf_token_hash, client, user_agent, ip_hash, expires_at)
  VALUES
    (p_user_id, p_token_hash, p_csrf_hash, p_client, left(p_user_agent, 512), p_ip_hash, p_expires_at)
  RETURNING id INTO v_session_id;
  RETURN v_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.session_lookup(p_token_hash text)
RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  principal_id uuid,
  client public.session_client,
  csrf_token_hash text,
  created_at timestamptz,
  last_seen_at timestamptz,
  expires_at timestamptz,
  user_agent text,
  principal_status public.principal_status,
  email_verified_at timestamptz,
  display_name text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  UPDATE public.sessions s
  SET last_seen_at = now()
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND s.last_seen_at < now() - interval '5 minutes';
  RETURN QUERY
  SELECT s.id, s.user_id, u.id, s.client, s.csrf_token_hash, s.created_at,
         s.last_seen_at, s.expires_at, s.user_agent, p.status,
         up.email_verified_at, p.display_name
  FROM public.sessions s
  JOIN public.users u ON u.id = s.user_id
  JOIN public.principals p ON p.id = u.id
  JOIN public.user_private up ON up.user_id = u.id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND p.status = 'active'
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_sessions(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  client public.session_client,
  user_agent text,
  created_at timestamptz,
  last_seen_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT s.id, s.client, s.user_agent, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at
  FROM public.sessions s
  WHERE s.user_id = p_user_id
  ORDER BY s.created_at DESC
  LIMIT 50
$$;

CREATE OR REPLACE FUNCTION app.revoke_session(
  p_session_id uuid,
  p_user_id uuid,
  p_reason text
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.sessions
  SET revoked_at = now(), revoked_reason = left(p_reason, 200)
  WHERE id = p_session_id AND user_id = p_user_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION app.revoke_all_sessions(
  p_user_id uuid,
  p_reason text
) RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.sessions
  SET revoked_at = now(), revoked_reason = left(p_reason, 200)
  WHERE user_id = p_user_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION app.verify_email(p_token_hash text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  UPDATE public.email_verification_tokens
  SET consumed_at = now()
  WHERE token_hash = p_token_hash AND consumed_at IS NULL AND expires_at > now()
  RETURNING user_id INTO v_user_id;
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE public.user_private
  SET email_verified_at = now()
  WHERE user_id = v_user_id;
  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.create_email_verification_token(
  p_user_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  UPDATE public.email_verification_tokens
  SET consumed_at = now()
  WHERE user_id = p_user_id AND consumed_at IS NULL;
  INSERT INTO public.email_verification_tokens (user_id, token_hash, expires_at)
  VALUES (p_user_id, p_token_hash, p_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION app.create_password_reset_token(
  p_email text,
  p_token_hash text,
  p_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT up.user_id INTO v_user_id
  FROM public.user_private up
  WHERE up.email_normalized = lower(trim(p_email))
  LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE public.password_reset_tokens
  SET consumed_at = now()
  WHERE user_id = v_user_id AND consumed_at IS NULL;
  INSERT INTO public.password_reset_tokens (user_id, token_hash, expires_at)
  VALUES (v_user_id, p_token_hash, p_expires_at);
  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.reset_password(
  p_token_hash text,
  p_new_password_hash text
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  UPDATE public.password_reset_tokens
  SET consumed_at = now()
  WHERE token_hash = p_token_hash AND consumed_at IS NULL AND expires_at > now()
  RETURNING user_id INTO v_user_id;
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE public.credentials
  SET password_hash = p_new_password_hash,
      password_updated_at = now(),
      failed_attempts = 0,
      locked_until = null
  WHERE user_id = v_user_id AND type = 'password';
  UPDATE public.sessions
  SET revoked_at = now(), revoked_reason = 'password_reset'
  WHERE user_id = v_user_id AND revoked_at IS NULL;
  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.update_password(
  p_user_id uuid,
  p_new_password_hash text
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  UPDATE public.credentials
  SET password_hash = p_new_password_hash,
      password_updated_at = now(),
      failed_attempts = 0,
      locked_until = null
  WHERE user_id = p_user_id AND type = 'password';
  UPDATE public.sessions
  SET revoked_at = now(), revoked_reason = 'password_change'
  WHERE user_id = p_user_id AND revoked_at IS NULL;
END;
$$;

GRANT SELECT, INSERT, UPDATE ON public.principals TO aven_function_owner;
GRANT SELECT, INSERT, UPDATE ON public.users TO aven_function_owner;
GRANT SELECT, INSERT, UPDATE ON public.user_private TO aven_function_owner;
GRANT SELECT, INSERT, UPDATE ON public.credentials TO aven_function_owner;
GRANT SELECT, INSERT, UPDATE ON public.sessions TO aven_function_owner;
GRANT SELECT, INSERT, UPDATE ON public.email_verification_tokens TO aven_function_owner;
GRANT SELECT, INSERT, UPDATE ON public.password_reset_tokens TO aven_function_owner;

CREATE POLICY principals_function_all ON public.principals
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY users_function_all ON public.users
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY user_private_function_all ON public.user_private
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY credentials_function_all ON public.credentials
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY sessions_function_all ON public.sessions
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY email_verification_tokens_function_all ON public.email_verification_tokens
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY password_reset_tokens_function_all ON public.password_reset_tokens
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.register_user(text, text, text, text, timestamptz) OWNER TO aven_function_owner;
ALTER FUNCTION app.auth_lookup(text) OWNER TO aven_function_owner;
ALTER FUNCTION app.password_lookup(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.create_session(uuid, text, text, public.session_client, text, text, timestamptz) OWNER TO aven_function_owner;
ALTER FUNCTION app.session_lookup(text) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_sessions(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.revoke_session(uuid, uuid, text) OWNER TO aven_function_owner;
ALTER FUNCTION app.revoke_all_sessions(uuid, text) OWNER TO aven_function_owner;
ALTER FUNCTION app.verify_email(text) OWNER TO aven_function_owner;
ALTER FUNCTION app.create_email_verification_token(uuid, text, timestamptz) OWNER TO aven_function_owner;
ALTER FUNCTION app.create_password_reset_token(text, text, timestamptz) OWNER TO aven_function_owner;
ALTER FUNCTION app.reset_password(text, text) OWNER TO aven_function_owner;
ALTER FUNCTION app.update_password(uuid, text) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.register_user(text, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.password_lookup(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_session(uuid, text, text, public.session_client, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.session_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_sessions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.revoke_session(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.revoke_all_sessions(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.verify_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_email_verification_token(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_password_reset_token(text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.reset_password(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.update_password(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.register_user(text, text, text, text, timestamptz) TO aven_auth;
GRANT EXECUTE ON FUNCTION app.auth_lookup(text) TO aven_auth;
GRANT EXECUTE ON FUNCTION app.password_lookup(uuid) TO aven_auth;
GRANT EXECUTE ON FUNCTION app.create_session(uuid, text, text, public.session_client, text, text, timestamptz) TO aven_auth;
GRANT EXECUTE ON FUNCTION app.verify_email(text) TO aven_auth;
GRANT EXECUTE ON FUNCTION app.create_email_verification_token(uuid, text, timestamptz) TO aven_auth;
GRANT EXECUTE ON FUNCTION app.create_password_reset_token(text, text, timestamptz) TO aven_auth;
GRANT EXECUTE ON FUNCTION app.reset_password(text, text) TO aven_auth;
GRANT EXECUTE ON FUNCTION app.update_password(uuid, text) TO aven_auth;
GRANT EXECUTE ON FUNCTION app.revoke_all_sessions(uuid, text) TO aven_auth;

GRANT EXECUTE ON FUNCTION app.session_lookup(text) TO aven_app, aven_worker;
GRANT EXECUTE ON FUNCTION app.list_sessions(uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.revoke_session(uuid, uuid, text) TO aven_app;
GRANT EXECUTE ON FUNCTION app.revoke_all_sessions(uuid, text) TO aven_app;
