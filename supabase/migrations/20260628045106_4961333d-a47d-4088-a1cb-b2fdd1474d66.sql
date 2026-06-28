
-- 1) Sales status + KDS/print timestamps
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS printed_at timestamptz,
  ADD COLUMN IF NOT EXISTS kds_ack_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_status_check') THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_status_check
      CHECK (status IN ('pending','paid','cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sales_status_idx ON public.sales (status, created_at DESC);

-- Allow cashiers to update their own pending sales (to mark ready / cobrar later)
DROP POLICY IF EXISTS "sales update own pending" ON public.sales;
CREATE POLICY "sales update own pending" ON public.sales
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 2) Branches
CREATE TABLE IF NOT EXISTS public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  phone text,
  city text,
  is_main boolean NOT NULL DEFAULT false,
  inherits_main_catalog boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches TO authenticated;
GRANT ALL ON public.branches TO service_role;

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branches read" ON public.branches FOR SELECT TO authenticated USING (true);
CREATE POLICY "branches admin insert" ON public.branches FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "branches admin update" ON public.branches FOR UPDATE TO authenticated USING (has_role(auth.uid(),'admin'));
CREATE POLICY "branches admin delete" ON public.branches FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_branches_updated BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed main branch from settings
INSERT INTO public.branches (name, address, phone, city, is_main, inherits_main_catalog)
SELECT COALESCE(business_name, 'Sede Principal'), address, phone, city, true, true
FROM public.settings WHERE id = 1
ON CONFLICT DO NOTHING;
