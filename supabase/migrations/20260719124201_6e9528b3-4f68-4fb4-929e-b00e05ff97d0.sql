ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS report_whatsapp_numbers JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.branches.report_whatsapp_numbers IS
  'Array de objetos {phone, label, enabled} — destinatarios del reporte de cierre de caja por WhatsApp. Máx 5.';
