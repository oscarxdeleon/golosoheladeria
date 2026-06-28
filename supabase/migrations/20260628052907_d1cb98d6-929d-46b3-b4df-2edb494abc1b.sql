
-- Permitir a cualquier usuario autenticado editar ajustes operativos
DROP POLICY IF EXISTS "set admin write" ON public.settings;
CREATE POLICY "set auth write" ON public.settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pm admin write" ON public.payment_methods;
CREATE POLICY "pm auth write" ON public.payment_methods FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pr admin write" ON public.printers;
DROP POLICY IF EXISTS "pr read admin" ON public.printers;
CREATE POLICY "pr auth read" ON public.printers FOR SELECT TO authenticated USING (true);
CREATE POLICY "pr auth write" ON public.printers FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "branches admin insert" ON public.branches;
DROP POLICY IF EXISTS "branches admin update" ON public.branches;
DROP POLICY IF EXISTS "branches admin delete" ON public.branches;
CREATE POLICY "branches auth insert" ON public.branches FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "branches auth update" ON public.branches FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "branches auth delete" ON public.branches FOR DELETE TO authenticated USING (true);
