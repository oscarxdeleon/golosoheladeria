
-- 1. Extender printers con branch_id y local_url
ALTER TABLE public.printers
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS local_url text;

CREATE INDEX IF NOT EXISTS printers_branch_id_idx ON public.printers(branch_id);

-- 2. Log de auto-detección de sede
CREATE TABLE IF NOT EXISTS public.branch_detection_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  detected_branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  detection_method text NOT NULL,
  probe_url text,
  device_fingerprint text,
  user_agent text,
  success boolean NOT NULL DEFAULT true,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS branch_detection_log_user_idx ON public.branch_detection_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS branch_detection_log_branch_idx ON public.branch_detection_log(detected_branch_id, created_at DESC);

GRANT SELECT, INSERT ON public.branch_detection_log TO authenticated;
GRANT ALL ON public.branch_detection_log TO service_role;

ALTER TABLE public.branch_detection_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert their own detection events"
  ON public.branch_detection_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all detection events"
  ON public.branch_detection_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users view their own detection events"
  ON public.branch_detection_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
