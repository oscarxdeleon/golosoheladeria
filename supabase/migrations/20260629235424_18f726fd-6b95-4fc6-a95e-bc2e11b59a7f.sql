ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_status_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'ready'::text, 'paid'::text, 'cancelled'::text]));

CREATE OR REPLACE FUNCTION public.create_public_order(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _source text := COALESCE(_payload->>'source','online_menu');
  _items jsonb := COALESCE(_payload->'items','[]'::jsonb);
  _sale_id uuid;
  _ticket integer;
  _subtotal numeric(12,2) := 0;
  _delivery_fee numeric(12,2) := 0;
  _total numeric(12,2) := 0;
  _item jsonb;
  _qty numeric;
  _base_price numeric;
  _unit_price numeric;
  _mods jsonb;
  _branch_id uuid;
  _branch_slug text;
  _table_id uuid;
  _available_branch_ids uuid[];
BEGIN
  IF _source NOT IN ('online_menu','kiosk','table_qr') THEN
    RAISE EXCEPTION 'Origen de pedido no válido';
  END IF;
  IF jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'El pedido no contiene productos';
  END IF;

  _branch_id := NULLIF(_payload->>'branch_id','')::uuid;
  _branch_slug := NULLIF(_payload->>'branch_slug','');
  _table_id := NULLIF(_payload->>'table_id','')::uuid;

  IF _branch_id IS NULL AND _branch_slug IS NOT NULL THEN
    SELECT id INTO _branch_id FROM public.branches WHERE slug = _branch_slug LIMIT 1;
  END IF;
  IF _branch_id IS NULL AND _table_id IS NOT NULL THEN
    SELECT branch_id INTO _branch_id FROM public.restaurant_tables WHERE id = _table_id AND active = true;
  END IF;
  IF _branch_id IS NULL THEN
    SELECT id INTO _branch_id FROM public.branches WHERE is_main = true ORDER BY created_at LIMIT 1;
  END IF;

  IF _branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id = _branch_id) THEN
    RAISE EXCEPTION 'No se pudo identificar la sede del pedido';
  END IF;

  IF _table_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_tables
     WHERE id = _table_id AND branch_id = _branch_id AND active = true
  ) THEN
    RAISE EXCEPTION 'La mesa no pertenece a la sede seleccionada';
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := COALESCE((_item->>'qty')::numeric, 0);
    IF _qty <= 0 THEN
      RAISE EXCEPTION 'Cantidad de producto no válida';
    END IF;

    SELECT price, available_branch_ids
      INTO _base_price, _available_branch_ids
      FROM public.products
     WHERE id = (_item->>'product_id')::uuid
       AND active = true
       AND COALESCE(show_in_online, true) = true;

    IF _base_price IS NULL THEN
      RAISE EXCEPTION 'Producto no disponible';
    END IF;

    IF _available_branch_ids IS NOT NULL
       AND array_length(_available_branch_ids, 1) IS NOT NULL
       AND NOT (_branch_id = ANY(_available_branch_ids)) THEN
      RAISE EXCEPTION 'Un producto del pedido no pertenece a esta sede';
    END IF;

    _mods := COALESCE(_item->'modifiers','[]'::jsonb);
    _unit_price := _base_price + COALESCE((
      SELECT SUM(COALESCE((m->>'price')::numeric,0) * COALESCE((m->>'qty')::numeric,0))
      FROM jsonb_array_elements(_mods) m
    ),0);
    _subtotal := _subtotal + (_unit_price * _qty);
  END LOOP;

  IF _source = 'online_menu' THEN
    SELECT COALESCE(delivery_fee, 0) INTO _delivery_fee FROM public.settings LIMIT 1;
    IF _delivery_fee IS NULL THEN _delivery_fee := 0; END IF;
  END IF;
  _total := _subtotal + _delivery_fee;

  INSERT INTO public.sales (
    user_id, user_name, source, status, order_type,
    table_id, branch_id, subtotal, total, delivery_fee, payment_method,
    customer_name, customer_phone, delivery_address, delivery_neighborhood,
    notes, payment_details
  ) VALUES (
    NULL,
    COALESCE(NULLIF(_payload->>'user_name',''),'Cliente'),
    _source,
    'pending',
    COALESCE(_payload->>'order_type','llevar'),
    _table_id,
    _branch_id,
    _subtotal,
    _total,
    _delivery_fee,
    COALESCE(NULLIF(_payload->>'payment_method',''),'Pendiente'),
    NULLIF(_payload->>'customer_name',''),
    NULLIF(_payload->>'customer_phone',''),
    NULLIF(_payload->>'delivery_address',''),
    NULLIF(_payload->>'delivery_neighborhood',''),
    NULLIF(_payload->>'notes',''),
    _payload->'payment_details'
  )
  RETURNING id, ticket_number INTO _sale_id, _ticket;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := COALESCE((_item->>'qty')::numeric, 0);
    SELECT price INTO _base_price FROM public.products WHERE id = (_item->>'product_id')::uuid;
    _mods := COALESCE(_item->'modifiers','[]'::jsonb);
    _unit_price := _base_price + COALESCE((
      SELECT SUM(COALESCE((m->>'price')::numeric,0) * COALESCE((m->>'qty')::numeric,0))
      FROM jsonb_array_elements(_mods) m
    ),0);
    INSERT INTO public.sale_items (sale_id, product_id, product_name, unit_price, qty, subtotal, modifiers)
    VALUES (
      _sale_id,
      (_item->>'product_id')::uuid,
      COALESCE(_item->>'name','Producto'),
      _unit_price,
      _qty,
      _unit_price * _qty,
      _mods
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', _sale_id,
    'ticket_number', _ticket,
    'branch_id', _branch_id,
    'subtotal', _subtotal,
    'delivery_fee', _delivery_fee,
    'total', _total
  );
END;
$function$;