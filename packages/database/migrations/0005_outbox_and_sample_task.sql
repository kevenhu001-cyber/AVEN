CREATE TYPE public.outbox_status AS ENUM ('pending', 'processing', 'processed', 'failed', 'dead');

CREATE TABLE public.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status public.outbox_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT chk_outbox_processing_lease
    CHECK (status <> 'processing' OR lease_expires_at IS NOT NULL)
);
CREATE INDEX idx_outbox_pending ON public.outbox_events (available_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX idx_outbox_lease ON public.outbox_events (lease_expires_at)
  WHERE status = 'processing';
CREATE INDEX idx_outbox_aggregate ON public.outbox_events (aggregate_type, aggregate_id);

CREATE TABLE public.job_receipts (
  event_id uuid NOT NULL REFERENCES public.outbox_events (id) ON DELETE CASCADE,
  consumer text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  lease_token text,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  result_resource_id uuid,
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, consumer),
  CONSTRAINT chk_job_receipts_status
    CHECK (status IN ('running', 'succeeded', 'failed', 'unknown', 'dead'))
);
CREATE INDEX idx_job_receipts_lease ON public.job_receipts (status, lease_expires_at);

CREATE TABLE app.sample_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.sample_task_results (
  event_id uuid NOT NULL REFERENCES public.outbox_events (id) ON DELETE CASCADE,
  consumer text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, consumer)
);

CREATE TABLE app.sample_external_effects (
  idempotency_key text PRIMARY KEY,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_job_receipts_updated_at
BEFORE UPDATE ON public.job_receipts
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sample_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sample_task_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sample_external_effects ENABLE ROW LEVEL SECURITY;

CREATE POLICY outbox_events_app_insert ON public.outbox_events
FOR INSERT TO aven_app
WITH CHECK (true);

CREATE POLICY outbox_events_app_id_select ON public.outbox_events
FOR SELECT TO aven_app
USING (true);

CREATE POLICY outbox_events_worker_select ON public.outbox_events
FOR SELECT TO aven_worker
USING (app.is_worker());

CREATE POLICY outbox_events_worker_update ON public.outbox_events
FOR UPDATE TO aven_worker
USING (app.is_worker())
WITH CHECK (app.is_worker());

CREATE POLICY job_receipts_worker_all ON public.job_receipts
FOR ALL TO aven_worker
USING (app.is_worker())
WITH CHECK (app.is_worker());

CREATE POLICY sample_tasks_app_select ON app.sample_tasks
FOR SELECT TO aven_app
USING (true);

CREATE POLICY sample_tasks_app_insert ON app.sample_tasks
FOR INSERT TO aven_app
WITH CHECK (true);

CREATE POLICY sample_tasks_worker_select ON app.sample_tasks
FOR SELECT TO aven_worker
USING (app.is_worker());

CREATE POLICY sample_task_results_app_select ON app.sample_task_results
FOR SELECT TO aven_app
USING (true);

CREATE POLICY sample_task_results_worker_all ON app.sample_task_results
FOR ALL TO aven_worker
USING (app.is_worker())
WITH CHECK (app.is_worker());

CREATE POLICY sample_external_effects_worker_all ON app.sample_external_effects
FOR ALL TO aven_worker
USING (app.is_worker())
WITH CHECK (app.is_worker());

GRANT SELECT (id) ON public.outbox_events TO aven_app;
GRANT INSERT (aggregate_type, aggregate_id, event_type, payload)
ON public.outbox_events TO aven_app;

GRANT SELECT ON public.outbox_events TO aven_worker;
GRANT UPDATE (status, attempts, locked_at, locked_by, lease_expires_at, last_error, processed_at)
ON public.outbox_events TO aven_worker;

GRANT SELECT, INSERT, UPDATE ON public.job_receipts TO aven_worker;

GRANT SELECT (id, title, created_at) ON app.sample_tasks TO aven_app;
GRANT INSERT (title) ON app.sample_tasks TO aven_app;
GRANT SELECT ON app.sample_tasks TO aven_worker;

GRANT SELECT ON app.sample_task_results TO aven_app;
GRANT SELECT, INSERT ON app.sample_task_results TO aven_worker;
GRANT SELECT, INSERT ON app.sample_external_effects TO aven_worker;
