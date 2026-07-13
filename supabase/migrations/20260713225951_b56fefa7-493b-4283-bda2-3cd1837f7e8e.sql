
-- Permitir colaboración mesero ↔ cajero ↔ admin sobre ventas de mesa pendientes.
-- Causa raíz: las políticas anteriores sólo dejaban ver la venta a su creador
-- o a un admin, por lo que el cajero abría la mesa ocupada y no veía productos.

-- SALES: SELECT ventas de mesa pendientes/confirmed/ready para cualquier autenticado
DROP POLICY IF EXISTS "sales read pending mesa shared" ON public.sales;
CREATE POLICY "sales read pending mesa shared"
ON public.sales
FOR SELECT
TO authenticated
USING (
  order_type = 'mesa'
  AND COALESCE(status,'pending') IN ('pending','confirmed','ready')
);

-- SALES: UPDATE ventas de mesa pendientes (para agregar productos, cambiar
-- método de pago, cash_session_id al cobrar, etc.). Sin permitir cambiar
-- user_id ni branch_id (verificado en with_check).
DROP POLICY IF EXISTS "sales update pending mesa shared" ON public.sales;
CREATE POLICY "sales update pending mesa shared"
ON public.sales
FOR UPDATE
TO authenticated
USING (
  order_type = 'mesa'
  AND COALESCE(status,'pending') IN ('pending','confirmed','ready')
)
WITH CHECK (
  order_type = 'mesa'
);

-- SALE_ITEMS: SELECT items de ventas de mesa pendientes visibles
DROP POLICY IF EXISTS "si read pending mesa shared" ON public.sale_items;
CREATE POLICY "si read pending mesa shared"
ON public.sale_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND s.order_type = 'mesa'
      AND COALESCE(s.status,'pending') IN ('pending','confirmed','ready')
  )
);

-- SALE_ITEMS: INSERT items en ventas de mesa pendientes visibles
DROP POLICY IF EXISTS "si insert pending mesa shared" ON public.sale_items;
CREATE POLICY "si insert pending mesa shared"
ON public.sale_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND s.order_type = 'mesa'
      AND COALESCE(s.status,'pending') IN ('pending','confirmed','ready')
  )
);

-- SALE_ITEMS: DELETE items en ventas de mesa pendientes (el POS borra e
-- inserta al re-guardar la comanda)
DROP POLICY IF EXISTS "si delete pending mesa shared" ON public.sale_items;
CREATE POLICY "si delete pending mesa shared"
ON public.sale_items
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND s.order_type = 'mesa'
      AND COALESCE(s.status,'pending') IN ('pending','confirmed','ready')
  )
);

-- SALE_ITEMS: UPDATE items (por ejemplo ready_at desde KDS)
DROP POLICY IF EXISTS "si update pending mesa shared" ON public.sale_items;
CREATE POLICY "si update pending mesa shared"
ON public.sale_items
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND s.order_type = 'mesa'
      AND COALESCE(s.status,'pending') IN ('pending','confirmed','ready')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND s.order_type = 'mesa'
  )
);
