ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS neighborhood text,
  ADD COLUMN IF NOT EXISTS nit text,
  ADD COLUMN IF NOT EXISTS ticket_header text,
  ADD COLUMN IF NOT EXISTS ticket_footer text;