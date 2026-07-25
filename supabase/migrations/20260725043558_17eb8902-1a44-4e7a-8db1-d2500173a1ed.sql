
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS cash_tendered numeric,
  ADD COLUMN IF NOT EXISTS cancelled_by_role text;

COMMENT ON COLUMN public.sales.cash_tendered IS 'Monto exacto entregado por el cliente cuando el método de pago es Efectivo. NULL para otros métodos. Si es igual al total, se muestra como "Valor exacto".';
COMMENT ON COLUMN public.sales.cancelled_by_role IS 'Rol del usuario que anuló la venta (admin | supervisor). Solo se llena en el momento de la anulación.';

CREATE OR REPLACE FUNCTION public.cancel_sale(_sale_id uuid, _reason text, _reason_code text DEFAULT NULL::text)
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
  _table_released boolean := false;
  _is_admin boolean;
  _is_supervisor boolean;
  _role_label text;
  _was_paid boolean;
  _item record;
  _inv_reverted int := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para cancelar un pedido';
  END IF;

  IF length(_reason_trim) < 3 THEN
    RAISE EXCEPTION 'El motivo de la cancelación es obligatorio';
  END IF;

  _is_admin      := public.has_role(_uid, 'admin');
  _is_supervisor := public.has_role(_uid, 'supervisor');

  IF NOT (_is_admin OR _is_supervisor) THEN
    RAISE EXCEPTION 'Operación restringida. Comunícate con el administrador para solicitar la anulación del pedido.';
  END IF;

  -- Prioriza admin cuando el usuario tiene ambos roles
  _role_label := CASE WHEN _is_admin THEN 'admin' ELSE 'supervisor' END;

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

  SELECT COALESCE(full_name, 'Usuario') INTO _uname FROM public.profiles WHERE id = _uid;

  UPDATE public.sales
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = _uid,
         cancelled_by_name = COALESCE(_uname, 'Usuario'),
         cancelled_by_role = _role_label,
         cancellation_reason = _reason_trim,
         cancellation_reason_code = _reason_code,
         cancellation_previous_status = _sale.status
   WHERE id = _sale.id;

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
        'cancel_sale', _table.id, _table.number, _table.branch_id, _uid, COALESCE(_uname,'Usuario'),
        _reason_trim, _sale.status, 'cancelled', _sale.id,
        jsonb_build_object(
          'order_type', _sale.order_type,
          'ticket_number', _sale.ticket_number,
          'table_released', _table_released,
          'was_paid', _was_paid,
          'inventory_reverted_items', _inv_reverted,
          'reason_code', _reason_code,
          'cancelled_by_role', _role_label
        )
      );
    END IF;
  END IF;

  INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
  VALUES (
    'sale', _sale.id, 'cancel_sale', _uid, COALESCE(_uname, 'Usuario'), _sale.branch_id,
    jsonb_build_object('status', _sale.status, 'total', _sale.total, 'table_id', _sale.table_id),
    jsonb_build_object('status', 'cancelled', 'reason', _reason_trim, 'reason_code', _reason_code, 'role', _role_label),
    jsonb_build_object('was_paid', _was_paid, 'inventory_reverted_items', _inv_reverted, 'table_released', _table_released, 'cancelled_by_role', _role_label)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'sale_id', _sale.id,
    'ticket_number', _sale.ticket_number,
    'previous_status', _sale.status,
    'new_status', 'cancelled',
    'reason_code', _reason_code,
    'cancelled_by_role', _role_label,
    'table_released', _table_released,
    'inventory_reverted_items', _inv_reverted,
    'was_paid', _was_paid
  );
END;
$function$;
