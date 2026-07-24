CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_cart_confirm(_token text, _phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bid uuid; cart_row public.whatsapp_ai_carts%ROWTYPE; cfg public.whatsapp_bot_config%ROWTYPE;
  new_sale_id uuid; new_ticket integer; item jsonb; today_count integer;
  resolved_pid uuid; raw_pid text; raw_name text;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;
  SELECT * INTO cfg FROM public.whatsapp_bot_config WHERE branch_id = bid;
  SELECT COUNT(*) INTO today_count FROM public.sales
  WHERE branch_id = bid AND customer_phone = _phone AND source = 'whatsapp_bot'
    AND created_at > (now() - interval '24 hours');
  IF today_count >= COALESCE(cfg.ordering_daily_limit_per_phone, 3) THEN
    RAISE EXCEPTION 'daily order limit exceeded';
  END IF;
  SELECT * INTO cart_row FROM public.whatsapp_ai_carts
  WHERE branch_id = bid AND phone = _phone AND status = 'building'
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no active cart'; END IF;
  IF jsonb_array_length(cart_row.items) = 0 THEN RAISE EXCEPTION 'empty cart'; END IF;
  IF cart_row.delivery_address IS NULL OR cart_row.delivery_address = '' THEN RAISE EXCEPTION 'missing address'; END IF;
  IF cart_row.payment_method IS NULL THEN RAISE EXCEPTION 'missing payment method'; END IF;
  IF cart_row.subtotal < COALESCE(cfg.ordering_min_amount, 0) THEN RAISE EXCEPTION 'below minimum amount'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.sales WHERE branch_id = bid AND customer_phone = _phone
      AND source = 'whatsapp_bot' AND created_at > now() - interval '60 seconds'
  ) THEN RAISE EXCEPTION 'duplicate order (60s cooldown)'; END IF;
  INSERT INTO public.sales (
    branch_id, subtotal, total, payment_method, customer_name, customer_phone,
    order_type, delivery_address, delivery_neighborhood, delivery_fee,
    status, source, ai_review_status, ai_cart_id, notes
  ) VALUES (
    bid, cart_row.subtotal, cart_row.total, cart_row.payment_method,
    cart_row.customer_name, cart_row.phone, 'domicilio',
    cart_row.delivery_address, cart_row.delivery_neighborhood, cart_row.delivery_fee,
    'pending', 'whatsapp_bot', 'pending_review', cart_row.id, cart_row.delivery_notes
  ) RETURNING id, ticket_number INTO new_sale_id, new_ticket;
  FOR item IN SELECT * FROM jsonb_array_elements(cart_row.items) LOOP
    raw_pid := NULLIF(item->>'product_id','');
    raw_name := NULLIF(item->>'product_name','');
    resolved_pid := NULL;
    IF raw_pid IS NOT NULL AND raw_pid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      resolved_pid := raw_pid::uuid;
    END IF;
    IF resolved_pid IS NULL AND raw_name IS NOT NULL THEN
      SELECT p.id INTO resolved_pid
      FROM public.products p
      WHERE p.active
        AND lower(p.name) = lower(raw_name)
        AND (
          p.available_branch_ids IS NULL
          OR array_length(p.available_branch_ids, 1) IS NULL
          OR bid = ANY(p.available_branch_ids)
        )
      ORDER BY (bid = ANY(COALESCE(p.available_branch_ids, ARRAY[]::uuid[]))) DESC
      LIMIT 1;
    END IF;
    INSERT INTO public.sale_items (
      sale_id, product_id, product_name, qty, unit_price, modifiers, subtotal, branch_id, notes
    ) VALUES (
      new_sale_id,
      resolved_pid,
      COALESCE(raw_name, 'Producto'),
      COALESCE((item->>'qty')::numeric, 1),
      COALESCE((item->>'unit_price')::numeric, 0),
      COALESCE(item->'modifiers', '[]'::jsonb),
      (COALESCE((item->>'unit_price')::numeric,0)
        + COALESCE((SELECT SUM((m->>'price')::numeric) FROM jsonb_array_elements(COALESCE(item->'modifiers','[]'::jsonb)) m),0)
      ) * COALESCE((item->>'qty')::numeric,1),
      bid, item->>'notes'
    );
  END LOOP;
  UPDATE public.whatsapp_ai_carts
  SET status = 'posted', posted_sale_id = new_sale_id, confirmed_at = now()
  WHERE id = cart_row.id;
  RETURN jsonb_build_object('sale_id', new_sale_id, 'ticket_number', new_ticket, 'total', cart_row.total);
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_cart_confirm(text, text) TO anon, authenticated;