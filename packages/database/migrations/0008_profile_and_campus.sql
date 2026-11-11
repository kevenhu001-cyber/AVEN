CREATE OR REPLACE FUNCTION app.update_my_profile(
  p_display_name text,
  p_locale text,
  p_timezone text
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF p_display_name IS NULL AND p_locale IS NULL AND p_timezone IS NULL THEN
    RAISE EXCEPTION 'no profile fields' USING ERRCODE = '22023';
  END IF;
  IF p_display_name IS NOT NULL AND length(trim(p_display_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid display name' USING ERRCODE = '22023';
  END IF;
  IF p_locale IS NOT NULL AND (length(p_locale) < 2 OR length(p_locale) > 35) THEN
    RAISE EXCEPTION 'invalid locale' USING ERRCODE = '22023';
  END IF;
  IF p_timezone IS NOT NULL AND (length(p_timezone) < 1 OR length(p_timezone) > 64) THEN
    RAISE EXCEPTION 'invalid timezone' USING ERRCODE = '22023';
  END IF;
  UPDATE public.principals
  SET display_name = coalesce(trim(p_display_name), display_name),
      version = version + 1
  WHERE id = v_user_id;
  UPDATE public.users
  SET locale = coalesce(p_locale, locale),
      timezone = coalesce(p_timezone, timezone)
  WHERE id = v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_active_campuses()
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  city text,
  country text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT c.id, c.name, c.slug, c.city, c.country
  FROM public.campuses c
  WHERE c.status = 'active'
  ORDER BY c.name
$$;

CREATE OR REPLACE FUNCTION app.list_my_campus_memberships()
RETURNS TABLE (
  membership_id uuid,
  campus_uuid uuid,
  campus_name text,
  status public.campus_membership_status,
  verification_method public.campus_verification_method,
  verified_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY
  SELECT cm.id, cm.campus_id, c.name, cm.status, cm.verification_method,
         cm.verified_at, cm.created_at
  FROM public.campus_memberships cm
  JOIN public.campuses c ON c.id = cm.campus_id
  WHERE cm.user_id = v_user_id
  ORDER BY cm.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION app.request_campus_membership(p_campus_id uuid)
RETURNS TABLE (
  membership_id uuid,
  campus_uuid uuid,
  campus_name text,
  status public.campus_membership_status,
  verification_method public.campus_verification_method,
  verified_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_campus_status text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  SELECT c.status INTO v_campus_status FROM public.campuses c WHERE c.id = p_campus_id;
  IF v_campus_status IS NULL OR v_campus_status <> 'active' THEN
    RAISE EXCEPTION 'campus not available' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.campus_memberships (campus_id, user_id, status)
  VALUES (p_campus_id, v_user_id, 'pending')
  ON CONFLICT (campus_id, user_id) DO NOTHING;
  RETURN QUERY
  SELECT cm.id, cm.campus_id, c.name, cm.status, cm.verification_method,
         cm.verified_at, cm.created_at
  FROM public.campus_memberships cm
  JOIN public.campuses c ON c.id = cm.campus_id
  WHERE cm.campus_id = p_campus_id AND cm.user_id = v_user_id
  LIMIT 1;
END;
$$;

GRANT SELECT ON public.campuses TO aven_function_owner;
GRANT INSERT ON public.campus_memberships TO aven_function_owner;

CREATE POLICY campuses_function_select ON public.campuses
FOR SELECT TO aven_function_owner USING (true);
CREATE POLICY campus_memberships_function_insert ON public.campus_memberships
FOR INSERT TO aven_function_owner WITH CHECK (true);

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.update_my_profile(text, text, text) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_active_campuses() OWNER TO aven_function_owner;
ALTER FUNCTION app.list_my_campus_memberships() OWNER TO aven_function_owner;
ALTER FUNCTION app.request_campus_membership(uuid) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.update_my_profile(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_active_campuses() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_my_campus_memberships() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.request_campus_membership(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.update_my_profile(text, text, text) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_active_campuses() TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_my_campus_memberships() TO aven_app;
GRANT EXECUTE ON FUNCTION app.request_campus_membership(uuid) TO aven_app;
