ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS online_sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kiosk_sort_order integer NOT NULL DEFAULT 0;

UPDATE public.categories SET online_sort_order = sort_order WHERE online_sort_order = 0;
UPDATE public.categories SET kiosk_sort_order = sort_order WHERE kiosk_sort_order = 0;