ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS notify_ack_at timestamptz;
CREATE INDEX IF NOT EXISTS sales_notify_ack_idx ON public.sales (branch_id, status) WHERE notify_ack_at IS NULL;