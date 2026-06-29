
ALTER TABLE public.printers
  ADD COLUMN IF NOT EXISTS open_drawer_on_print boolean NOT NULL DEFAULT false;
