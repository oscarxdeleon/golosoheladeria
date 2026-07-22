-- 1) Columna para categorizar motivo de anulación
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS cancellation_reason_code text;

-- 2) Recrear cancel_sale con parámetro opcional _reason_code
CREATE OR REPLACE FUNCTION public.cancel_sale(
  _sale_id uuid,
  _reason text,
  _reason_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
  _sale public.sales;
  _table public.restaurant_tables;
  _reason_trim text := trim(COALESCE(_reason, ''));
  _reason_code_norm text := NULLIF(trim(COALESCE(_reason_code, '')), '');
  _table_released boolean := false;
  _is_admin boolean;
  _is_supervisor boolean;
  _is_cajero boolean;
  _was_paid boolean;
  _item record;
  _inv_reverted int := 0;
  _valid_codes text[] := ARRAY['arrepentimiento','sin_dinero','cambio_producto','demora','cambio_pago','otro'];
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para cancelar un pedido';
  END IF;

  IF length(_reason_trim) < 3 THEN
    RAISE EXCEPTION 'El motivo de la cancelación es obligatorio';
  END IF;

  IF _reason_code_norm IS NOT NULL AND NOT (_reason_code_norm = ANY(_valid_codes)) THEN
    RAISE EXCEPTION 'Código de motivo inválido: %', _reason_code_norm;
  END IF;

  _is_admin      := public.has_role(_uid, 'admin');
  _is_supervisor := public.has_role(_uid, 'supervisor');
  _is_cajero     := public.has_role(_uid, 'cajero');

  IF NOT (_is_admin OR _is_supervisor OR _is_cajero) THEN
    RAISE EXCEPTION 'Solo el cajero, supervisor o administrador pueden anular pedidos';
  END IF;

  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;

  IF _sale.id IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;

  IF _sale.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'ok', true, 'sale_id', _sale.id, 'already_cancelled', true,
      'previous_status', _sale.cancellation_previous_status, 'table_released', false
    );
  END IF;

  _was_paid := _sale.status = 'paid';

  -- Cajero solo puede anular ventas no pagadas del día actual y de su misma sede.
  -- Ventas ya pagadas (afectan caja) requieren admin o supervisor.
  IF _was_paid AND NOT (_is_admin OR _is_supervisor) THEN
    RAISE EXCEPTION 'Este pedido ya fue pagado. Solo el administrador o supervisor puede anularlo (requiere reversión).';
  END IF;

  SELECT COALESCE(full_name, 'Cajero') INTO _uname FROM public.profiles WHERE id = _uid;

  UPDATE public.sales
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = _uid,
         cancelled_by_name = COALESCE(_uname, 'Cajero'),
         cancellation_reason = _reason_trim,
         cancellation_reason_code = _reason_code_norm,
         cancellation_previous_status = _sale.status
   WHERE id = _sale.id;

  -- Reponer inventario
  FOR _item IN
    SELECT si.product_id, si.qty, si.product_name, p.track_stock
      FROM public.sale_items si
      JOIN public.products p ON p.id = si.product_id
     WHERE si.sale_id = _sale.id
       AND si.product_id IS NOT NULL
       AND COALESCE(p.track_stock, false) = true
  LOOP
    UPDATE public.products
       SET stock = COALESCE(stock, 0) + _item.qty
     WHERE id = _item.product_id;

    INSERT INTO public.inventory_movements(
      item_type, product_id, movement_type, quantity, reason, user_id
    ) VALUES (
      'product', _item.product_id, 'entrada', _item.qty,
      'Reversión por anulación pedido #' || _sale.ticket_number || ' — ' || _reason_trim,
      _uid
    );
    _inv_reverted := _inv_reverted + 1;
  END LOOP;

  -- Liberar mesa si corresponde
  IF _sale.table_id IS NOT NULL THEN
    SELECT * INTO _table FROM public.restaurant_tables WHERE id = _sale.table_id FOR UPDATE;

    IF _table.id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.sales
         WHERE table_id = _table.id AND id <> _sale.id
           AND COALESCE(status, 'pending') IN ('pending','confirmed','ready')
      ) THEN
        UPDATE public.restaurant_tables
           SET status = 'free', current_guests = NULL, occupied_at = NULL
         WHERE id = _table.id;
        _table_released := true;
      END IF;

      INSERT INTO public.table_events(
        event_type, table_id, table_number, branch_id, user_id, user_name,
        reason, previous_status, new_status, sale_id, metadata
      ) VALUES (
        'cancel_sale', _table.id, _table.number, _table.branch_id, _uid, COALESCE(_uname,'Cajero'),
        _reason_trim, _sale.status, 'cancelled', _sale.id,
        jsonb_build_object(
          'order_type', _sale.order_type,
          'ticket_number', _sale.ticket_number,
          'table_released', _table_released,
          'was_paid', _was_paid,
          'reason_code', _reason_code_norm,
          'inventory_reverted_items', _inv_reverted
        )
      );
    END IF;
  END IF;

  INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
  VALUES (
    'sale', _sale.id, 'cancel_sale', _uid, COALESCE(_uname, 'Cajero'), _sale.branch_id,
    jsonb_build_object(
      'status', _sale.status, 'total', _sale.total, 'table_id', _sale.table_id,
      'order_type', _sale.order_type, 'ticket_number', _sale.ticket_number,
      'payment_method', _sale.payment_method
    ),
    jsonb_build_object(
      'status', 'cancelled', 'cancelled_at', now(), 'cancelled_by', _uid,
      'cancelled_by_name', COALESCE(_uname, 'Cajero'),
      'cancellation_reason', _reason_trim,
      'cancellation_reason_code', _reason_code_norm,
      'table_released', _table_released,
      'inventory_reverted_items', _inv_reverted
    ),
    jsonb_build_object(
      'source', 'cancel_sale_rpc', 'reason', _reason_trim, 'reason_code', _reason_code_norm,
      'was_paid', _was_paid, 'inventory_reverted_items', _inv_reverted
    )
  );

  RETURN jsonb_build_object(
    'ok', true, 'sale_id', _sale.id, 'ticket_number', _sale.ticket_number,
    'previous_status', _sale.status, 'new_status', 'cancelled',
    'reason_code', _reason_code_norm,
    'was_paid', _was_paid, 'table_released', _table_released,
    'inventory_reverted_items', _inv_reverted
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid, text, text) TO authenticated;