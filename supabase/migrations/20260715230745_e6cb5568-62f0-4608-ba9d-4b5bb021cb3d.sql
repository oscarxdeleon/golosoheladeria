-- Supervisor: SELECT-only en tablas operativas para que Dashboard, Reportes
-- y Realtime devuelvan datos idénticos al Administrador.

-- sales
DROP POLICY IF EXISTS "sales supervisor read" ON public.sales;
CREATE POLICY "sales supervisor read" ON public.sales
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'supervisor'::app_role));

-- sale_items
DROP POLICY IF EXISTS "si supervisor read" ON public.sale_items;
CREATE POLICY "si supervisor read" ON public.sale_items
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'supervisor'::app_role));

-- expenses
DROP POLICY IF EXISTS "expenses supervisor read" ON public.expenses;
CREATE POLICY "expenses supervisor read" ON public.expenses
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'supervisor'::app_role));

-- purchases
DROP POLICY IF EXISTS "purchases supervisor read" ON public.purchases;
CREATE POLICY "purchases supervisor read" ON public.purchases
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'supervisor'::app_role));

-- purchase_items (para detalle de compras)
DROP POLICY IF EXISTS "purchase_items supervisor read" ON public.purchase_items;
CREATE POLICY "purchase_items supervisor read" ON public.purchase_items
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'supervisor'::app_role));

-- cash_sessions
DROP POLICY IF EXISTS "cash_sessions supervisor read" ON public.cash_sessions;
CREATE POLICY "cash_sessions supervisor read" ON public.cash_sessions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'supervisor'::app_role));

-- cash_deposits (ya es "true" para authenticated, pero lo dejamos explícito por claridad)
DROP POLICY IF EXISTS "cash_deposits supervisor read" ON public.cash_deposits;
CREATE POLICY "cash_deposits supervisor read" ON public.cash_deposits
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'supervisor'::app_role));

-- restaurant_tables y table_events (para "Mesas ocupadas" en tiempo real)
DROP POLICY IF EXISTS "restaurant_tables supervisor read" ON public.restaurant_tables;
CREATE POLICY "restaurant_tables supervisor read" ON public.restaurant_tables
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'supervisor'::app_role));

DROP POLICY IF EXISTS "table_events supervisor read" ON public.table_events;
CREATE POLICY "table_events supervisor read" ON public.table_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'supervisor'::app_role));