-- Supervisor accounts: read-only access via username + 4-digit PIN
CREATE TABLE IF NOT EXISTS public.supervisor_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  access_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supervisor_accounts TO authenticated;
GRANT ALL ON public.supervisor_accounts TO service_role;

ALTER TABLE public.supervisor_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage supervisor accounts"
  ON public.supervisor_accounts
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Session tokens for supervisor logins (bearer stored in localStorage on the tablet)
CREATE TABLE IF NOT EXISTS public.supervisor_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.supervisor_accounts(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  ip TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '12 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supervisor_sessions TO authenticated;
GRANT ALL ON public.supervisor_sessions TO service_role;

ALTER TABLE public.supervisor_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view supervisor sessions"
  ON public.supervisor_sessions
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Audit log for supervisor activity
CREATE TABLE IF NOT EXISTS public.supervisor_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES public.supervisor_accounts(id) ON DELETE SET NULL,
  username TEXT,
  event TEXT NOT NULL, -- login_success | login_failed | logout | branch_switch | view
  detail JSONB,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supervisor_audit_log TO authenticated;
GRANT ALL ON public.supervisor_audit_log TO service_role;

ALTER TABLE public.supervisor_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view supervisor audit"
  ON public.supervisor_audit_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.update_supervisor_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_supervisor_accounts_updated
  BEFORE UPDATE ON public.supervisor_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_supervisor_accounts_updated_at();
