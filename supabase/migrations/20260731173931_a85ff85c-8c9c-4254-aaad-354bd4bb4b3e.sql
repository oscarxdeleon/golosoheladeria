DROP VIEW IF EXISTS public.public_branches;
REVOKE SELECT ON public.branches FROM anon;
GRANT SELECT (id, name, slug, address, phone, is_main, schedules) ON public.branches TO anon;
DROP POLICY IF EXISTS "Branches public lookup" ON public.branches;
CREATE POLICY "Branches public lookup" ON public.branches
FOR SELECT TO anon USING (slug IS NOT NULL);