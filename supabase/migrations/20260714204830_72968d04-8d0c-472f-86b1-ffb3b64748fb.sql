
ALTER TABLE public.printers
  ADD COLUMN IF NOT EXISTS drawer_master_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS drawer_on_cash_sale boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS drawer_on_cash_deposit boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS drawer_on_cash_expense boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS drawer_on_cash_close boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS drawer_on_cash_open boolean NOT NULL DEFAULT false;

-- Sincronizar la nueva bandera de ventas con la configuración previa
-- de "open_drawer_on_print" para no cambiar el comportamiento actual
-- de impresoras ya configuradas.
UPDATE public.printers
SET drawer_on_cash_sale = COALESCE(open_drawer_on_print, false)
WHERE drawer_on_cash_sale = true
  AND COALESCE(open_drawer_on_print, false) = false;
