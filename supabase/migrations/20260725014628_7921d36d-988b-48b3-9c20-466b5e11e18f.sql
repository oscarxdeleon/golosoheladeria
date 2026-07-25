CREATE OR REPLACE FUNCTION public._whatsapp_normalize_text(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(
    translate(lower(coalesce(_value, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
    '[^a-z0-9]+',
    ' ',
    'g'
  )
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_context(_token text, _phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg public.whatsapp_bot_config%ROWTYPE;
  b public.branches%ROWTYPE;
  today_count int := 0;
  limit_count int := 20;
  allowed_sandbox boolean := false;
  ordering_on boolean := false;
  result jsonb;
BEGIN
  SELECT * INTO cfg
  FROM public.whatsapp_bot_config
  WHERE device_token = _token;

  IF NOT FOUND OR NOT cfg.enabled THEN
    RETURN jsonb_build_object('error', 'bot_disabled');
  END IF;

  IF NOT COALESCE(cfg.ai_enabled, false) THEN
    RETURN jsonb_build_object('error', 'ai_disabled');
  END IF;

  ordering_on := COALESCE(cfg.ai_ordering_enabled, false);
  allowed_sandbox := COALESCE(array_length(cfg.ai_sandbox_numbers, 1), 0) = 0
    OR regexp_replace(COALESCE(_phone, ''), '\D', '', 'g') = ANY(cfg.ai_sandbox_numbers);

  IF NOT allowed_sandbox AND NOT ordering_on THEN
    RETURN jsonb_build_object('error', 'not_in_sandbox');
  END IF;

  SELECT * INTO b FROM public.branches WHERE id = cfg.branch_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'branch_not_found');
  END IF;

  limit_count := COALESCE(cfg.ai_daily_limit_per_phone, cfg.ordering_daily_limit_per_phone, 20);
  SELECT COALESCE(reply_count, 0) INTO today_count
  FROM public.whatsapp_ai_usage
  WHERE branch_id = cfg.branch_id
    AND phone = regexp_replace(COALESCE(_phone, ''), '\D', '', 'g')
    AND usage_date = CURRENT_DATE;

  IF COALESCE(today_count, 0) >= limit_count THEN
    RETURN jsonb_build_object('error', 'rate_limited', 'usage_today', today_count, 'daily_limit', limit_count);
  END IF;

  SELECT jsonb_build_object(
    'branch_id', cfg.branch_id,
    'branch_name', b.name,
    'menu_link', COALESCE(b.online_menu_url, (SELECT menu_link FROM public.settings LIMIT 1), 'https://golosoheladeria.lovable.app/menu'),
    'online_open', true,
    'physical_open', true,
    'system_prompt', cfg.ai_system_prompt,
    'usage_today', COALESCE(today_count, 0),
    'daily_limit', limit_count,
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'price', p.price,
        'category', c.name,
        'is_favorite', p.is_favorite,
        'modifier_group_ids', COALESCE(p.modifier_group_ids, ARRAY[]::uuid[])
      ) ORDER BY p.is_favorite DESC, c.sort_order, p.name)
      FROM public.products p
      LEFT JOIN public.categories c ON c.id = p.category_id
      WHERE p.active
        AND p.show_in_online
        AND (
          p.branch_id = cfg.branch_id
          OR cfg.branch_id = ANY(COALESCE(p.available_branch_ids, ARRAY[]::uuid[]))
          OR (p.branch_id IS NULL AND p.source_product_id IS NULL)
        )
    ), '[]'::jsonb),
    'faqs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('q', question, 'a', answer) ORDER BY sort_order, created_at)
      FROM public.whatsapp_bot_faqs
      WHERE active AND (branch_id = cfg.branch_id OR branch_id IS NULL)
    ), '[]'::jsonb),
    'flavor_groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'group_name', g.name,
        'flavors', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('name', m.name, 'extra_price', m.price) ORDER BY m.name)
          FROM public.modifiers m
          WHERE m.group_id = g.id
            AND m.active
            AND NOT (cfg.branch_id = ANY(COALESCE(m.disabled_branch_ids, ARRAY[]::uuid[])))
        ), '[]'::jsonb)
      ) ORDER BY g.name)
      FROM public.modifier_groups g
      WHERE g.branch_id = cfg.branch_id
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public._whatsapp_normalize_text(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_context(text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_search_products(_token text, _query text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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
      p.is_favorite,
      COALESCE(p.modifier_group_ids, ARRAY[]::uuid[]) AS modifier_group_ids,
      public._whatsapp_normalize_text(p.name || ' ' || COALESCE(c.name, '')) AS haystack
    FROM public.products p
    LEFT JOIN public.categories c ON c.id = p.category_id
    WHERE p.active
      AND p.show_in_online
      AND (
        p.branch_id = bid
        OR bid = ANY(COALESCE(p.available_branch_ids, ARRAY[]::uuid[]))
        OR (p.branch_id IS NULL AND p.source_product_id IS NULL)
      )
  ), scored AS (
    SELECT *,
      CASE
        WHEN q = '' THEN 0
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
  FROM scored
  WHERE score > 0 OR q = ''
  LIMIT 12;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_search_products(text, text) TO anon, authenticated, service_role;

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

    IF COALESCE(item->>'product_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
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
      ORDER BY
        CASE
          WHEN public._whatsapp_normalize_text(p.name) = normalized_name THEN 0
          WHEN public._whatsapp_normalize_text(p.name) LIKE normalized_name || '%' THEN 1
          WHEN public._whatsapp_normalize_text(p.name) LIKE '%' || normalized_name || '%' THEN 2
          ELSE 3
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