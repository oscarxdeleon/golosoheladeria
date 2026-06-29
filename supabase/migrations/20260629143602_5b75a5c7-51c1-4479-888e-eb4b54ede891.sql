
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS allow_negative_stock boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sold_by_weight boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_in_online boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS available_branch_ids uuid[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS modifier_group_ids uuid[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS recipe jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_products_is_favorite ON public.products(is_favorite) WHERE is_favorite = true;
CREATE INDEX IF NOT EXISTS idx_products_show_in_online ON public.products(show_in_online) WHERE show_in_online = true;
