
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS delivery_fee numeric(12,2) NULL;

COMMENT ON COLUMN public.branches.delivery_fee IS
  'Tarifa de domicilio propia de la sede (COP). NULL = usar tarifa global de settings.';
