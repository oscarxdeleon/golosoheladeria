
-- Extend role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'mesero';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'domiciliario';

-- Add delivery assignment to sales
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS delivery_user_id uuid REFERENCES auth.users(id);
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS delivery_status text;

-- Role permissions table: which routes a role can access
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  route_key text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role, route_key)
);

GRANT SELECT ON public.role_permissions TO authenticated, anon;
GRANT ALL ON public.role_permissions TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "role_permissions readable by all auth" ON public.role_permissions
  FOR SELECT USING (true);
CREATE POLICY "role_permissions admin manage" ON public.role_permissions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_role_permissions_touch BEFORE UPDATE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
