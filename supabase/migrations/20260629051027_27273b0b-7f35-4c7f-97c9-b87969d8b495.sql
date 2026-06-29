ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS cashier_printer_ip text,
  ADD COLUMN IF NOT EXISTS cashier_printer_port integer DEFAULT 9100;