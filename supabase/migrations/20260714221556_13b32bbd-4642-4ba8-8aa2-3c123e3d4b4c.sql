-- 1) Tabla por sede
CREATE TABLE IF NOT EXISTS public.branch_print_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL UNIQUE REFERENCES public.branches(id) ON DELETE CASCADE,
  local_print_url text,
  cashier_printer_ip text,
  cashier_printer_port integer DEFAULT 9100,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.branch_print_settings TO authenticated;
GRANT ALL ON public.branch_print_settings TO service_role;

ALTER TABLE public.branch_print_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read branch print settings"
  ON public.branch_print_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert branch print settings"
  ON public.branch_print_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update branch print settings"
  ON public.branch_print_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete branch print settings"
  ON public.branch_print_settings FOR DELETE TO authenticated USING (true);

-- updated_at trigger (reusa función existente si existe, si no la crea)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_bps_updated_at ON public.branch_print_settings;
CREATE TRIGGER trg_bps_updated_at BEFORE UPDATE ON public.branch_print_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Migración: mueve los valores globales existentes a la sede principal
INSERT INTO public.branch_print_settings (branch_id, local_print_url, cashier_printer_ip, cashier_printer_port)
SELECT b.id, s.local_print_url, s.cashier_printer_ip, COALESCE(s.cashier_printer_port, 9100)
FROM public.branches b
CROSS JOIN LATERAL (
  SELECT local_print_url, cashier_printer_ip, cashier_printer_port
  FROM public.settings ORDER BY id LIMIT 1
) s
WHERE b.is_main = true
ON CONFLICT (branch_id) DO NOTHING;
