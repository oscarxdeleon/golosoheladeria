
CREATE TABLE public.whatsapp_hub_sessions (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'disconnected',
  connected_phone text,
  last_qr text,
  last_qr_at timestamptz,
  last_connected_at timestamptz,
  last_disconnected_at timestamptz,
  last_error text,
  hub_instance_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_hub_sessions_status_check
    CHECK (status IN ('disconnected','connecting','awaiting_qr','connected','needs_qr','error'))
);

GRANT SELECT ON public.whatsapp_hub_sessions TO authenticated;
GRANT ALL ON public.whatsapp_hub_sessions TO service_role;

ALTER TABLE public.whatsapp_hub_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_sessions_admin_supervisor_read"
  ON public.whatsapp_hub_sessions
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'supervisor')
  );

CREATE OR REPLACE FUNCTION public.tg_whatsapp_hub_sessions_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_whatsapp_hub_sessions_touch
  BEFORE UPDATE ON public.whatsapp_hub_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_whatsapp_hub_sessions_touch();
