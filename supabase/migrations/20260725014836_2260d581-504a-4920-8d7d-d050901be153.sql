CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_cart_confirm(_token text, _phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bid uuid;
  cart public.whatsapp_ai_carts%ROWTYPE;
  cfg public.whatsapp_bot_config%ROWTYPE;
  sale_id uuid;
  ticket int;
  item jsonb;
  resolved_pid uuid;
  raw_name text;
  normalized_name text;
  order_no text;
  recent_count int;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;

  SELECT * INTO cfg FROM public.whatsapp_bot_config WHERE branch_id = bid;

  SELECT count(*) INTO recent_count
  FROM public.sales
  WHERE branch_id = bid
    AND source = 'whatsapp_bot'
    AND customer_phone = regexp_replace(COALESCE(_phone, ''), '\D', '', 'g')
    AND created_at::date = CURRENT_DATE;

  IF recent_count >= COALESCE(cfg.ordering_daily_limit_per_phone, 3) THEN
    RAISE EXCEPTION 'daily order limit exceeded';
  END IF;

  SELECT * INTO cart
  FROM public.whatsapp_ai_carts
  WHERE branch_id = bid AND phone = _phone AND status = 'building'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'no active cart'; END IF;
  IF jsonb_array_length(COALESCE(cart.items, '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'empty cart'; END IF;
  IF COALESCE(cart.customer_name, '') = '' THEN RAISE EXCEPTION 'missing customer name'; END IF;
  IF COALESCE(cart.delivery_address, '') = '' THEN RAISE EXCEPTION 'missing address'; END IF;
  IF COALESCE(cart.delivery_neighborhood, '') = '' THEN RAISE EXCEPTION 'missing neighborhood'; END IF;
  IF COALESCE(cart.payment_method, '') = '' THEN RAISE EXCEPTION 'missing payment method'; END IF;
  IF cart.subtotal < COALESCE(cfg.ordering_min_amount, 0) THEN RAISE EXCEPTION 'below minimum amount'; END IF;

  SELECT COALESCE(max(ticket_number), 0) + 1 INTO ticket FROM public.sales WHERE branch_id = bid;

  INSERT INTO public.sales (
    ticket_number, user_name, subtotal, total, payment_method, customer_name,
    notes, order_type, delivery_address, delivery_phone, delivery_fee, status,
    source, customer_phone, branch_id, delivery_neighborhood, payment_details,
    ai_review_status, ai_cart_id
  ) VALUES (
    ticket, 'Bot WhatsApp', cart.subtotal, cart.total,
    CASE WHEN cart.payment_method IN ('transfer', 'transferencia') THEN 'Transferencia' ELSE 'Efectivo' END,
    cart.customer_name,
    cart.delivery_notes,
    'delivery', cart.delivery_address, regexp_replace(COALESCE(_phone, ''), '\D', '', 'g'), cart.delivery_fee,
    'pending', 'whatsapp_bot', regexp_replace(COALESCE(_phone, ''), '\D', '', 'g'), bid,
    cart.delivery_neighborhood,
    jsonb_build_object('method', cart.payment_method, 'source', 'whatsapp_ai'),
    'pending_review', cart.id
  ) RETURNING id INTO sale_id;

  FOR item IN SELECT * FROM jsonb_array_elements(cart.items)
  LOOP
    resolved_pid := NULL;
    raw_name := COALESCE(item->>'product_name', item->>'name', 'Producto');
    normalized_name := public._whatsapp_normalize_text(raw_name);

    IF COALESCE(item->>'product_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT id INTO resolved_pid
      FROM public.products
      WHERE id = (item->>'product_id')::uuid
        AND active
        AND (branch_id = bid OR bid = ANY(COALESCE(available_branch_ids, ARRAY[]::uuid[])) OR branch_id IS NULL)
      LIMIT 1;
    END IF;

    IF resolved_pid IS NULL THEN
      SELECT p.id INTO resolved_pid
      FROM public.products p
      WHERE p.active
        AND (p.branch_id = bid OR bid = ANY(COALESCE(p.available_branch_ids, ARRAY[]::uuid[])) OR p.branch_id IS NULL)
        AND (
          public._whatsapp_normalize_text(p.name) = normalized_name
          OR public._whatsapp_normalize_text(p.name) LIKE normalized_name || '%'
          OR public._whatsapp_normalize_text(p.name) LIKE '%' || normalized_name || '%'
        )
      ORDER BY
        CASE
          WHEN public._whatsapp_normalize_text(p.name) = normalized_name THEN 0
          WHEN public._whatsapp_normalize_text(p.name) LIKE normalized_name || '%' THEN 1
          ELSE 2
        END,
        p.name
      LIMIT 1;
    END IF;

    INSERT INTO public.sale_items (
      sale_id, product_id, product_name, qty, unit_price, modifiers, subtotal, notes, branch_id
    ) VALUES (
      sale_id,
      resolved_pid,
      raw_name,
      COALESCE((item->>'qty')::numeric, 1),
      COALESCE((item->>'unit_price')::numeric, 0),
      COALESCE(item->'modifiers', '[]'::jsonb),
      (COALESCE((item->>'unit_price')::numeric, 0) + COALESCE((SELECT SUM((m->>'price')::numeric) FROM jsonb_array_elements(COALESCE(item->'modifiers','[]'::jsonb)) m), 0)) * COALESCE((item->>'qty')::numeric, 1),
      item->>'notes',
      bid
    );
  END LOOP;

  UPDATE public.whatsapp_ai_carts
  SET status = 'confirmed', posted_sale_id = sale_id, confirmed_at = now(), updated_at = now()
  WHERE id = cart.id;

  order_no := ticket::text;
  RETURN jsonb_build_object('sale_id', sale_id, 'order_number', order_no, 'ticket_number', ticket);
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_cart_confirm(text, text) TO anon, authenticated, service_role;