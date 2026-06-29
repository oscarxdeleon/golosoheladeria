
-- Add branch_id to operational tables for multi-sede support
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;
ALTER TABLE public.restaurant_tables ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_branch_id ON public.sales(branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_branch_id ON public.cash_sessions(branch_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_tables_branch_id ON public.restaurant_tables(branch_id);

-- Ensure at least one main branch exists
INSERT INTO public.branches (name, is_main, inherits_main_catalog)
SELECT 'Sede Principal', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.branches);

-- Backfill existing rows to main branch
UPDATE public.sales SET branch_id = (SELECT id FROM public.branches WHERE is_main = true LIMIT 1) WHERE branch_id IS NULL;
UPDATE public.cash_sessions SET branch_id = (SELECT id FROM public.branches WHERE is_main = true LIMIT 1) WHERE branch_id IS NULL;
UPDATE public.restaurant_tables SET branch_id = (SELECT id FROM public.branches WHERE is_main = true LIMIT 1) WHERE branch_id IS NULL;
