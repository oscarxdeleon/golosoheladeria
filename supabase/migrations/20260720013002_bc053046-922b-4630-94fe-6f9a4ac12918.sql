-- Add per-branch email recipients for cash close report
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS report_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS report_emails_enabled boolean NOT NULL DEFAULT true;

-- Log table for delivery history
CREATE TABLE IF NOT EXISTS public.cash_report_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid,
  branch_id uuid,
  recipient_email text NOT NULL,
  status text NOT NULL,
  error_message text,
  provider_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.cash_report_email_log TO authenticated;
GRANT ALL ON public.cash_report_email_log TO service_role;
ALTER TABLE public.cash_report_email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_read_cash_report_email_log"
  ON public.cash_report_email_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_cash_report_email_log_branch_created
  ON public.cash_report_email_log (branch_id, created_at DESC);