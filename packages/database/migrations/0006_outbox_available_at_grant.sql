-- The dispatcher returns failed enqueue attempts to the pending queue by
-- moving available_at forward. aven_worker already has the other claim/confirm
-- columns; this grant closes the missing column-level privilege.
GRANT UPDATE (available_at) ON public.outbox_events TO aven_worker;
