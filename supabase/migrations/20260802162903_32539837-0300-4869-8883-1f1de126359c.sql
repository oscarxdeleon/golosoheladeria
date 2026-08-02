CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_cart_confirm(_token text, _phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cfg RECORD;
  cart RECORD;
  bid uuid;
  sid uuid;
  uid uuid;
  ticket integer;
  subtotal numeric := 0;
  delivery_fee numeric := 0;
  total numeric := 0;
  item jsonb;
  item_mods jsonb;
  item_notes text;
  resolved_pid uuid;
  product_active boolean;
  product_name text;
  qty numeric;
  unit_price numeric;
  line_total numeric;
  order_type text;
  sale_type text;
  payment text;
  order_number text;
  created_sale jsonb;
BEGIN
  SELECT * INTO cfg FROM public.whatsapp_bot_config WHERE device_token = _token LIMIT 1;
  IF cfg IS NULL OR NOT COALESCE(cfg.enabled, false) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  bid := cfg.branch_id;

  SELECT * INTO cart
  FROM public.whatsapp_ai_carts
  WHERE branch_id = bid
    AND public.whatsapp_bot_contact_key(customer_phone) = public.whatsapp_bot_contact_key(_phone)
    AND status = 'building'
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF cart IS NULL THEN RAISE EXCEPTION 'cart_not_found'; END IF;
  IF jsonb_array_length(COALESCE(cart.items, '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'empty_cart'; END IF;

  order_type := COALESCE(NULLIF(cart.order_type, ''), 'pickup');
  sale_type := CASE WHEN order_type = 'delivery' THEN 'delivery' ELSE 'takeout' END;
  payment := CASE WHEN lower(COALESCE(cart.payment_method, '')) IN ('cash','efectivo') THEN 'cash' ELSE 'transfer' END;
  delivery_fee := CASE WHEN order_type = 'delivery' THEN COALESCE(cart.delivery_fee, 0) ELSE 0 END;

  SELECT id INTO uid FROM auth.users ORDER BY created_at LIMIT 1;
  IF uid IS NULL THEN RAISE EXCEPTION 'no_pos_user'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(bid::text));
  SELECT COALESCE(max(ticket_number), 0) + 1 INTO ticket FROM public.sales WHERE branch_id = bid;
  order_number := 'WA-' || to_char(now(), 'YYMMDD') || '-' || lpad(ticket::text, 4, '0');

  FOR item IN SELECT value FROM jsonb_array_elements(cart.items)
  LOOP
    qty := GREATEST(COALESCE((item->>'qty')::numeric, 1), 1);
    unit_price := GREATEST(COALESCE((item->>'unit_price')::numeric, 0), 0);
    line_total := qty * unit_price;
    subtotal := subtotal + line_total;
  END LOOP;
  total := subtotal + delivery_fee;

  INSERT INTO public.sales (
    branch_id, user_id, ticket_number, type, status, subtotal, discount,
    tax, total, payment_status, customer_name, customer_phone,
    customer_address, customer_neighborhood, notes, source, order_number,
    payment_method, delivery_fee
  ) VALUES (
    bid, uid, ticket, sale_type, 'pending', subtotal, 0,
    0, total, 'pending', cart.customer_name, public.whatsapp_bot_contact_key(_phone),
    cart.delivery_address, cart.delivery_neighborhood, cart.delivery_notes,
    'whatsapp', order_number, payment, delivery_fee
  ) RETURNING id INTO sid;

  FOR item IN SELECT value FROM jsonb_array_elements(cart.items)
  LOOP
    resolved_pid := NULL;
    product_name := COALESCE(item->>'product_name', 'Producto WhatsApp');
    qty := GREATEST(COALESCE((item->>'qty')::numeric, 1), 1);
    unit_price := GREATEST(COALESCE((item->>'unit_price')::numeric, 0), 0);
    line_total := qty * unit_price;
    item_mods := COALESCE(item->'modifiers', '[]'::jsonb);
    item_notes := NULLIF(item->>'notes', '');

    IF COALESCE(item->>'product_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT p.id, p.active INTO resolved_pid, product_active
      FROM public.products p
      WHERE p.id = (item->>'product_id')::uuid
        AND (p.available_branch_ids IS NULL OR bid = ANY(p.available_branch_ids))
      LIMIT 1;
      IF NOT COALESCE(product_active, false) THEN resolved_pid := NULL; END IF;
    END IF;

    IF resolved_pid IS NULL THEN
      SELECT p.id INTO resolved_pid
      FROM public.products p
      WHERE p.active = true
        AND (p.available_branch_ids IS NULL OR bid = ANY(p.available_branch_ids))
        AND (
          public._whatsapp_normalize_text(p.name) = public._whatsapp_normalize_text(product_name)
          OR public._whatsapp_normalize_text(p.name) LIKE '%' || public._whatsapp_normalize_text(product_name) || '%'
          OR public._whatsapp_normalize_text(product_name) LIKE '%' || public._whatsapp_normalize_text(p.name) || '%'
        )
      ORDER BY CASE WHEN public._whatsapp_normalize_text(p.name) = public._whatsapp_normalize_text(product_name) THEN 0 ELSE 1 END, p.name
      LIMIT 1;
    END IF;

    INSERT INTO public.sale_items (sale_id, product_id, product_name, quantity, unit_price, total, modifiers, notes)
    VALUES (sid, resolved_pid, product_name, qty, unit_price, line_total, item_mods, item_notes);
  END LOOP;

  UPDATE public.whatsapp_ai_carts
  SET status = 'confirmed', sale_id = sid, updated_at = now()
  WHERE id = cart.id;

  SELECT to_jsonb(s) INTO created_sale FROM public.sales s WHERE s.id = sid;
  RETURN jsonb_build_object('sale', created_sale, 'sale_id', sid, 'order_number', order_number, 'ticket_number', ticket, 'total', total);
END;
$function$;

REVOKE ALL ON FUNCTION public.whatsapp_bot_ai_cart_confirm(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_cart_confirm(text, text) TO anon, authenticated, service_role;