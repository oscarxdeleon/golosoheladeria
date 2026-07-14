
-- =============================================================
-- FIX definitivo: pedidos de mesa que "desaparecen" con el tiempo
-- =============================================================
-- Causa raíz:
--   El trigger tg_sale_items_release_table_on_delete se dispara
--   por cada fila borrada en sale_items. Durante un guardado
--   normal (Cajero agrega/edita productos) el POS hace:
--       DELETE FROM sale_items WHERE sale_id = X;
--       INSERT INTO sale_items (...);
--   Al borrar la última fila, el trigger ve la venta con 0 items,
--   la marca como 'cancelled' y libera la mesa. Los items que se
--   insertan a continuación quedan huérfanos en una venta cancelada
--   que la consulta del POS ya no reconoce (filtra pending/confirmed/ready),
--   por lo que la mesa aparece vacía y, tras la reconciliación,
--   vuelve a mostrarse como libre.
-- Solución:
--   - Se elimina ese trigger destructivo. Un pedido pendiente puede
--     quedar temporalmente sin items durante una edición; eso NO
--     debe cancelarlo ni liberar la mesa.
--   - Se agrega un RPC transaccional `replace_sale_items` para que
--     el POS reemplace los items en una sola operación atómica.
-- =============================================================

DROP TRIGGER IF EXISTS trg_sale_items_release_table_on_delete ON public.sale_items;
DROP FUNCTION IF EXISTS public.tg_sale_items_release_table_on_delete();

-- RPC transaccional: reemplaza items de una venta pendiente en
-- una sola operación, sin dejar la venta momentáneamente vacía.
CREATE OR REPLACE FUNCTION public.replace_sale_items(
  _sale_id uuid,
  _items   jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _sale public.sales;
  _rec  jsonb;
  _inserted int := 0;
BEGIN
  IF _sale_id IS NULL THEN RAISE EXCEPTION 'sale_id requerido'; END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'items debe ser un arreglo JSON';
  END IF;

  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF _sale.id IS NULL THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF COALESCE(_sale.status,'pending') NOT IN ('pending','confirmed','ready') THEN
    RAISE EXCEPTION 'El pedido no está activo (status=%). No se puede modificar.', _sale.status;
  END IF;
  IF jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'La lista de productos no puede estar vacía. Cancela el pedido si deseas vaciarlo.';
  END IF;

  -- Todo en la misma transacción del RPC: si algún paso falla, se revierte.
  DELETE FROM public.sale_items WHERE sale_id = _sale_id;

  FOR _rec IN SELECT * FROM jsonb_array_elements(_items) LOOP
    INSERT INTO public.sale_items(
      sale_id, product_id, product_name, qty, unit_price, subtotal, modifiers, notes
    ) VALUES (
      _sale_id,
      (_rec->>'product_id')::uuid,
      _rec->>'product_name',
      COALESCE((_rec->>'qty')::numeric, 0),
      COALESCE((_rec->>'unit_price')::numeric, 0),
      COALESCE((_rec->>'subtotal')::numeric,
               COALESCE((_rec->>'qty')::numeric,0) * COALESCE((_rec->>'unit_price')::numeric,0)),
      COALESCE(_rec->'modifiers', '[]'::jsonb),
      NULLIF(_rec->>'notes','')
    );
    _inserted := _inserted + 1;
  END LOOP;

  -- Garantiza que la mesa siga marcada como ocupada mientras el pedido esté activo.
  IF _sale.table_id IS NOT NULL THEN
    UPDATE public.restaurant_tables
       SET status = 'occupied',
           occupied_at = COALESCE(occupied_at, now())
     WHERE id = _sale.table_id
       AND merged_into_id IS NULL
       AND status <> 'merged'
       AND status <> 'occupied';
  END IF;

  RETURN jsonb_build_object('ok', true, 'sale_id', _sale_id, 'items', _inserted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_sale_items(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_sale_items(uuid, jsonb) TO service_role;

-- =============================================================
-- Rescate de pedidos afectados por el bug anterior
-- =============================================================
-- Ventas que fueron auto-canceladas por el trigger destructivo
-- (motivo = 'Pedido vacío (sin ítems)'), pero cuya mesa sigue
-- marcada como ocupada por otro motivo o quedó libre por error:
--   - Reactivar la venta si aún tiene items después del bug (poco probable)
--     no aplica: la venta se canceló ANTES del INSERT nuevo. Los items
--     insertados después quedaron en una venta 'cancelled'. Los recuperamos.
WITH rescatables AS (
  SELECT s.id AS sale_id, s.table_id
    FROM public.sales s
   WHERE s.status = 'cancelled'
     AND s.cancellation_reason = 'Pedido vacío (sin ítems)'
     AND EXISTS (SELECT 1 FROM public.sale_items i WHERE i.sale_id = s.id)
     AND NOT EXISTS (
       -- Evita reactivar si ya hay otra venta activa en la misma mesa
       SELECT 1 FROM public.sales s2
        WHERE s2.table_id = s.table_id
          AND s2.id <> s.id
          AND COALESCE(s2.status,'pending') IN ('pending','confirmed','ready')
     )
)
UPDATE public.sales s
   SET status = 'pending',
       cancelled_at = NULL,
       cancellation_reason = NULL
  FROM rescatables r
 WHERE s.id = r.sale_id;

-- Reocupa mesas cuyas ventas acabamos de rescatar
UPDATE public.restaurant_tables t
   SET status = 'occupied',
       occupied_at = COALESCE(occupied_at, now())
  FROM public.sales s
 WHERE s.table_id = t.id
   AND COALESCE(s.status,'pending') IN ('pending','confirmed','ready')
   AND t.status = 'free'
   AND t.merged_into_id IS NULL;
