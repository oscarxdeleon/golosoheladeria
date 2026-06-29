
-- 1. Add branch assignment to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- 2. Seed default role permissions for non-admin roles (idempotent)
-- Cajero: POS operativo + Kiosko + Pedidos en línea + Caja para abrir/cerrar caja a ciegas
DO $$
DECLARE
  _cajero_keys text[] := ARRAY['pos','caja','kiosko','pedidos-online','clientes'];
  _mesero_keys text[] := ARRAY['mesas','llevar','domicilio','kds'];
  _domi_keys   text[] := ARRAY['domicilios','pedidos-online'];
  k text;
BEGIN
  FOREACH k IN ARRAY _cajero_keys LOOP
    INSERT INTO public.role_permissions(role, route_key, allowed)
    VALUES ('cajero', k, true)
    ON CONFLICT (role, route_key) DO NOTHING;
  END LOOP;
  FOREACH k IN ARRAY _mesero_keys LOOP
    INSERT INTO public.role_permissions(role, route_key, allowed)
    VALUES ('mesero', k, true)
    ON CONFLICT (role, route_key) DO NOTHING;
  END LOOP;
  FOREACH k IN ARRAY _domi_keys LOOP
    INSERT INTO public.role_permissions(role, route_key, allowed)
    VALUES ('domiciliario', k, true)
    ON CONFLICT (role, route_key) DO NOTHING;
  END LOOP;
END $$;

-- 3. Allow admins to update any profile (rol y sede)
DROP POLICY IF EXISTS "profiles admin update" ON public.profiles;
CREATE POLICY "profiles admin update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "profiles admin insert" ON public.profiles;
CREATE POLICY "profiles admin insert" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 4. RLS for user_roles management by admin
DROP POLICY IF EXISTS "user_roles admin manage" ON public.user_roles;
CREATE POLICY "user_roles admin manage" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
