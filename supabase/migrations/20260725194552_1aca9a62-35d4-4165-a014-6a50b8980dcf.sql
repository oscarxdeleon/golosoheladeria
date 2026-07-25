ALTER TABLE public.whatsapp_ai_carts
ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'delivery';

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_search_products(_token text, _query text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  bid uuid;
  q text;
  q_words text[];
  result jsonb;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  q := public._whatsapp_normalize_text(_query);
  q_words := regexp_split_to_array(trim(q), '\s+');

  WITH candidates AS (
    SELECT
      p.id,
      p.name,
      p.price,
      c.name AS category,
      coalesce(p.is_favorite, false) AS is_favorite,
      COALESCE(p.modifier_group_ids, ARRAY[]::uuid[]) AS modifier_group_ids,
      public._whatsapp_normalize_text(p.name || ' ' || COALESCE(c.name, '')) AS haystack
    FROM public.products p
    LEFT JOIN public.categories c ON c.id = p.category_id
    WHERE p.active = true
      AND coalesce(p.show_in_online, true) = true
      AND NOT (COALESCE(p.is_linked, false) = true AND p.source_product_id IS NOT NULL)
      AND (
        p.available_branch_ids IS NULL
        OR cardinality(p.available_branch_ids) = 0
        OR bid = ANY(p.available_branch_ids)
      )
  ), scored AS (
    SELECT *,
      CASE
        WHEN q = '' THEN 1
        WHEN haystack = q THEN 100
        WHEN haystack LIKE q || '%' THEN 80
        WHEN haystack LIKE '%' || q || '%' THEN 60
        ELSE COALESCE((
          SELECT SUM(CASE WHEN haystack LIKE '%' || w || '%' THEN 12 ELSE 0 END)
          FROM unnest(q_words) AS w
          WHERE length(w) >= 3
        ), 0)
      END + CASE WHEN is_favorite THEN 5 ELSE 0 END AS score
    FROM candidates
  ), picked AS (
    SELECT *
    FROM scored
    WHERE score > 0
    ORDER BY score DESC, name
    LIMIT 12
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'name', name,
    'price', price,
    'category', category,
    'is_favorite', is_favorite,
    'modifier_group_ids', modifier_group_ids
  ) ORDER BY score DESC, name), '[]'::jsonb)
  INTO result
  FROM picked;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_get_modifiers(_token text, _product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  bid uuid;
  result jsonb;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'group_id', g.id,
    'group_name', g.name,
    'required', g.required,
    'min_select', g.min_select,
    'max_select', g.max_select,
    'options', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'price', m.price) ORDER BY m.name), '[]'::jsonb)
      FROM public.modifiers m
      WHERE m.group_id = g.id
        AND m.active = true
        AND (m.branch_id IS NULL OR m.branch_id = bid OR m.branch_id = g.branch_id)
        AND (m.disabled_branch_ids IS NULL OR NOT (bid = ANY(m.disabled_branch_ids)))
    )
  ) ORDER BY g.name), '[]'::jsonb)
  INTO result
  FROM public.modifier_groups g
  JOIN public.products p ON g.id = ANY(COALESCE(p.modifier_group_ids, ARRAY[]::uuid[]))
  WHERE p.id = _product_id
    AND p.active = true
    AND (
      p.available_branch_ids IS NULL
      OR cardinality(p.available_branch_ids) = 0
      OR bid = ANY(p.available_branch_ids)
    );

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_cart_upsert(_token text, _phone text, _patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  bid uuid;
  cart_row public.whatsapp_ai_carts%ROWTYPE;
  new_items jsonb;
  new_subtotal numeric := 0;
  new_fee numeric;
  new_order_type text;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;

  SELECT * INTO cart_row
  FROM public.whatsapp_ai_carts
  WHERE branch_id = bid AND phone = _phone AND status = 'building'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.whatsapp_ai_carts (branch_id, phone)
    VALUES (bid, _phone)
    RETURNING * INTO cart_row;
  END IF;

  new_items := COALESCE(_patch->'items', cart_row.items);

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
    updated_at = now()
  WHERE id = cart_row.id
  RETURNING * INTO cart_row;

  RETURN to_jsonb(cart_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_cart_confirm(_token text, _phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_order_type text;
  v_phone text;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;

  SELECT * INTO cfg FROM public.whatsapp_bot_config WHERE branch_id = bid;
  v_phone := regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');

  SELECT count(*) INTO recent_count
  FROM public.sales
  WHERE branch_id = bid
    AND source = 'whatsapp_bot'
    AND customer_phone = v_phone
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

    IF COALESCE(item->>'product_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT id INTO resolved_pid
      FROM public.products
      WHERE id = (item->>'product_id')::uuid
        AND active = true
        AND (
          available_branch_ids IS NULL
          OR cardinality(available_branch_ids) = 0
          OR bid = ANY(available_branch_ids)
        )
      LIMIT 1;
    END IF;

    IF resolved_pid IS NULL THEN
      SELECT p.id INTO resolved_pid
      FROM public.products p
      WHERE p.active = true
        AND (
          p.available_branch_ids IS NULL
          OR cardinality(p.available_branch_ids) = 0
          OR bid = ANY(p.available_branch_ids)
        )
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
$function$;