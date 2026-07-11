
-- branches: admin-only writes
DROP POLICY IF EXISTS "branches auth insert" ON public.branches;
DROP POLICY IF EXISTS "branches auth update" ON public.branches;
DROP POLICY IF EXISTS "branches auth delete" ON public.branches;

CREATE POLICY "branches admin insert"
  ON public.branches FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "branches admin update"
  ON public.branches FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "branches admin delete"
  ON public.branches FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- restaurant_tables: mesero/cajero/admin actualizan estado
DROP POLICY IF EXISTS "Autenticados actualizan estado de mesa" ON public.restaurant_tables;
CREATE POLICY "Staff actualiza estado de mesa"
  ON public.restaurant_tables FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'cajero') OR
    public.has_role(auth.uid(),'mesero')
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'cajero') OR
    public.has_role(auth.uid(),'mesero')
  );

-- sales update público-pending: mantener la condición existente en USING y
-- replicarla en WITH CHECK (evita cambiar el estado a algo fuera del alcance).
DROP POLICY IF EXISTS "sales update public pending" ON public.sales;
CREATE POLICY "sales update public pending"
  ON public.sales FOR UPDATE TO authenticated
  USING (user_id IS NULL AND source = ANY (ARRAY['kiosk','table_qr','online_menu']))
  WITH CHECK (user_id IS NULL AND source = ANY (ARRAY['kiosk','table_qr','online_menu']));

-- waiter_calls: staff-only writes (los llamados desde QR anónimo entran vía RPC create_waiter_call)
DROP POLICY IF EXISTS "auth insert waiter calls" ON public.waiter_calls;
DROP POLICY IF EXISTS "auth update waiter calls" ON public.waiter_calls;

CREATE POLICY "waiter_calls staff insert"
  ON public.waiter_calls FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'cajero') OR
    public.has_role(auth.uid(),'mesero')
  );
CREATE POLICY "waiter_calls staff update"
  ON public.waiter_calls FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'cajero') OR
    public.has_role(auth.uid(),'mesero')
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'cajero') OR
    public.has_role(auth.uid(),'mesero')
  );
