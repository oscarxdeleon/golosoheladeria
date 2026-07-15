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
  _table_released boolean := false;
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

  SELECT * INTO _sale
    FROM public.sales
   WHERE id = _sale_id
   FOR UPDATE;

  IF _sale.id IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;

  IF _sale.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'sale_id', _sale.id,
      'already_cancelled', true,
      'previous_status', _sale.cancellation_previous_status,
      'table_released', false
    );
  END IF;

  SELECT COALESCE(full_name, 'Cajero') INTO _uname
    FROM public.profiles
   WHERE id = _uid;

  UPDATE public.sales
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = _uid,
         cancelled_by_name = COALESCE(_uname, 'Cajero'),
         cancellation_reason = _reason_trim,
         cancellation_previous_status = _sale.status
   WHERE id = _sale.id;

  IF _sale.table_id IS NOT NULL THEN
    SELECT * INTO _table
      FROM public.restaurant_tables
     WHERE id = _sale.table_id
     FOR UPDATE;

    IF _table.id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
          FROM public.sales
         WHERE table_id = _table.id
           AND id <> _sale.id
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
          'table_released', _table_released
        )
      );
    END IF;
  END IF;

  INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
  VALUES (
    'sale',
    _sale.id,
    'cancel_sale',
    _uid,
    COALESCE(_uname, 'Cajero'),
    _sale.branch_id,
    jsonb_build_object(
      'status', _sale.status,
      'total', _sale.total,
      'table_id', _sale.table_id,
      'order_type', _sale.order_type,
      'ticket_number', _sale.ticket_number
    ),
    jsonb_build_object(
      'status', 'cancelled',
      'cancelled_at', now(),
      'cancelled_by', _uid,
      'cancelled_by_name', COALESCE(_uname, 'Cajero'),
      'cancellation_reason', _reason_trim,
      'table_released', _table_released
    ),
    jsonb_build_object(
      'source', 'cancel_sale_rpc',
      'reason', _reason_trim,
      'was_paid', _sale.status = 'paid'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'sale_id', _sale.id,
    'ticket_number', _sale.ticket_number,
    'previous_status', _sale.status,
    'new_status', 'cancelled',
    'was_paid', _sale.status = 'paid',
    'table_released', _table_released
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_sale(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid, text) TO authenticated;