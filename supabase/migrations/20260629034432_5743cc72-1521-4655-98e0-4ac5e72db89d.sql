
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS delivery_neighborhood text,
  ADD COLUMN IF NOT EXISTS payment_details jsonb;

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS nequi_number text,
  ADD COLUMN IF NOT EXISTS bancolombia_account text;

CREATE OR REPLACE FUNCTION public.create_public_order(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _source text := COALESCE(_payload->>'source','online_menu');
  _items jsonb := COALESCE(_payload->'items','[]'::jsonb);
  _sale_id uuid;
  _ticket integer;
  _subtotal numeric(12,2) := 0;
  _item jsonb;
  _qty numeric;
  _price numeric;
BEGIN
  IF _source NOT IN ('online_menu','kiosk','table_qr') THEN
    RAISE EXCEPTION 'Origen de pedido no válido';
  END IF;

  IF jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'El pedido no contiene productos';
  END IF;

  -- Recalcular subtotal en el servidor a partir de los precios reales
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := COALESCE((_item->>'qty')::numeric, 0);
    SELECT price INTO _price FROM public.products WHERE id = (_item->>'product_id')::uuid AND active = true;
    IF _price IS NULL THEN
      RAISE EXCEPTION 'Producto no disponible';
    END IF;
    _subtotal := _subtotal + (_price * _qty);
  END LOOP;

  INSERT INTO public.sales (
    user_id, user_name, source, status, order_type,
    table_id, subtotal, total, delivery_fee, payment_method,
    customer_name, customer_phone, delivery_address, delivery_neighborhood,
    notes, payment_details
  ) VALUES (
    NULL,
    COALESCE(NULLIF(_payload->>'user_name',''),'Cliente'),
    _source,
    'pending',
    COALESCE(_payload->>'order_type','llevar'),
    NULLIF(_payload->>'table_id','')::uuid,
    _subtotal,
    _subtotal,
    0,
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
    SELECT price INTO _price FROM public.products WHERE id = (_item->>'product_id')::uuid;
    INSERT INTO public.sale_items (sale_id, product_id, product_name, unit_price, qty, subtotal, notes)
    VALUES (
      _sale_id,
      (_item->>'product_id')::uuid,
      COALESCE(_item->>'name','Producto'),
      _price,
      _qty,
      _price * _qty,
      NULLIF(_item->>'notes','')
    );
  END LOOP;

  RETURN jsonb_build_object('id', _sale_id, 'ticket_number', _ticket, 'total', _subtotal);
END;
$$;

REVOKE ALL ON FUNCTION public.create_public_order(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_public_order(jsonb) TO anon, authenticated;
