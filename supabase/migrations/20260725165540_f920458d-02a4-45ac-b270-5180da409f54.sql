-- 1) release_table: solo admin/supervisor
CREATE OR REPLACE FUNCTION public.release_table(_table_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid := auth.uid();
  _t public.restaurant_tables;
  _user_name text;
  _prev_status text;
  _role_label text;
  _cancelled_sale uuid;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  IF NOT (public.has_role(_user_id,'admin') OR public.has_role(_user_id,'supervisor')) THEN
    RAISE EXCEPTION 'ROLE_FORBIDDEN: Esta acción requiere autorización. Comunícate con un Administrador o Supervisor para liberar o cancelar esta mesa.';
  END IF;

  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'Debes ingresar un motivo';
  END IF;

  SELECT * INTO _t FROM public.restaurant_tables WHERE id = _table_id FOR UPDATE;
  IF _t.id IS NULL THEN RAISE EXCEPTION 'Mesa no encontrada'; END IF;
  _prev_status := _t.status;
  _role_label := CASE WHEN public.has_role(_user_id,'admin') THEN 'admin' ELSE 'supervisor' END;

  SELECT COALESCE(full_name,'Usuario') INTO _user_name FROM public.profiles WHERE id = _user_id;

  -- Cancelar pedidos pendientes de la mesa registrando motivo y rol
  FOR _cancelled_sale IN
    SELECT id FROM public.sales
     WHERE table_id = _t.id AND COALESCE(status,'pending') = 'pending'
     FOR UPDATE
  LOOP
    UPDATE public.sales
       SET status = 'cancelled',
           cancelled_at = now(),
           cancelled_by = _user_id,
           cancelled_by_name = _user_name,
           cancelled_by_role = _role_label,
           cancellation_reason = trim(_reason),
           cancellation_previous_status = 'pending'
     WHERE id = _cancelled_sale;

    INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
    VALUES ('sale', _cancelled_sale, 'cancel_sale', _user_id, _user_name, _t.branch_id,
      jsonb_build_object('table_id', _t.id, 'status','pending'),
      jsonb_build_object('status','cancelled','reason',trim(_reason),'role',_role_label),
      jsonb_build_object('source','release_table','role',_role_label));
  END LOOP;

  UPDATE public.restaurant_tables SET
    status = 'free', current_guests = NULL, occupied_at = NULL
  WHERE id = _t.id;

  INSERT INTO public.table_events(event_type, table_id, table_number, branch_id, user_id, user_name,
    reason, previous_status, new_status, metadata)
  VALUES ('release', _t.id, _t.number, _t.branch_id, _user_id, _user_name, trim(_reason), _prev_status, 'free',
    jsonb_build_object('role', _role_label));

  INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
  VALUES ('restaurant_table', _t.id, 'release_table', _user_id, _user_name, _t.branch_id,
    jsonb_build_object('status',_prev_status),
    jsonb_build_object('status','free','reason',trim(_reason),'role',_role_label),
    jsonb_build_object('role',_role_label,'table_number',_t.number));

  RETURN jsonb_build_object('ok', true, 'role', _role_label);
END; $function$;

-- 2) move_table: solo admin/supervisor
CREATE OR REPLACE FUNCTION public.move_table(_from_table_id uuid, _to_table_id uuid, _reason text DEFAULT NULL::text, _force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid := auth.uid();
  _from public.restaurant_tables;
  _to public.restaurant_tables;
  _sale_id uuid;
  _moved_ids uuid[];
  _moved_count int := 0;
  _user_name text;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  IF NOT (public.has_role(_user_id,'admin') OR public.has_role(_user_id,'supervisor')) THEN
    RAISE EXCEPTION 'ROLE_FORBIDDEN: Esta acción requiere autorización. Comunícate con un Administrador o Supervisor para mover o liberar esta mesa.';
  END IF;

  SELECT * INTO _from FROM public.restaurant_tables WHERE id = _from_table_id FOR UPDATE;
  SELECT * INTO _to FROM public.restaurant_tables WHERE id = _to_table_id FOR UPDATE;
  IF _from.id IS NULL OR _to.id IS NULL THEN RAISE EXCEPTION 'Mesa no encontrada'; END IF;
  IF _from.id = _to.id THEN RAISE EXCEPTION 'La mesa destino es la misma que la origen'; END IF;
  IF _from.branch_id <> _to.branch_id THEN RAISE EXCEPTION 'Las mesas deben pertenecer a la misma sede'; END IF;
  IF _to.status = 'occupied' AND NOT _force THEN
    RAISE EXCEPTION 'destination_occupied';
  END IF;

  WITH updated AS (
    UPDATE public.sales SET table_id = _to.id
     WHERE table_id = _from.id AND COALESCE(status,'pending') = 'pending'
     RETURNING id
  )
  SELECT array_agg(id) INTO _moved_ids FROM updated;

  _moved_count := COALESCE(array_length(_moved_ids, 1), 0);
  _sale_id := CASE WHEN _moved_count > 0 THEN _moved_ids[1] ELSE NULL END;

  UPDATE public.restaurant_tables SET
    status = 'occupied',
    current_guests = COALESCE(_to.current_guests, _from.current_guests),
    occupied_at = COALESCE(_to.occupied_at, _from.occupied_at, now())
  WHERE id = _to.id;

  UPDATE public.restaurant_tables SET
    status = 'free', current_guests = NULL, occupied_at = NULL
  WHERE id = _from.id;

  SELECT COALESCE(full_name, 'Usuario') INTO _user_name FROM public.profiles WHERE id = _user_id;

  INSERT INTO public.table_events(event_type, table_id, table_number, target_table_id, target_table_number,
    branch_id, user_id, user_name, reason, previous_status, new_status, sale_id)
  VALUES ('move', _from.id, _from.number, _to.id, _to.number, _from.branch_id, _user_id, _user_name,
    _reason, _from.status, 'free', _sale_id);

  RETURN jsonb_build_object('ok', true, 'sale_id', _sale_id, 'moved_count', _moved_count);
END; $function$;

-- 3) merge_tables: solo admin/supervisor (mantener firma completa)
CREATE OR REPLACE FUNCTION public.merge_tables(_principal_id uuid, _source_ids uuid[], _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
  _principal public.restaurant_tables;
  _src public.restaurant_tables;
  _principal_sale_id uuid;
  _src_sale_id uuid;
  _src_id uuid;
  _moved int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  IF NOT (public.has_role(_uid,'admin') OR public.has_role(_uid,'supervisor')) THEN
    RAISE EXCEPTION 'ROLE_FORBIDDEN: Esta acción requiere autorización. Comunícate con un Administrador o Supervisor para fusionar mesas.';
  END IF;

  IF _principal_id IS NULL OR _source_ids IS NULL OR array_length(_source_ids,1) IS NULL THEN
    RAISE EXCEPTION 'Debes indicar la mesa principal y al menos una mesa a fusionar';
  END IF;

  SELECT * INTO _principal FROM public.restaurant_tables WHERE id = _principal_id FOR UPDATE;
  IF _principal.id IS NULL THEN RAISE EXCEPTION 'Mesa principal no encontrada'; END IF;
  IF _principal.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'La mesa principal ya está fusionada en otra mesa';
  END IF;

  SELECT COALESCE(full_name,'Usuario') INTO _uname FROM public.profiles WHERE id = _uid;

  SELECT id INTO _principal_sale_id FROM public.sales
   WHERE table_id = _principal.id AND COALESCE(status,'pending') = 'pending'
   ORDER BY created_at ASC LIMIT 1;

  IF _principal_sale_id IS NULL THEN
    INSERT INTO public.sales(user_id, user_name, source, status, order_type, table_id, branch_id, subtotal, total, payment_method)
    VALUES (_uid, _uname, 'pos', 'pending', 'mesa', _principal.id, _principal.branch_id, 0, 0, 'Pendiente')
    RETURNING id INTO _principal_sale_id;
  END IF;

  FOREACH _src_id IN ARRAY _source_ids LOOP
    IF _src_id = _principal_id THEN CONTINUE; END IF;
    SELECT * INTO _src FROM public.restaurant_tables WHERE id = _src_id FOR UPDATE;
    IF _src.id IS NULL THEN CONTINUE; END IF;
    IF _src.branch_id <> _principal.branch_id THEN
      RAISE EXCEPTION 'Solo se pueden fusionar mesas de la misma sede';
    END IF;
    IF _src.merged_into_id IS NOT NULL THEN
      RAISE EXCEPTION 'La Mesa % ya está fusionada', _src.number;
    END IF;

    FOR _src_sale_id IN
      SELECT id FROM public.sales
       WHERE table_id = _src.id AND COALESCE(status,'pending') = 'pending'
    LOOP
      WITH moved AS (
        UPDATE public.sale_items
           SET sale_id = _principal_sale_id,
               origin_table_id = COALESCE(origin_table_id, _src.id)
         WHERE sale_id = _src_sale_id
         RETURNING id
      )
      SELECT _moved + COUNT(*) INTO _moved FROM moved;

      UPDATE public.sales SET status = 'merged' WHERE id = _src_sale_id;
    END LOOP;

    UPDATE public.restaurant_tables SET
      status = 'merged',
      merged_into_id = _principal.id,
      merged_at = now(),
      current_guests = NULL,
      occupied_at = NULL
    WHERE id = _src.id;

    INSERT INTO public.table_events(event_type, table_id, table_number, target_table_id, target_table_number,
      branch_id, user_id, user_name, reason, previous_status, new_status, sale_id, metadata)
    VALUES ('merge', _src.id, _src.number, _principal.id, _principal.number,
      _src.branch_id, _uid, _uname, _reason, _src.status, 'merged', _principal_sale_id,
      jsonb_build_object('principal_id', _principal.id, 'principal_number', _principal.number));
  END LOOP;

  UPDATE public.sales s
     SET subtotal = COALESCE(t.sum_sub,0),
         total    = COALESCE(t.sum_sub,0) + COALESCE(s.delivery_fee,0)
    FROM (SELECT COALESCE(SUM(subtotal),0) AS sum_sub FROM public.sale_items WHERE sale_id = _principal_sale_id) t
   WHERE s.id = _principal_sale_id;

  UPDATE public.restaurant_tables SET
    status = 'occupied',
    occupied_at = COALESCE(occupied_at, now())
  WHERE id = _principal.id;

  INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, meta)
  VALUES ('restaurant_table', _principal.id, 'tables_merged', _uid, _uname, _principal.branch_id,
    jsonb_build_object('principal_id', _principal.id, 'principal_number', _principal.number,
                       'source_ids', to_jsonb(_source_ids), 'items_moved', _moved,
                       'reason', _reason, 'sale_id', _principal_sale_id));

  RETURN jsonb_build_object('ok', true, 'sale_id', _principal_sale_id, 'items_moved', _moved);
END; $function$;

-- 4) Mejorar mensaje de cancel_sale
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
    RAISE EXCEPTION 'ROLE_FORBIDDEN: Esta acción requiere autorización. Comunícate con un Administrador o Supervisor para anular este pedido.';
  END IF;

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
    jsonb_build_object('was_paid', _was_paid, 'inventory_reverted_items', _inv_reverted, 'table_released', _table_released, 'cancelled_by_role', _role_label, 'order_type', _sale.order_type)
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

-- 5) admin_delete_sale: elimina lógicamente (marca cancelled + role=deleted) desde el panel admin
CREATE OR REPLACE FUNCTION public.admin_delete_sale(_sale_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
  _sale public.sales;
  _reason_trim text := trim(COALESCE(_reason,''));
  _is_admin boolean;
  _is_supervisor boolean;
  _role_label text;
  _table_released boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  _is_admin := public.has_role(_uid,'admin');
  _is_supervisor := public.has_role(_uid,'supervisor');

  IF NOT (_is_admin OR _is_supervisor) THEN
    RAISE EXCEPTION 'ROLE_FORBIDDEN: Esta acción requiere autorización. Comunícate con un Administrador o Supervisor para eliminar este pedido.';
  END IF;

  IF length(_reason_trim) < 3 THEN
    RAISE EXCEPTION 'El motivo es obligatorio (mínimo 3 caracteres)';
  END IF;

  _role_label := CASE WHEN _is_admin THEN 'admin' ELSE 'supervisor' END;

  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF _sale.id IS NULL THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;

  SELECT COALESCE(full_name,'Usuario') INTO _uname FROM public.profiles WHERE id = _uid;

  UPDATE public.sales
     SET status = 'cancelled',
         cancelled_at = COALESCE(cancelled_at, now()),
         cancelled_by = COALESCE(cancelled_by, _uid),
         cancelled_by_name = COALESCE(cancelled_by_name, _uname),
         cancelled_by_role = _role_label,
         cancellation_reason = _reason_trim,
         cancellation_reason_code = COALESCE(cancellation_reason_code,'admin_delete'),
         cancellation_previous_status = COALESCE(cancellation_previous_status, _sale.status)
   WHERE id = _sale.id;

  IF _sale.table_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.sales
       WHERE table_id = _sale.table_id AND id <> _sale.id
         AND COALESCE(status,'pending') IN ('pending','confirmed','ready')
    ) THEN
      UPDATE public.restaurant_tables
         SET status = 'free', current_guests = NULL, occupied_at = NULL
       WHERE id = _sale.table_id;
      _table_released := true;
    END IF;
  END IF;

  INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
  VALUES ('sale', _sale.id, 'admin_delete_sale', _uid, _uname, _sale.branch_id,
    jsonb_build_object('status', _sale.status, 'total', _sale.total, 'table_id', _sale.table_id, 'order_type', _sale.order_type),
    jsonb_build_object('status','cancelled','reason',_reason_trim,'role',_role_label),
    jsonb_build_object('order_type', _sale.order_type, 'ticket_number', _sale.ticket_number, 'table_released', _table_released, 'role', _role_label));

  RETURN jsonb_build_object('ok', true, 'sale_id', _sale.id, 'table_released', _table_released, 'role', _role_label);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_delete_sale(uuid, text) TO authenticated;

-- Habilitar realtime en sales para el panel (idempotente)
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sales;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;