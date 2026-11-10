CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO aven_app, aven_worker, aven_auth, aven_function_owner;

CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.set_updated_at() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.enforce_user_principal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.principals p WHERE p.id = NEW.id AND p.type = 'user'
  ) THEN
    RAISE EXCEPTION 'users.id must reference a user principal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.enforce_user_principal() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.enforce_organization_principal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.principals p WHERE p.id = NEW.id AND p.type = 'organization'
  ) THEN
    RAISE EXCEPTION 'organizations.id must reference an organization principal'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.enforce_organization_principal() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.current_principal_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT nullif(current_setting('app.principal_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.is_worker()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT session_user = 'aven_worker'
$$;

CREATE OR REPLACE FUNCTION app.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_role_assignments pra
    WHERE pra.user_id = app.current_user_id()
      AND pra.role = 'platform_admin'
      AND pra.status = 'active'
      AND (pra.expires_at IS NULL OR pra.expires_at > now())
  )
$$;

CREATE OR REPLACE FUNCTION app.is_org_member(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = app.current_user_id()
      AND m.status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION app.is_org_admin(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = app.current_user_id()
      AND m.status = 'active'
      AND m.role IN ('owner', 'admin')
  )
$$;

CREATE OR REPLACE FUNCTION app.can_represent(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = app.current_user_id()
      AND m.status = 'active'
      AND m.can_represent = true
  )
$$;

CREATE OR REPLACE FUNCTION app.is_verified_campus_member(p_campus_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.campus_memberships cm
    WHERE cm.campus_id = p_campus_id
      AND cm.user_id = app.current_user_id()
      AND cm.status = 'verified'
  )
$$;

-- The function owner must be able to read the membership facts used by the
-- policies, but it is not a table owner and has no BYPASSRLS.
GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.is_platform_admin() OWNER TO aven_function_owner;
ALTER FUNCTION app.is_org_member(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.is_org_admin(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.can_represent(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.is_verified_campus_member(uuid) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.current_principal_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_worker() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_platform_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_org_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_org_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.can_represent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_verified_campus_member(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.current_principal_id() TO aven_app, aven_worker, aven_auth;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO aven_app, aven_worker, aven_auth;
GRANT EXECUTE ON FUNCTION app.is_worker() TO aven_app, aven_worker;
GRANT EXECUTE ON FUNCTION app.is_platform_admin() TO aven_app, aven_worker;
GRANT EXECUTE ON FUNCTION app.is_org_member(uuid) TO aven_app, aven_worker;
GRANT EXECUTE ON FUNCTION app.is_org_admin(uuid) TO aven_app, aven_worker;
GRANT EXECUTE ON FUNCTION app.can_represent(uuid) TO aven_app, aven_worker;
GRANT EXECUTE ON FUNCTION app.is_verified_campus_member(uuid) TO aven_app, aven_worker;

CREATE TRIGGER trg_principals_updated_at
BEFORE UPDATE ON public.principals
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_user_private_updated_at
BEFORE UPDATE ON public.user_private
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_credentials_updated_at
BEFORE UPDATE ON public.credentials
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_campuses_updated_at
BEFORE UPDATE ON public.campuses
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_campus_memberships_updated_at
BEFORE UPDATE ON public.campus_memberships
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_organizations_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_organization_memberships_updated_at
BEFORE UPDATE ON public.organization_memberships
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_organization_invitations_updated_at
BEFORE UPDATE ON public.organization_invitations
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER trg_users_principal_type
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION app.enforce_user_principal();
CREATE TRIGGER trg_organizations_principal_type
BEFORE INSERT OR UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION app.enforce_organization_principal();

ALTER TABLE public.principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_role_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY principals_self_select ON public.principals
FOR SELECT TO aven_app
USING (id = app.current_principal_id());

CREATE POLICY principals_organization_select ON public.principals
FOR SELECT TO aven_app
USING (type = 'organization' AND status = 'active');

CREATE POLICY users_self_select ON public.users
FOR SELECT TO aven_app
USING (id = app.current_user_id());

CREATE POLICY user_private_self_select ON public.user_private
FOR SELECT TO aven_app
USING (user_id = app.current_user_id());

CREATE POLICY campuses_authenticated_select ON public.campuses
FOR SELECT TO aven_app
USING (app.current_user_id() IS NOT NULL);

CREATE POLICY campus_memberships_self_select ON public.campus_memberships
FOR SELECT TO aven_app
USING (user_id = app.current_user_id() OR app.is_platform_admin());

CREATE POLICY organizations_public_select ON public.organizations
FOR SELECT TO aven_app
USING (true);

CREATE POLICY organization_memberships_member_select ON public.organization_memberships
FOR SELECT TO aven_app
USING (
  user_id = app.current_user_id()
  OR app.is_org_member(organization_id)
  OR app.is_platform_admin()
);

CREATE POLICY organization_invitations_admin_select ON public.organization_invitations
FOR SELECT TO aven_app
USING (app.is_org_admin(organization_id) OR app.is_platform_admin());

CREATE POLICY sessions_self_select ON public.sessions
FOR SELECT TO aven_app
USING (user_id = app.current_user_id());

CREATE POLICY organization_memberships_function_select ON public.organization_memberships
FOR SELECT TO aven_function_owner
USING (true);

CREATE POLICY campus_memberships_function_select ON public.campus_memberships
FOR SELECT TO aven_function_owner
USING (true);

CREATE POLICY platform_role_assignments_function_select ON public.platform_role_assignments
FOR SELECT TO aven_function_owner
USING (true);

GRANT SELECT (id, type, display_name, status, version, created_at, updated_at)
ON public.principals TO aven_app;
GRANT SELECT (id, avatar_url, locale, timezone, last_seen_at, created_at, updated_at)
ON public.users TO aven_app;
GRANT SELECT (user_id, email_normalized, email_verified_at, created_at, updated_at)
ON public.user_private TO aven_app;
GRANT SELECT (id, name, slug, city, country, email_domains, status, created_at, updated_at)
ON public.campuses TO aven_app;
GRANT SELECT (id, campus_id, user_id, status, verification_method, verified_at, created_at, updated_at)
ON public.campus_memberships TO aven_app;
GRANT SELECT (
  id, slug, description, type, campus_id, website_url, logo_url,
  verification_status, verified_at, created_at, updated_at
) ON public.organizations TO aven_app;
GRANT SELECT (
  id, organization_id, user_id, role, status, can_represent,
  invited_at, joined_at, removed_at, created_at, updated_at
) ON public.organization_memberships TO aven_app;
GRANT SELECT (
  id, organization_id, email_normalized, role, status,
  expires_at, accepted_at, created_at, updated_at
) ON public.organization_invitations TO aven_app;
GRANT SELECT (
  id, user_id, client, user_agent, created_at, last_seen_at,
  expires_at, revoked_at, revoked_reason
) ON public.sessions TO aven_app;

GRANT SELECT ON public.organization_memberships TO aven_function_owner;
GRANT SELECT ON public.campus_memberships TO aven_function_owner;
GRANT SELECT ON public.platform_role_assignments TO aven_function_owner;

CREATE TABLE IF NOT EXISTS app.development_seed_runs (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON app.development_seed_runs FROM PUBLIC;
