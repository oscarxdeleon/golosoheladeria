-- 1) Columnas de auditoría de cancelación en sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by_name text,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancellation_previous_status text;

CREATE INDEX IF NOT EXISTS sales_cancelled_at_idx ON public.sales (cancelled_at DESC) WHERE cancelled_at IS NOT NULL;

-- 2) Función para cancelar una venta con motivo obligatorio.
--    Reglas:
--      * Debe estar autenticado.
--      * Debe tener rol 'cajero' o 'admin' (los meseros NO pueden cancelar).
--      * Motivo obligatorio (>= 3 chars).
--      * Si estaba 'pending'/'confirmed'/'ready': se cancela y se libera la mesa si aplica.
--      * Si estaba 'paid': se cancela igual. El cierre de caja YA excluye ventas
--        cancelled (ver close_cash_session_blind), por lo que el cuadre se ajusta
--        automáticamente sin duplicar movimientos.
--      * Registra evento en table_events cuando aplica, para auditoría cruzada.
CREATE OR REPLACE FUNCTION public.cancel_sale(_sale_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
  _sale public.sales;
  _table public.restaurant_tables;
  _reason_trim text := trim(COALESCE(_reason, ''));
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para cancelar un pedido';
  END IF;

  IF length(_reason_trim) < 3 THEN
    RAISE EXCEPTION 'El motivo de la cancelación es obligatorio';
  END IF;

  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'cajero')) THEN
    RAISE EXCEPTION 'Solo el cajero o el administrador pueden cancelar pedidos';
  END IF;

  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF _sale.id IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;

  IF _sale.status = 'cancelled' THEN
    RAISE EXCEPTION 'El pedido ya fue cancelado';
  END IF;

  SELECT COALESCE(full_name, 'Cajero') INTO _uname FROM public.profiles WHERE id = _uid;

  UPDATE public.sales
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = _uid,
         cancelled_by_name = COALESCE(_uname, 'Cajero'),
         cancellation_reason = _reason_trim,
         cancellation_previous_status = _sale.status
   WHERE id = _sale.id;

  -- Liberar mesa si el pedido la tenía ocupada
  IF _sale.table_id IS NOT NULL THEN
    SELECT * INTO _table FROM public.restaurant_tables WHERE id = _sale.table_id FOR UPDATE;
    IF _table.id IS NOT NULL THEN
      -- Solo liberar si no queda ninguna otra venta pendiente en la mesa
      IF NOT EXISTS (
        SELECT 1 FROM public.sales
         WHERE table_id = _table.id
           AND id <> _sale.id
           AND COALESCE(status, 'pending') IN ('pending','confirmed','ready')
      ) THEN
        UPDATE public.restaurant_tables
           SET status = 'free', current_guests = NULL, occupied_at = NULL
         WHERE id = _table.id;
      END IF;

      INSERT INTO public.table_events(
        event_type, table_id, table_number, branch_id, user_id, user_name,
        reason, previous_status, new_status, sale_id
      ) VALUES (
        'cancel_sale', _table.id, _table.number, _table.branch_id, _uid, COALESCE(_uname,'Cajero'),
        _reason_trim, _sale.status, 'cancelled', _sale.id
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'sale_id', _sale.id,
    'previous_status', _sale.status,
    'was_paid', _sale.status = 'paid'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid, text) TO authenticated;
