ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS show_in_pos boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_in_online_menu boolean NOT NULL DEFAULT true;