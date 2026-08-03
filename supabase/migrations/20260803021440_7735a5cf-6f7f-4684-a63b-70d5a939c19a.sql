
CREATE TABLE IF NOT EXISTS public.app_deploy_config (
  provider text PRIMARY KEY,
  hook_url text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_deploy_config TO authenticated;
GRANT ALL ON public.app_deploy_config TO service_role;
ALTER TABLE public.app_deploy_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage deploy config" ON public.app_deploy_config;
CREATE POLICY "admins manage deploy config" ON public.app_deploy_config
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.app_deploy_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL DEFAULT 'vercel',
  status text NOT NULL,
  message text,
  http_status integer,
  duration_ms integer,
  job_id text,
  build_url text,
  triggered_by uuid
);
GRANT SELECT, INSERT ON public.app_deploy_log TO authenticated;
GRANT ALL ON public.app_deploy_log TO service_role;
ALTER TABLE public.app_deploy_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read deploy log" ON public.app_deploy_log;
CREATE POLICY "admins read deploy log" ON public.app_deploy_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "admins write deploy log" ON public.app_deploy_log;
CREATE POLICY "admins write deploy log" ON public.app_deploy_log
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS app_deploy_log_created_idx ON public.app_deploy_log (created_at DESC);

INSERT INTO public.app_deploy_config (provider, hook_url)
VALUES ('vercel', 'https://api.vercel.com/v1/integrations/deploy/prj_nvWGWYAXjbo0DKrdQKW6JtMZwyij/42Z7OywfBv')
ON CONFLICT (provider) DO NOTHING;
