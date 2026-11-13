CREATE TABLE public.platform_configuration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  version integer NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_configuration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_configuration_events FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_configuration_events_owner ON public.platform_configuration_events TO aven_function_owner
  USING(app.is_platform_admin()) WITH CHECK(app.is_platform_admin());
CREATE POLICY platform_configuration_events_migrator ON public.platform_configuration_events TO aven_migrator USING(true) WITH CHECK(true);
REVOKE ALL ON public.platform_configuration_events FROM PUBLIC,aven_app,aven_worker;
GRANT INSERT ON public.platform_configuration_events TO aven_function_owner;
CREATE FUNCTION app.record_platform_configuration_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  INSERT INTO public.platform_configuration_events(kind,version,actor_user_id)
    VALUES(NEW.kind,NEW.version,app.current_user_id());
  RETURN NEW;
END; $$;
GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.record_platform_configuration_event() OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;
REVOKE ALL ON FUNCTION app.record_platform_configuration_event() FROM PUBLIC;
CREATE TRIGGER platform_configuration_audit AFTER INSERT OR UPDATE ON public.platform_configurations
FOR EACH ROW EXECUTE FUNCTION app.record_platform_configuration_event();
CREATE INDEX idx_platform_configuration_events_actor ON public.platform_configuration_events(actor_user_id,occurred_at);
CREATE INDEX idx_platform_configurations_updated_by ON public.platform_configurations(updated_by);
