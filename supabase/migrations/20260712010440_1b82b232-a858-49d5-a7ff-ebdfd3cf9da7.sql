ALTER TABLE public.table_events DROP CONSTRAINT IF EXISTS table_events_event_type_check;
ALTER TABLE public.table_events ADD CONSTRAINT table_events_event_type_check
  CHECK (event_type IN ('release','move','cancel','auto_release','reconcile','merge','split','cancel_sale'));