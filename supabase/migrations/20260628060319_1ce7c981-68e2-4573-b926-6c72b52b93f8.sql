
-- Visibilidad de pedidos públicos pendientes para todos los autenticados
CREATE POLICY "sales read public pending"
ON public.sales FOR SELECT TO authenticated
USING (user_id IS NULL AND source IN ('kiosk','table_qr','online_menu'));

CREATE POLICY "si read public pending"
ON public.sale_items FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.sales s
  WHERE s.id = sale_items.sale_id
    AND s.user_id IS NULL
    AND s.source IN ('kiosk','table_qr','online_menu')
));

-- Permitir que cualquier autenticado tome/actualice (cobre) un pedido público pendiente
CREATE POLICY "sales update public pending"
ON public.sales FOR UPDATE TO authenticated
USING (user_id IS NULL AND source IN ('kiosk','table_qr','online_menu'))
WITH CHECK (true);

-- Realtime
ALTER TABLE public.sales REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sales;
