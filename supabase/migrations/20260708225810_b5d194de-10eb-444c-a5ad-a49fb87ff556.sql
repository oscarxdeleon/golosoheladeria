
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS tip_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS enable_tips boolean NOT NULL DEFAULT false;
