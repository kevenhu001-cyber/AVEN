-- Migration: 0026_events_and_coordination
-- M6: Events, Proposals, Participants, and Multi-party Confirmation

CREATE TYPE public.event_status AS ENUM (
  'draft',
  'proposed',
  'pending_confirmation',
  'confirmed',
  'cancelled',
  'ended'
);

CREATE TYPE public.event_proposal_status AS ENUM (
  'proposed',
  'accepted',
  'superseded',
  'rejected'
);

CREATE TYPE public.event_participant_response AS ENUM (
  'pending',
  'accepted',
  'declined',
  'tentative'
);

-- Events
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_principal_id uuid NOT NULL REFERENCES public.principals (id),
  relationship_id uuid REFERENCES public.relationships (id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.principals (id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  location text,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Shanghai',
  status public.event_status NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_event_time CHECK (end_at > start_at)
);

CREATE INDEX idx_events_organizer_status ON public.events (organizer_principal_id, status);
CREATE INDEX idx_events_relationship ON public.events (relationship_id);
CREATE INDEX idx_events_organization ON public.events (organization_id);
CREATE INDEX idx_events_time_window ON public.events (start_at, end_at);

-- Event Proposals
CREATE TABLE public.event_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Shanghai',
  status public.event_proposal_status NOT NULL DEFAULT 'proposed',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_event_proposal_ver UNIQUE (event_id, version),
  CONSTRAINT chk_proposal_time CHECK (end_at > start_at)
);

CREATE INDEX idx_event_proposals_event_ver ON public.event_proposals (event_id, version);

-- Event Participants
CREATE TABLE public.event_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES public.principals (id),
  role text NOT NULL DEFAULT 'attendee',
  response public.event_participant_response NOT NULL DEFAULT 'pending',
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_event_participant UNIQUE (event_id, principal_id)
);

CREATE INDEX idx_event_participants_principal ON public.event_participants (principal_id, response);

-- Authorization Helper (Security Definer to eliminate RLS recursion)
CREATE OR REPLACE FUNCTION app.can_view_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = p_event_id
      AND (
        e.organizer_principal_id = app.current_principal_id()
        OR EXISTS (
          SELECT 1 FROM public.event_participants ep
          WHERE ep.event_id = e.id AND ep.principal_id = app.current_principal_id()
        )
        OR (e.relationship_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.relationship_members rm
          WHERE rm.relationship_id = e.relationship_id AND rm.principal_id = app.current_principal_id()
        ))
        OR (e.organization_id IS NOT NULL AND app.is_org_member(e.organization_id))
      )
  );
$$;

-- RLS Configuration
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_function_all ON public.events
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY events_migrator_all ON public.events
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
CREATE POLICY events_participant_select ON public.events
  FOR SELECT TO aven_app
  USING (app.can_view_event(id));
ALTER TABLE public.events FORCE ROW LEVEL SECURITY;

ALTER TABLE public.event_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_proposals_function_all ON public.event_proposals
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY event_proposals_migrator_all ON public.event_proposals
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
CREATE POLICY event_proposals_participant_select ON public.event_proposals
  FOR SELECT TO aven_app
  USING (app.can_view_event(event_id));
ALTER TABLE public.event_proposals FORCE ROW LEVEL SECURITY;

ALTER TABLE public.event_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_participants_function_all ON public.event_participants
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY event_participants_migrator_all ON public.event_participants
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
CREATE POLICY event_participants_select ON public.event_participants
  FOR SELECT TO aven_app
  USING (
    principal_id = app.current_principal_id()
    OR app.can_view_event(event_id)
  );
ALTER TABLE public.event_participants FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.events TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO aven_function_owner;

GRANT SELECT ON public.event_proposals TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_proposals TO aven_function_owner;

GRANT SELECT ON public.event_participants TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_participants TO aven_function_owner;

-- Stored Functions

CREATE OR REPLACE FUNCTION app.create_event_draft(
  p_title text,
  p_description text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_start_at timestamptz DEFAULT NULL,
  p_end_at timestamptz DEFAULT NULL,
  p_timezone text DEFAULT 'Asia/Shanghai',
  p_relationship_id uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL,
  p_attendee_principal_ids uuid[] DEFAULT ARRAY[]::uuid[]
) RETURNS TABLE (
  id uuid,
  organizer_principal_id uuid,
  relationship_id uuid,
  organization_id uuid,
  title text,
  description text,
  location text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  status public.event_status,
  version integer,
  created_at timestamptz,
  updated_at timestamptz
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
  v_start timestamptz := coalesce(p_start_at, v_now + interval '1 day');
  v_end timestamptz := coalesce(p_end_at, v_start + interval '1 hour');
  v_event_id uuid;
  v_attendee_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  IF v_end <= v_start THEN
    RAISE EXCEPTION 'end_at must be strictly after start_at' USING ERRCODE = '22023';
  END IF;

  -- If relationship_id provided, verify caller is relationship participant
  IF p_relationship_id IS NOT NULL THEN
    PERFORM 1 FROM public.relationship_members
    WHERE relationship_members.relationship_id = p_relationship_id
      AND relationship_members.principal_id = v_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not participant of specified relationship' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Insert Event in draft status
  INSERT INTO public.events (
    organizer_principal_id,
    relationship_id,
    organization_id,
    title,
    description,
    location,
    start_at,
    end_at,
    timezone,
    status,
    version,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    p_relationship_id,
    p_organization_id,
    p_title,
    p_description,
    p_location,
    v_start,
    v_end,
    coalesce(p_timezone, 'Asia/Shanghai'),
    'draft',
    1,
    v_now,
    v_now
  )
  RETURNING events.id INTO v_event_id;

  -- Add organizer as accepted participant
  INSERT INTO public.event_participants (
    event_id,
    principal_id,
    role,
    response,
    responded_at,
    created_at,
    updated_at
  ) VALUES (
    v_event_id,
    v_user_id,
    'organizer',
    'accepted',
    v_now,
    v_now,
    v_now
  );

  -- Add attendees
  IF p_attendee_principal_ids IS NOT NULL THEN
    FOREACH v_attendee_id IN ARRAY p_attendee_principal_ids
    LOOP
      IF v_attendee_id <> v_user_id THEN
        INSERT INTO public.event_participants (
          event_id,
          principal_id,
          role,
          response,
          created_at,
          updated_at
        ) VALUES (
          v_event_id,
          v_attendee_id,
          'attendee',
          'pending',
          v_now,
          v_now
        )
        ON CONFLICT (event_id, principal_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.organizer_principal_id,
    e.relationship_id,
    e.organization_id,
    e.title,
    e.description,
    e.location,
    e.start_at,
    e.end_at,
    e.timezone,
    e.status,
    e.version,
    e.created_at,
    e.updated_at
  FROM public.events e
  WHERE e.id = v_event_id;
END;
$$;

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

  -- Only organizer or participant can propose time
  PERFORM 1 FROM public.event_participants
  WHERE event_participants.event_id = p_event_id
    AND event_participants.principal_id = v_user_id;

  IF NOT FOUND AND v_event.organizer_principal_id <> v_user_id THEN
    RAISE EXCEPTION 'access denied to propose time for event' USING ERRCODE = '42501';
  END IF;

  v_next_version := v_event.version + 1;

  -- Mark prior proposals superseded
  UPDATE public.event_proposals
  SET status = 'superseded'
  WHERE event_proposals.event_id = p_event_id
    AND event_proposals.status = 'proposed';

  -- Create new proposal entry
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

  -- Update event times, version, and status
  UPDATE public.events
  SET
    start_at = p_start_at,
    end_at = p_end_at,
    timezone = coalesce(p_timezone, events.timezone),
    status = 'pending_confirmation',
    version = v_next_version,
    updated_at = v_now
  WHERE events.id = p_event_id;

  -- Invalidate prior confirmations: Proposer is accepted, all others reset to pending
  UPDATE public.event_participants
  SET
    response = CASE WHEN principal_id = v_user_id THEN 'accepted'::public.event_participant_response ELSE 'pending'::public.event_participant_response END,
    responded_at = CASE WHEN principal_id = v_user_id THEN v_now ELSE NULL END,
    updated_at = v_now
  WHERE event_participants.event_id = p_event_id;

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
  v_declined_count integer;
  v_all_accepted boolean := false;
  v_new_status public.event_status;
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

  -- Update participant response
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

  -- Check if all participants accepted
  SELECT count(*) INTO v_pending_count
  FROM public.event_participants
  WHERE event_participants.event_id = p_event_id
    AND event_participants.response <> 'accepted';

  v_all_accepted := (v_pending_count = 0);
  v_new_status := v_event.status;

  IF v_all_accepted THEN
    v_new_status := 'confirmed';
    UPDATE public.events
    SET
      status = 'confirmed',
      version = version + 1,
      updated_at = v_now
    WHERE events.id = p_event_id;

    UPDATE public.event_proposals
    SET status = 'accepted'
    WHERE event_proposals.event_id = p_event_id
      AND event_proposals.version = v_event.version;
  END IF;

  RETURN QUERY
  SELECT
    v_event.id,
    v_new_status,
    v_event.version,
    p_response,
    v_all_accepted;
END;
$$;

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

  UPDATE public.events
  SET
    status = 'cancelled',
    version = version + 1,
    updated_at = v_now
  WHERE events.id = p_event_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION app.get_event(
  p_event_id uuid
) RETURNS TABLE (
  id uuid,
  organizer_principal_id uuid,
  organizer_name text,
  relationship_id uuid,
  organization_id uuid,
  title text,
  description text,
  location text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  status public.event_status,
  version integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.organizer_principal_id,
    p.display_name AS organizer_name,
    e.relationship_id,
    e.organization_id,
    e.title,
    e.description,
    e.location,
    e.start_at,
    e.end_at,
    e.timezone,
    e.status,
    e.version,
    e.created_at,
    e.updated_at
  FROM public.events e
  JOIN public.principals p ON p.id = e.organizer_principal_id
  WHERE e.id = p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_my_events(
  p_status public.event_status DEFAULT NULL
) RETURNS TABLE (
  id uuid,
  organizer_principal_id uuid,
  organizer_name text,
  relationship_id uuid,
  organization_id uuid,
  title text,
  location text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  status public.event_status,
  my_response public.event_participant_response,
  version integer,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.organizer_principal_id,
    org_p.display_name AS organizer_name,
    e.relationship_id,
    e.organization_id,
    e.title,
    e.location,
    e.start_at,
    e.end_at,
    e.timezone,
    e.status,
    ep.response AS my_response,
    e.version,
    e.created_at
  FROM public.events e
  JOIN public.principals org_p ON org_p.id = e.organizer_principal_id
  JOIN public.event_participants ep ON ep.event_id = e.id AND ep.principal_id = v_user_id
  WHERE (p_status IS NULL OR e.status = p_status)
  ORDER BY e.start_at ASC;
END;
$$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.can_view_event(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.create_event_draft(text, text, text, timestamptz, timestamptz, text, uuid, uuid, uuid[]) OWNER TO aven_function_owner;
ALTER FUNCTION app.propose_event_time(uuid, timestamptz, timestamptz, text, integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.respond_event_participant(uuid, public.event_participant_response, integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.cancel_event(uuid, text) OWNER TO aven_function_owner;
ALTER FUNCTION app.get_event(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_my_events(public.event_status) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.can_view_event FROM public;
REVOKE ALL ON FUNCTION app.create_event_draft FROM public;
REVOKE ALL ON FUNCTION app.propose_event_time FROM public;
REVOKE ALL ON FUNCTION app.respond_event_participant FROM public;
REVOKE ALL ON FUNCTION app.cancel_event FROM public;
REVOKE ALL ON FUNCTION app.get_event FROM public;
REVOKE ALL ON FUNCTION app.list_my_events FROM public;

GRANT EXECUTE ON FUNCTION app.can_view_event TO aven_app, aven_worker;
GRANT EXECUTE ON FUNCTION app.create_event_draft TO aven_app;
GRANT EXECUTE ON FUNCTION app.propose_event_time TO aven_app;
GRANT EXECUTE ON FUNCTION app.respond_event_participant TO aven_app;
GRANT EXECUTE ON FUNCTION app.cancel_event TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_event TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_my_events TO aven_app;
