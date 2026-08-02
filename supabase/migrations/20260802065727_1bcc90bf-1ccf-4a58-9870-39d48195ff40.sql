-- Reemplazar acceso público a branches por una vista segura con columnas limitadas
DROP POLICY IF EXISTS "Branches public lookup" ON public.branches;
REVOKE SELECT ON public.branches FROM anon;

DROP VIEW IF EXISTS public.public_branches;
CREATE VIEW public.public_branches
WITH (security_invoker = false, security_barrier = true)
AS
SELECT id, name, slug, address, phone, is_main, schedules
FROM public.branches
WHERE slug IS NOT NULL;

REVOKE ALL ON public.public_branches FROM PUBLIC;
GRANT SELECT ON public.public_branches TO anon, authenticated, service_role;
