CREATE TABLE public.open_connector_connections (
  user_id uuid NOT NULL REFERENCES public.users(id),
  service text NOT NULL CHECK (service IN ('gmail','googledrive','github','googlecalendar','outlook')),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 256),
  status text NOT NULL CHECK (status IN ('pending','connected','failed','expired','cancelled')),
  connected_account_id text,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,service)
);
ALTER TABLE public.open_connector_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_connector_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY open_connector_owner ON public.open_connector_connections TO aven_app
  USING(user_id=app.current_user_id()) WITH CHECK(user_id=app.current_user_id());
CREATE POLICY open_connector_migrator ON public.open_connector_connections TO aven_migrator USING(true) WITH CHECK(true);
REVOKE ALL ON public.open_connector_connections FROM PUBLIC,aven_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.open_connector_connections TO aven_app;
