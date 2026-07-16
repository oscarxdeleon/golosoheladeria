-- 1) Limpiar duplicados históricos: conservar el pedido activo más antiguo por mesa
--    y cancelar los demás para no violar el índice único que crearemos abajo.
WITH ranked AS (
  SELECT id,
         table_id,
         created_at,
         ROW_NUMBER() OVER (
           PARTITION BY table_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.sales
  WHERE table_id IS NOT NULL
    AND status IN ('pending','confirmed','ready')
)
UPDATE public.sales s
SET status = 'cancelled',
    cancelled_at = COALESCE(s.cancelled_at, now()),
    cancellation_reason = COALESCE(s.cancellation_reason, 'consolidado - duplicado por mesa (auto)')
FROM ranked r
WHERE r.id = s.id
  AND r.rn > 1;

-- 2) Índice único parcial: una sola venta activa por mesa
CREATE UNIQUE INDEX IF NOT EXISTS sales_unique_active_per_table
  ON public.sales (table_id)
  WHERE table_id IS NOT NULL
    AND status IN ('pending','confirmed','ready');

-- 3) Función de consolidación segura (SECURITY DEFINER) — el cliente puede
--    invocarla si detecta más de una venta activa para la misma mesa. Mueve
--    los ítems al pedido más antiguo y cancela los duplicados.
CREATE OR REPLACE FUNCTION public.consolidate_active_sales_for_table(_table_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _keeper uuid;
BEGIN
  IF _table_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Pedido más antiguo activo → se conserva
  SELECT id
    INTO _keeper
    FROM public.sales
   WHERE table_id = _table_id
     AND status IN ('pending','confirmed','ready')
   ORDER BY created_at ASC, id ASC
   LIMIT 1;

  IF _keeper IS NULL THEN
    RETURN NULL;
  END IF;

  -- Mover ítems de los duplicados al pedido conservado
  UPDATE public.sale_items si
     SET sale_id = _keeper
   WHERE si.sale_id IN (
     SELECT id FROM public.sales
      WHERE table_id = _table_id
        AND status IN ('pending','confirmed','ready')
        AND id <> _keeper
   );

  -- Cancelar los duplicados
  UPDATE public.sales
     SET status = 'cancelled',
         cancelled_at = COALESCE(cancelled_at, now()),
         cancellation_reason = COALESCE(cancellation_reason, 'consolidado - duplicado por mesa (auto)')
   WHERE table_id = _table_id
     AND status IN ('pending','confirmed','ready')
     AND id <> _keeper;

  RETURN _keeper;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consolidate_active_sales_for_table(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consolidate_active_sales_for_table(uuid) TO service_role;