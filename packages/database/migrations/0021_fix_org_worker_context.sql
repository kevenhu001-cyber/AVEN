-- Migration 0021: Fix Organization Worker Context Function

CREATE OR REPLACE FUNCTION app.get_organization_for_worker(p_organization_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  website_url text,
  logo_url text,
  campus_name text,
  member_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id,
         p.display_name AS name,
         o.description,
         o.website_url,
         o.logo_url,
         c.name AS campus_name,
         (SELECT count(*)::integer FROM public.organization_memberships m
          WHERE m.organization_id = o.id AND m.status = 'active') AS member_count
  FROM public.organizations o
  JOIN public.principals p ON p.id = o.id
  LEFT JOIN public.campuses c ON c.id = o.campus_id
  WHERE o.id = p_organization_id;
END;
$$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.get_organization_for_worker(uuid) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.get_organization_for_worker(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_organization_for_worker(uuid) TO aven_worker;
