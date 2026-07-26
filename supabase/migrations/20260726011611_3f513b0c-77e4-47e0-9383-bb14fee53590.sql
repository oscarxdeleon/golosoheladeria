CREATE OR REPLACE FUNCTION public.whatsapp_bot_contact_key(_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v text := lower(btrim(coalesce(_raw, '')));
  digits text;
BEGIN
  IF v = '' THEN
    RETURN '';
  END IF;

  IF v ~ '@lid$' THEN
    RETURN 'lid:' || split_part(v, '@', 1);
  END IF;

  IF v ~ '@s\.whatsapp\.net$' THEN
    v := split_part(v, '@', 1);
  END IF;

  digits := regexp_replace(v, '[^0-9]', '', 'g');
  IF length(digits) = 10 THEN
    digits := '57' || digits;
  END IF;

  IF digits <> '' THEN
    RETURN digits;
  END IF;

  RETURN v;
END;
$$;

UPDATE public.whatsapp_ai_carts
SET status = 'expired', updated_at = now(), expires_at = coalesce(expires_at, now())
WHERE status = 'building'
  AND (
    updated_at < now() - interval '45 minutes'
    OR (jsonb_array_length(coalesce(items, '[]'::jsonb)) > 0 AND coalesce(customer_name, '') = '' AND updated_at < now() - interval '2 minutes')
  );

UPDATE public.whatsapp_outbound_queue
SET status = 'failed', last_error = coalesce(last_error, 'Destino anónimo antiguo sin JID completo; se descarta para evitar reintentos inválidos.')
WHERE status IN ('pending', 'sending')
  AND to_phone ~ '^[0-9]+$'
  AND to_phone !~ '^57[0-9]{10}$';

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_cart_get(_token text, _phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  bid uuid;
  cart_row public.whatsapp_ai_carts%ROWTYPE;
  v_key text;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RETURN NULL; END IF;
  v_key := public.whatsapp_bot_contact_key(_phone);

  SELECT * INTO cart_row
  FROM public.whatsapp_ai_carts
  WHERE branch_id = bid
    AND public.whatsapp_bot_contact_key(phone) = v_key
    AND status = 'building'
    AND coalesce(expires_at, updated_at + interval '45 minutes') > now()
  ORDER BY updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(cart_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_cart_cancel(_token text, _phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  bid uuid;
  v_key text;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RETURN false; END IF;
  v_key := public.whatsapp_bot_contact_key(_phone);

  UPDATE public.whatsapp_ai_carts
  SET status = 'rejected', updated_at = now()
  WHERE branch_id = bid
    AND public.whatsapp_bot_contact_key(phone) = v_key
    AND status = 'building';
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_cart_upsert(_token text, _phone text, _patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  bid uuid;
  cart_row public.whatsapp_ai_carts%ROWTYPE;
  new_items jsonb;
  new_subtotal numeric := 0;
  new_fee numeric;
  new_order_type text;
  v_key text;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;
  v_key := public.whatsapp_bot_contact_key(_phone);

  UPDATE public.whatsapp_ai_carts
  SET status = 'expired', updated_at = now()
  WHERE branch_id = bid
    AND public.whatsapp_bot_contact_key(phone) = v_key
    AND status = 'building'
    AND coalesce(expires_at, updated_at + interval '45 minutes') <= now();

  SELECT * INTO cart_row
  FROM public.whatsapp_ai_carts
  WHERE branch_id = bid
    AND public.whatsapp_bot_contact_key(phone) = v_key
    AND status = 'building'
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.whatsapp_ai_carts (branch_id, phone, expires_at)
    VALUES (bid, v_key, now() + interval '45 minutes')
    RETURNING * INTO cart_row;
  END IF;

  new_items := COALESCE(_patch->'items', cart_row.items, '[]'::jsonb);

  SELECT COALESCE(SUM(
    (COALESCE((item->>'unit_price')::numeric,0)
      + COALESCE((SELECT SUM((m->>'price')::numeric) FROM jsonb_array_elements(COALESCE(item->'modifiers','[]'::jsonb)) m),0)
    ) * COALESCE((item->>'qty')::numeric,1)
  ),0)
  INTO new_subtotal
  FROM jsonb_array_elements(new_items) item;

  new_order_type := lower(coalesce(_patch->>'order_type', cart_row.order_type, 'delivery'));
  IF new_order_type NOT IN ('delivery', 'pickup') THEN
    new_order_type := 'delivery';
  END IF;

  new_fee := CASE
    WHEN new_order_type = 'pickup' THEN 0
    WHEN _patch ? 'delivery_fee' AND coalesce(_patch->>'delivery_fee','') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (_patch->>'delivery_fee')::numeric
    ELSE coalesce(cart_row.delivery_fee, 0)
  END;

  UPDATE public.whatsapp_ai_carts SET
    phone = v_key,
    items = new_items,
    order_type = new_order_type,
    customer_name = COALESCE(NULLIF(_patch->>'customer_name', ''), cart_row.customer_name),
    delivery_address = COALESCE(NULLIF(_patch->>'delivery_address', ''), cart_row.delivery_address),
    delivery_neighborhood = COALESCE(NULLIF(_patch->>'delivery_neighborhood', ''), cart_row.delivery_neighborhood),
    delivery_notes = COALESCE(NULLIF(_patch->>'delivery_notes', ''), cart_row.delivery_notes),
    payment_method = COALESCE(NULLIF(_patch->>'payment_method', ''), cart_row.payment_method),
    delivery_fee = new_fee,
    subtotal = new_subtotal,
    total = new_subtotal + new_fee,
    expires_at = now() + interval '45 minutes',
    updated_at = now()
  WHERE id = cart_row.id
  RETURNING * INTO cart_row;

  RETURN to_jsonb(cart_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_cart_confirm(_token text, _phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  duplicate_sale public.sales%ROWTYPE;
  v_order_type text;
  v_phone text;
  v_key text;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;

  SELECT * INTO cfg FROM public.whatsapp_bot_config WHERE branch_id = bid;
  v_phone := regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');
  IF length(v_phone) = 10 THEN v_phone := '57' || v_phone; END IF;
  v_key := public.whatsapp_bot_contact_key(_phone);

  SELECT * INTO cart
  FROM public.whatsapp_ai_carts
  WHERE branch_id = bid
    AND public.whatsapp_bot_contact_key(phone) = v_key
    AND status = 'building'
    AND coalesce(expires_at, updated_at + interval '45 minutes') > now()
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'no active cart'; END IF;

  SELECT * INTO duplicate_sale
  FROM public.sales
  WHERE branch_id = bid
    AND source = 'whatsapp_bot'
    AND customer_phone = v_phone
    AND ai_cart_id = cart.id
    AND created_at > now() - interval '10 minutes'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('sale_id', duplicate_sale.id, 'order_number', duplicate_sale.ticket_number::text, 'ticket_number', duplicate_sale.ticket_number, 'duplicate_guard', true);
  END IF;

  SELECT count(*) INTO recent_count
  FROM public.sales
  WHERE branch_id = bid
    AND source = 'whatsapp_bot'
    AND customer_phone = v_phone
    AND created_at::date = CURRENT_DATE;

  IF recent_count >= COALESCE(cfg.ordering_daily_limit_per_phone, 3) THEN
    RAISE EXCEPTION 'daily order limit exceeded';
  END IF;

  v_order_type := lower(coalesce(cart.order_type, 'delivery'));
  IF v_order_type NOT IN ('delivery', 'pickup') THEN v_order_type := 'delivery'; END IF;

  IF jsonb_array_length(COALESCE(cart.items, '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'empty cart'; END IF;
  IF COALESCE(cart.customer_name, '') = '' THEN RAISE EXCEPTION 'missing customer name'; END IF;
  IF v_order_type = 'delivery' AND COALESCE(cart.delivery_address, '') = '' THEN RAISE EXCEPTION 'missing address'; END IF;
  IF v_order_type = 'delivery' AND COALESCE(cart.delivery_neighborhood, '') = '' THEN RAISE EXCEPTION 'missing neighborhood'; END IF;
  IF COALESCE(cart.payment_method, '') = '' THEN RAISE EXCEPTION 'missing payment method'; END IF;
  IF cart.subtotal < COALESCE(cfg.ordering_min_amount, 0) THEN RAISE EXCEPTION 'below minimum amount'; END IF;

  SELECT COALESCE(max(ticket_number), 0) + 1 INTO ticket FROM public.sales WHERE branch_id = bid;

  INSERT INTO public.sales (
    ticket_number, user_name, subtotal, total, payment_method, customer_name,
    notes, order_type, delivery_address, delivery_phone, delivery_fee, status,
    source, customer_phone, branch_id, delivery_neighborhood, payment_details,
    ai_review_status, ai_cart_id
  ) VALUES (
    ticket,
    'Bot WhatsApp',
    cart.subtotal,
    CASE WHEN v_order_type = 'pickup' THEN cart.subtotal ELSE cart.total END,
    CASE WHEN cart.payment_method IN ('transfer', 'transferencia') THEN 'Transferencia' ELSE 'Efectivo' END,
    cart.customer_name,
    cart.delivery_notes,
    v_order_type,
    CASE WHEN v_order_type = 'delivery' THEN cart.delivery_address ELSE NULL END,
    v_phone,
    CASE WHEN v_order_type = 'pickup' THEN 0 ELSE cart.delivery_fee END,
    'pending',
    'whatsapp_bot',
    v_phone,
    bid,
    CASE WHEN v_order_type = 'delivery' THEN cart.delivery_neighborhood ELSE NULL END,
    jsonb_build_object('method', cart.payment_method, 'source', 'whatsapp_ai', 'order_type', v_order_type),
    'pending_review',
    cart.id
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
        AND active = true
        AND (available_branch_ids IS NULL OR cardinality(available_branch_ids) = 0 OR bid = ANY(available_branch_ids))
      LIMIT 1;
    END IF;

    IF resolved_pid IS NULL THEN
      SELECT p.id INTO resolved_pid
      FROM public.products p
      WHERE p.active = true
        AND (p.available_branch_ids IS NULL OR cardinality(p.available_branch_ids) = 0 OR bid = ANY(p.available_branch_ids))
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
  RETURN jsonb_build_object('sale_id', sale_id, 'order_number', order_no, 'ticket_number', ticket, 'order_type', v_order_type);
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_history(_token text, _phone text, _limit integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _branch uuid;
  _key text;
  _rows jsonb;
BEGIN
  SELECT branch_id INTO _branch
  FROM public.whatsapp_bot_config
  WHERE device_token = _token;

  IF _branch IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  _key := public.whatsapp_bot_contact_key(_phone);

  SELECT coalesce(jsonb_agg(jsonb_build_object('role', role, 'content', content) ORDER BY created_at ASC), '[]'::jsonb)
    INTO _rows
  FROM (
    SELECT role, content, created_at
    FROM public.whatsapp_ai_messages
    WHERE branch_id = _branch
      AND public.whatsapp_bot_contact_key(phone) = _key
      AND created_at > now() - interval '45 minutes'
    ORDER BY created_at DESC
    LIMIT greatest(1, least(_limit, 30))
  ) t;

  RETURN jsonb_build_object('messages', _rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_save_message(_token text, _phone text, _role text, _content text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _branch uuid;
  _key text;
BEGIN
  SELECT branch_id INTO _branch
  FROM public.whatsapp_bot_config
  WHERE device_token = _token;

  IF _branch IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  IF _role NOT IN ('user','assistant') THEN
    RETURN jsonb_build_object('error', 'invalid_role');
  END IF;

  IF _content IS NULL OR length(trim(_content)) = 0 THEN
    RETURN jsonb_build_object('error', 'empty_content');
  END IF;

  _key := public.whatsapp_bot_contact_key(_phone);

  INSERT INTO public.whatsapp_ai_messages (branch_id, phone, role, content)
  VALUES (_branch, _key, _role, left(_content, 4000));

  DELETE FROM public.whatsapp_ai_messages
  WHERE branch_id = _branch
    AND public.whatsapp_bot_contact_key(phone) = _key
    AND created_at < now() - interval '24 hours';

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_enqueue_reply(_token text, _to text, _body text, _purpose text DEFAULT 'chatbot_reply'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_branch_id uuid;
  v_to text;
  v_raw_to text;
  v_digits text;
  v_body text;
  v_purpose text;
  v_existing_id uuid;
  v_id uuid;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) < 16 THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  v_branch_id := public.whatsapp_bot_resolve_branch_id(_token);
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  v_raw_to := lower(btrim(coalesce(_to, '')));
  IF v_raw_to ~ '^[^[:space:]@]+@(lid|s\.whatsapp\.net)$' THEN
    v_to := v_raw_to;
  ELSE
    v_digits := regexp_replace(coalesce(_to, ''), '[^0-9]', '', 'g');
    IF length(v_digits) = 10 THEN
      v_digits := '57' || v_digits;
    END IF;
    v_to := v_digits;
  END IF;

  v_body := left(btrim(coalesce(_body, '')), 3900);
  v_purpose := left(coalesce(nullif(btrim(_purpose), ''), 'chatbot_reply'), 80);

  IF v_to = '' OR (v_to !~ '@lid$' AND v_to !~ '@s\.whatsapp\.net$' AND v_to !~ '^57[0-9]{10}$') THEN
    RETURN jsonb_build_object('error', 'invalid_phone');
  END IF;

  IF v_body = '' THEN
    RETURN jsonb_build_object('error', 'empty_body');
  END IF;

  SELECT id INTO v_existing_id
  FROM public.whatsapp_outbound_queue
  WHERE branch_id = v_branch_id
    AND to_phone = v_to
    AND body = v_body
    AND purpose = v_purpose
    AND status IN ('pending', 'sending')
    AND created_at > now() - interval '45 seconds'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'queued', true, 'deduped', true, 'id', v_existing_id, 'to', v_to);
  END IF;

  INSERT INTO public.whatsapp_outbound_queue(branch_id, to_phone, body, purpose, status)
  VALUES (v_branch_id, v_to, v_body, v_purpose, 'pending')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'queued', true, 'deduped', false, 'id', v_id, 'to', v_to);
END;
$$;