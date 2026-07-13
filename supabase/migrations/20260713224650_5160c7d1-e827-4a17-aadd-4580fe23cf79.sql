
CREATE TABLE IF NOT EXISTS public.print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE SET NULL,
  sale_id uuid NULL REFERENCES public.sales(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'comanda',
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  tries int NOT NULL DEFAULT 0,
  last_error text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  printed_at timestamptz NULL,
  locked_at timestamptz NULL,
  locked_by text NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.print_jobs TO authenticated;
GRANT ALL ON public.print_jobs TO service_role;

ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth can read print jobs"
  ON public.print_jobs FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth can insert print jobs"
  ON public.print_jobs FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth can update print jobs"
  ON public.print_jobs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth can delete print jobs"
  ON public.print_jobs FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS print_jobs_status_branch_idx
  ON public.print_jobs (status, branch_id, created_at);

CREATE OR REPLACE FUNCTION public.print_jobs_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS print_jobs_touch_updated_at ON public.print_jobs;
CREATE TRIGGER print_jobs_touch_updated_at
  BEFORE UPDATE ON public.print_jobs
  FOR EACH ROW EXECUTE FUNCTION public.print_jobs_touch_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.print_jobs;
