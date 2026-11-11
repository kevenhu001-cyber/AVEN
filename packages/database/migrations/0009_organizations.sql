CREATE OR REPLACE FUNCTION app.create_organization(
  p_name text,
  p_slug text,
  p_description text,
  p_type public.organization_type,
  p_campus_id uuid
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_org_id uuid;
  v_campus_status text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid organization name' USING ERRCODE = '22023';
  END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(p_slug) NOT BETWEEN 3 AND 60 THEN
    RAISE EXCEPTION 'invalid organization slug' USING ERRCODE = '22023';
  END IF;
  IF p_description IS NOT NULL AND length(p_description) > 2000 THEN
    RAISE EXCEPTION 'description too long' USING ERRCODE = '22023';
  END IF;
  IF p_campus_id IS NOT NULL THEN
    SELECT c.status INTO v_campus_status FROM public.campuses c WHERE c.id = p_campus_id;
    IF v_campus_status IS NULL OR v_campus_status <> 'active' THEN
      RAISE EXCEPTION 'campus not available' USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO public.principals (type, display_name)
  VALUES ('organization', trim(p_name))
  RETURNING id INTO v_org_id;
  INSERT INTO public.organizations (id, slug, description, type, campus_id)
  VALUES (v_org_id, p_slug, p_description, p_type, p_campus_id);
  INSERT INTO public.organization_memberships
    (organization_id, user_id, role, status, can_represent, joined_at)
  VALUES (v_org_id, v_user_id, 'owner', 'active', true, now());
  RETURN v_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_my_organizations()
RETURNS TABLE (
  organization_id uuid,
  name text,
  slug text,
  type public.organization_type,
  role public.organization_role,
  status public.organization_membership_status,
  can_represent boolean,
  joined_at timestamptz
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
  SELECT o.id, p.display_name, o.slug, o.type, m.role, m.status, m.can_represent, m.joined_at
  FROM public.organization_memberships m
  JOIN public.organizations o ON o.id = m.organization_id
  JOIN public.principals p ON p.id = o.id
  WHERE m.user_id = v_user_id
    AND m.status = 'active'
    AND p.status = 'active'
  ORDER BY p.display_name;
END;
$$;

CREATE OR REPLACE FUNCTION app.get_organization(p_organization_id uuid)
RETURNS TABLE (
  organization_id uuid,
  name text,
  slug text,
  description text,
  type public.organization_type,
  campus_id uuid,
  verification_status public.organization_verification_status,
  role public.organization_role,
  can_represent boolean,
  member_count integer
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
  SELECT o.id, p.display_name, o.slug, o.description, o.type, o.campus_id,
         o.verification_status, m.role, m.can_represent,
         (SELECT count(*)::integer FROM public.organization_memberships x
          WHERE x.organization_id = o.id AND x.status = 'active')
  FROM public.organizations o
  JOIN public.principals p ON p.id = o.id
  JOIN public.organization_memberships m
    ON m.organization_id = o.id AND m.user_id = v_user_id AND m.status = 'active'
  WHERE o.id = p_organization_id AND p.status = 'active'
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_organization_members(p_organization_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  role public.organization_role,
  status public.organization_membership_status,
  can_represent boolean,
  joined_at timestamptz
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
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = v_user_id
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'organization not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT m.user_id, p.display_name, m.role, m.status, m.can_represent, m.joined_at
  FROM public.organization_memberships m
  JOIN public.principals p ON p.id = m.user_id
  WHERE m.organization_id = p_organization_id AND m.status = 'active'
  ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, p.display_name;
END;
$$;

CREATE OR REPLACE FUNCTION app.create_organization_invitation(
  p_organization_id uuid,
  p_email text,
  p_role public.organization_role,
  p_token_hash text,
  p_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_actor_role public.organization_role;
  v_invitation_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  SELECT m.role INTO v_actor_role
  FROM public.organization_memberships m
  WHERE m.organization_id = p_organization_id
    AND m.user_id = v_user_id
    AND m.status = 'active';
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'organization admin required' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'invalid invitation role' USING ERRCODE = '22023';
  END IF;
  IF p_email IS NULL OR length(trim(p_email)) NOT BETWEEN 3 AND 320 THEN
    RAISE EXCEPTION 'invalid invitation email' USING ERRCODE = '22023';
  END IF;
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid invitation token' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at <= now() THEN
    RAISE EXCEPTION 'invalid invitation expiry' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.user_private up
    JOIN public.organization_memberships m ON m.user_id = up.user_id
    WHERE up.email_normalized = lower(trim(p_email))
      AND m.organization_id = p_organization_id
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'already an active member' USING ERRCODE = '23505';
  END IF;
  UPDATE public.organization_invitations
  SET token_hash = p_token_hash,
      role = p_role,
      invited_by = v_user_id,
      expires_at = p_expires_at,
      status = 'pending',
      accepted_at = null
  WHERE organization_id = p_organization_id
    AND email_normalized = lower(trim(p_email))
    AND status = 'pending'
  RETURNING id INTO v_invitation_id;
  IF v_invitation_id IS NULL THEN
    INSERT INTO public.organization_invitations
      (organization_id, email_normalized, role, token_hash, status, invited_by, expires_at)
    VALUES
      (p_organization_id, lower(trim(p_email)), p_role, p_token_hash, 'pending', v_user_id, p_expires_at)
    RETURNING id INTO v_invitation_id;
  END IF;
  RETURN v_invitation_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_organization_invitations(p_organization_id uuid)
RETURNS TABLE (
  invitation_id uuid,
  email text,
  role public.organization_role,
  status public.invitation_status,
  expires_at timestamptz,
  created_at timestamptz,
  accepted_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_actor_role public.organization_role;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  SELECT m.role INTO v_actor_role
  FROM public.organization_memberships m
  WHERE m.organization_id = p_organization_id
    AND m.user_id = v_user_id
    AND m.status = 'active';
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'organization admin required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT i.id, i.email_normalized, i.role, i.status, i.expires_at, i.created_at, i.accepted_at
  FROM public.organization_invitations i
  WHERE i.organization_id = p_organization_id
  ORDER BY i.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION app.accept_organization_invitation(p_token_hash text)
RETURNS TABLE (
  organization_id uuid,
  membership_id uuid,
  role public.organization_role
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_email text;
  v_verified_at timestamptz;
  v_invitation record;
  v_membership_id uuid;
  v_existing_role public.organization_role;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  SELECT up.email_normalized, up.email_verified_at
  INTO v_email, v_verified_at
  FROM public.user_private up
  WHERE up.user_id = v_user_id;
  IF v_email IS NULL OR v_verified_at IS NULL THEN
    RAISE EXCEPTION 'verified email required' USING ERRCODE = '42501';
  END IF;
  SELECT i.id, i.organization_id, i.email_normalized, i.role
  INTO v_invitation
  FROM public.organization_invitations i
  JOIN public.organizations o ON o.id = i.organization_id
  JOIN public.principals p ON p.id = o.id
  WHERE i.token_hash = p_token_hash
    AND i.status = 'pending'
    AND i.expires_at > now()
    AND p.status = 'active'
  LIMIT 1;
  IF v_invitation.id IS NULL OR v_invitation.email_normalized <> v_email THEN
    RAISE EXCEPTION 'invitation not available' USING ERRCODE = '22023';
  END IF;
  SELECT m.id, m.role INTO v_membership_id, v_existing_role
  FROM public.organization_memberships m
  WHERE m.organization_id = v_invitation.organization_id
    AND m.user_id = v_user_id
  LIMIT 1;
  IF v_membership_id IS NOT NULL THEN
    UPDATE public.organization_memberships m
    SET status = 'active',
        role = CASE WHEN m.role = 'owner' THEN m.role ELSE v_invitation.role END,
        can_represent = CASE WHEN m.role = 'owner' THEN m.can_represent ELSE (v_invitation.role = 'admin') END,
        joined_at = coalesce(m.joined_at, now()),
        removed_at = null
    WHERE m.id = v_membership_id;
  ELSE
    INSERT INTO public.organization_memberships
      (organization_id, user_id, role, status, can_represent, joined_at)
    VALUES
      (v_invitation.organization_id, v_user_id, v_invitation.role, 'active',
       (v_invitation.role = 'admin'), now())
    RETURNING id INTO v_membership_id;
  END IF;
  UPDATE public.organization_invitations
  SET status = 'accepted', accepted_at = now()
  WHERE id = v_invitation.id;
  RETURN QUERY
  SELECT v_invitation.organization_id, v_membership_id,
         coalesce(v_existing_role, v_invitation.role);
END;
$$;

CREATE OR REPLACE FUNCTION app.update_organization_member_role(
  p_organization_id uuid,
  p_user_id uuid,
  p_role public.organization_role
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_actor_id uuid := app.current_user_id();
  v_actor_role public.organization_role;
  v_target_role public.organization_role;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  SELECT m.role INTO v_actor_role
  FROM public.organization_memberships m
  WHERE m.organization_id = p_organization_id
    AND m.user_id = v_actor_id
    AND m.status = 'active';
  IF v_actor_role IS NULL OR v_actor_role <> 'owner' THEN
    RAISE EXCEPTION 'organization owner required' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'invalid member role' USING ERRCODE = '22023';
  END IF;
  SELECT m.role INTO v_target_role
  FROM public.organization_memberships m
  WHERE m.organization_id = p_organization_id
    AND m.user_id = p_user_id
    AND m.status = 'active';
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'member not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'owner role cannot be changed here' USING ERRCODE = '23514';
  END IF;
  UPDATE public.organization_memberships
  SET role = p_role, can_represent = (p_role = 'admin'), updated_at = now()
  WHERE organization_id = p_organization_id AND user_id = p_user_id AND status = 'active';
END;
$$;

CREATE OR REPLACE FUNCTION app.remove_organization_member(
  p_organization_id uuid,
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_actor_id uuid := app.current_user_id();
  v_actor_role public.organization_role;
  v_target_role public.organization_role;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  SELECT m.role INTO v_actor_role
  FROM public.organization_memberships m
  WHERE m.organization_id = p_organization_id
    AND m.user_id = v_actor_id
    AND m.status = 'active';
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'organization admin required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = v_actor_id THEN
    RAISE EXCEPTION 'use leave instead' USING ERRCODE = '22023';
  END IF;
  SELECT m.role INTO v_target_role
  FROM public.organization_memberships m
  WHERE m.organization_id = p_organization_id
    AND m.user_id = p_user_id
    AND m.status = 'active';
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'member not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'owner cannot be removed' USING ERRCODE = '23514';
  END IF;
  IF v_actor_role = 'admin' AND v_target_role = 'admin' THEN
    RAISE EXCEPTION 'admin cannot remove admin' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organization_memberships
  SET status = 'removed', removed_at = now(), updated_at = now()
  WHERE organization_id = p_organization_id AND user_id = p_user_id AND status = 'active';
END;
$$;

CREATE OR REPLACE FUNCTION app.leave_organization(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_role public.organization_role;
  v_owner_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  SELECT m.role INTO v_role
  FROM public.organization_memberships m
  WHERE m.organization_id = p_organization_id
    AND m.user_id = v_user_id
    AND m.status = 'active';
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'member not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_role = 'owner' THEN
    SELECT count(*) INTO v_owner_count
    FROM public.organization_memberships m
    WHERE m.organization_id = p_organization_id
      AND m.role = 'owner'
      AND m.status = 'active';
    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'last owner cannot leave' USING ERRCODE = '23514';
    END IF;
  END IF;
  UPDATE public.organization_memberships
  SET status = 'left', removed_at = now(), updated_at = now()
  WHERE organization_id = p_organization_id AND user_id = v_user_id AND status = 'active';
END;
$$;

GRANT SELECT, INSERT, UPDATE ON public.organizations TO aven_function_owner;
GRANT SELECT, INSERT, UPDATE ON public.organization_memberships TO aven_function_owner;
GRANT SELECT, INSERT, UPDATE ON public.organization_invitations TO aven_function_owner;

CREATE POLICY organizations_function_all ON public.organizations
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY organization_memberships_function_all ON public.organization_memberships
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY organization_invitations_function_all ON public.organization_invitations
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.create_organization(text, text, text, public.organization_type, uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_my_organizations() OWNER TO aven_function_owner;
ALTER FUNCTION app.get_organization(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_organization_members(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.create_organization_invitation(uuid, text, public.organization_role, text, timestamptz) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_organization_invitations(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.accept_organization_invitation(text) OWNER TO aven_function_owner;
ALTER FUNCTION app.update_organization_member_role(uuid, uuid, public.organization_role) OWNER TO aven_function_owner;
ALTER FUNCTION app.remove_organization_member(uuid, uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.leave_organization(uuid) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.create_organization(text, text, text, public.organization_type, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_my_organizations() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_organization(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_organization_members(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_organization_invitation(uuid, text, public.organization_role, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_organization_invitations(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.accept_organization_invitation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.update_organization_member_role(uuid, uuid, public.organization_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.remove_organization_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.leave_organization(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.create_organization(text, text, text, public.organization_type, uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_my_organizations() TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_organization(uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_organization_members(uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.create_organization_invitation(uuid, text, public.organization_role, text, timestamptz) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_organization_invitations(uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.accept_organization_invitation(text) TO aven_app;
GRANT EXECUTE ON FUNCTION app.update_organization_member_role(uuid, uuid, public.organization_role) TO aven_app;
GRANT EXECUTE ON FUNCTION app.remove_organization_member(uuid, uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.leave_organization(uuid) TO aven_app;
