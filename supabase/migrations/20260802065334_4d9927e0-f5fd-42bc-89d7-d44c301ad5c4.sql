-- Restringir lectura/actualización de pedidos públicos pendientes a roles de staff
DROP POLICY IF EXISTS "sales read public pending" ON public.sales;
CREATE POLICY "sales read public pending"
  ON public.sales FOR SELECT TO authenticated
  USING (
    user_id IS NULL
    AND source IN ('kiosk','table_qr','online_menu')
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'cajero')
      OR public.has_role(auth.uid(), 'mesero')
    )
  );

DROP POLICY IF EXISTS "sales update public pending" ON public.sales;
CREATE POLICY "sales update public pending"
  ON public.sales FOR UPDATE TO authenticated
  USING (
    user_id IS NULL
    AND source IN ('kiosk','table_qr','online_menu')
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'cajero')
      OR public.has_role(auth.uid(), 'mesero')
    )
  )
  WITH CHECK (
    user_id IS NULL
    AND source IN ('kiosk','table_qr','online_menu')
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'cajero')
      OR public.has_role(auth.uid(), 'mesero')
    )
  );

DROP POLICY IF EXISTS "si read public pending" ON public.sale_items;
CREATE POLICY "si read public pending"
  ON public.sale_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND s.user_id IS NULL
        AND s.source IN ('kiosk','table_qr','online_menu')
    )
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'cajero')
      OR public.has_role(auth.uid(), 'mesero')
    )
  );
