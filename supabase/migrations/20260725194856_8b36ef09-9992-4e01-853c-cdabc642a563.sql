CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_context(_token text, _phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_cfg public.whatsapp_bot_config%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_phone_clean text;
  v_authorized boolean := false;
  v_usage_today int := 0;
  v_max_per_day int := 20;
  v_sandbox_empty boolean := true;
  v_menu_link text;
  v_products jsonb := '[]'::jsonb;
  v_faqs jsonb := '[]'::jsonb;
  v_flavor_groups jsonb := '[]'::jsonb;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  v_branch_id := public.whatsapp_bot_resolve_branch_id(_token);
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  SELECT * INTO v_cfg FROM public.whatsapp_bot_config WHERE branch_id = v_branch_id;
  SELECT * INTO v_branch FROM public.branches WHERE id = v_branch_id;

  IF NOT v_cfg.ai_enabled THEN
    RETURN jsonb_build_object('error','ai_disabled');
  END IF;

  v_phone_clean := regexp_replace(coalesce(_phone,''), '[^0-9]', '', 'g');
  v_sandbox_empty := v_cfg.ai_sandbox_numbers IS NULL
                    OR array_length(v_cfg.ai_sandbox_numbers, 1) IS NULL
                    OR array_length(v_cfg.ai_sandbox_numbers, 1) = 0;

  IF coalesce(v_cfg.ai_ordering_enabled, false) THEN
    v_authorized := true;
  ELSIF v_sandbox_empty THEN
    v_authorized := true;
  ELSE
    SELECT true INTO v_authorized
    FROM unnest(v_cfg.ai_sandbox_numbers) AS n
    WHERE regexp_replace(n, '[^0-9]', '', 'g') = v_phone_clean
       OR right(regexp_replace(n, '[^0-9]', '', 'g'), 10) = right(v_phone_clean, 10)
    LIMIT 1;
    v_authorized := coalesce(v_authorized, false);
  END IF;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;

  SELECT reply_count INTO v_usage_today
  FROM public.whatsapp_ai_usage
  WHERE branch_id = v_branch_id
    AND phone = v_phone_clean
    AND usage_date = current_date;

  v_max_per_day := coalesce(v_cfg.ai_daily_limit_per_phone, 20);
  IF coalesce(v_usage_today, 0) >= v_max_per_day THEN
    RETURN jsonb_build_object('error','rate_limited');
  END IF;

  v_menu_link := coalesce(nullif(v_branch.online_menu_url, ''), 'https://golosoheladeria.vercel.app/menu?sede=' || coalesce(v_branch.slug,''));
  v_menu_link := replace(v_menu_link, 'https://golosoheladeria.lovable.app', 'https://golosoheladeria.vercel.app');
  v_menu_link := replace(v_menu_link, 'https://id-preview--d41c5d74-9f9e-4922-8c68-3a56b9c32d17.lovable.app', 'https://golosoheladeria.vercel.app');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'name', p.name,
           'price', p.price,
           'category', c.name,
           'is_favorite', coalesce(p.is_favorite, false),
           'modifier_group_ids', coalesce(to_jsonb(p.modifier_group_ids), '[]'::jsonb)
         ) ORDER BY coalesce(p.is_favorite, false) DESC, c.sort_order NULLS LAST, p.name), '[]'::jsonb)
  INTO v_products
  FROM public.products p
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE p.active = true
    AND coalesce(p.show_in_online, true) = true
    AND NOT (COALESCE(p.is_linked, false) = true AND p.source_product_id IS NOT NULL)
    AND (p.available_branch_ids IS NULL OR cardinality(p.available_branch_ids) = 0 OR v_branch_id = ANY(p.available_branch_ids));

  SELECT coalesce(jsonb_agg(jsonb_build_object('q', question, 'a', answer) ORDER BY sort_order, created_at), '[]'::jsonb)
  INTO v_faqs
  FROM public.whatsapp_bot_faqs
  WHERE branch_id = v_branch_id
    AND active = true;

  SELECT coalesce(jsonb_agg(group_payload ORDER BY group_name), '[]'::jsonb)
  INTO v_flavor_groups
  FROM (
    SELECT
      mg.name AS group_name,
      jsonb_build_object(
        'group_name', mg.name,
        'flavors', coalesce(jsonb_agg(jsonb_build_object('name', m.name, 'extra_price', m.price) ORDER BY m.name) FILTER (WHERE m.id IS NOT NULL), '[]'::jsonb)
      ) AS group_payload
    FROM public.modifier_groups mg
    JOIN public.modifiers m ON m.group_id = mg.id AND m.active = true
    WHERE (mg.branch_id IS NULL OR mg.branch_id = v_branch_id)
      AND (m.branch_id IS NULL OR m.branch_id = v_branch_id OR m.branch_id = mg.branch_id)
      AND (m.disabled_branch_ids IS NULL OR NOT (v_branch_id = ANY(m.disabled_branch_ids)))
      AND lower(mg.name) ~ '(sabor|sabores|helado|jugo|malteada)'
    GROUP BY mg.id, mg.name
  ) s;

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch_id,
    'branch_name', coalesce(v_branch.name, 'Heladería Goloso'),
    'menu_link', v_menu_link,
    'system_prompt', v_cfg.ai_system_prompt,
    'ordering_enabled', coalesce(v_cfg.ai_ordering_enabled, false),
    'dry_run', coalesce(v_cfg.ai_dry_run, false),
    'online_open', public.whatsapp_bot_is_online_open(v_branch_id),
    'physical_open', public.whatsapp_bot_is_physical_open(v_branch_id),
    'usage_today', coalesce(v_usage_today, 0),
    'daily_limit', v_max_per_day,
    'products', v_products,
    'faqs', v_faqs,
    'flavor_groups', v_flavor_groups
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_handle_incoming(_token text, _from text, _body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_cfg public.whatsapp_bot_config%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_normalized text;
  v_trigger text;
  v_matched_trigger text;
  v_should_menu boolean := false;
  v_is_short boolean := false;
  v_is_greeting boolean := false;
  v_is_order_intent boolean := false;
  v_greeting text;
  v_menu_link text;
  v_menu_msg text;
  v_reply text := '';
  v_idx int;
  v_last_idx int;
  v_len int;
  v_online_open boolean;
  v_physical_open boolean;
  v_after text;
  v_cooldown interval;
  v_last_any timestamptz;
  v_from_clean text;
  v_now timestamptz := now();
  v_phone_digits text;
  v_ai_authorized boolean := false;
  v_sandbox_empty boolean := true;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  v_from_clean := btrim(coalesce(_from,''));
  IF v_from_clean = ''
     OR v_from_clean ILIKE 'status%'
     OR v_from_clean ILIKE '%@broadcast'
     OR v_from_clean ILIKE '%@g.us'
     OR v_from_clean ILIKE '%@newsletter'
     OR v_from_clean !~ '^[0-9]{6,}$' THEN
    RETURN jsonb_build_object('reply', null, 'ignored', true);
  END IF;

  v_branch_id := public.whatsapp_bot_resolve_branch_id(_token);
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  SELECT * INTO v_cfg FROM public.whatsapp_bot_config WHERE branch_id = v_branch_id;
  UPDATE public.whatsapp_bot_config SET last_seen_at = v_now WHERE branch_id = v_cfg.branch_id;

  IF NOT v_cfg.enabled THEN
    INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body)
    VALUES (v_cfg.branch_id, _from, 'in', _body);
    RETURN jsonb_build_object('reply', null);
  END IF;

  SELECT * INTO v_branch FROM public.branches WHERE id = v_cfg.branch_id;

  INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body)
  VALUES (v_cfg.branch_id, _from, 'in', _body);

  v_menu_link := coalesce(nullif(v_branch.online_menu_url, ''), 'https://golosoheladeria.vercel.app/menu?sede=' || coalesce(v_branch.slug,''));
  v_menu_link := replace(v_menu_link, 'https://golosoheladeria.lovable.app', 'https://golosoheladeria.vercel.app');
  v_menu_link := replace(v_menu_link, 'https://id-preview--d41c5d74-9f9e-4922-8c68-3a56b9c32d17.lovable.app', 'https://golosoheladeria.vercel.app');

  v_normalized := lower(btrim(coalesce(_body,'')));
  v_normalized := translate(v_normalized, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN');
  v_normalized := regexp_replace(v_normalized, '[¿?¡!.,;:()"'']+', '', 'g');
  v_normalized := regexp_replace(v_normalized, '\s+', ' ', 'g');
  v_normalized := btrim(v_normalized);

  v_is_greeting := v_normalized ~ '^(hola+|holi|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|saludos|que tal|hi|hello)$';
  v_is_order_intent := v_normalized ~ '\m(quiero|dame|deme|necesito|pideme|pedir|pedido|ordenar|comprar|agrega|anota|mandame|enviame|domicilio|recoger|recojo|banana|split|ensalada|brownie|helado|malteada|jugo|copa|cono|vaso|litro|waffle|cholado|fresas|frutas)\M';

  IF v_cfg.short_reply_words IS NOT NULL AND array_length(v_cfg.short_reply_words,1) > 0 THEN
    IF v_normalized = ANY(v_cfg.short_reply_words) THEN
      v_is_short := true;
    END IF;
  END IF;

  v_cooldown := make_interval(hours => greatest(coalesce(v_cfg.greet_cooldown_hours, 24), 1));

  INSERT INTO public.whatsapp_bot_greeted(branch_id, phone, greeted_date, last_greeted_at, last_msg_idx)
  VALUES (v_cfg.branch_id, _from, current_date, 'epoch'::timestamptz, NULL)
  ON CONFLICT (branch_id, phone) DO NOTHING;

  SELECT greatest(
           coalesce(last_greeted_at, 'epoch'::timestamptz),
           coalesce(last_menu_at, 'epoch'::timestamptz),
           coalesce(last_after_hours_at, 'epoch'::timestamptz)
         ),
         last_msg_idx
  INTO v_last_any, v_last_idx
  FROM public.whatsapp_bot_greeted
  WHERE branch_id = v_cfg.branch_id AND phone = _from
  FOR UPDATE;

  v_phone_digits := regexp_replace(_from, '[^0-9]', '', 'g');
  IF v_cfg.ai_enabled THEN
    v_sandbox_empty := v_cfg.ai_sandbox_numbers IS NULL
                      OR array_length(v_cfg.ai_sandbox_numbers, 1) IS NULL
                      OR array_length(v_cfg.ai_sandbox_numbers, 1) = 0;
    IF coalesce(v_cfg.ai_ordering_enabled, false) THEN
      v_ai_authorized := true;
    ELSIF v_sandbox_empty THEN
      v_ai_authorized := true;
    ELSE
      SELECT true INTO v_ai_authorized
      FROM unnest(v_cfg.ai_sandbox_numbers) AS n
      WHERE regexp_replace(n, '[^0-9]', '', 'g') = v_phone_digits
         OR right(regexp_replace(n, '[^0-9]', '', 'g'), 10) = right(v_phone_digits, 10)
      LIMIT 1;
      v_ai_authorized := coalesce(v_ai_authorized, false);
    END IF;
  END IF;

  IF v_is_order_intent THEN
    IF v_ai_authorized THEN
      RETURN jsonb_build_object('reply', null, 'use_ai', true, 'source', 'order_intent');
    END IF;
    v_reply := '¡Hola! Soy Golosito, tu asistente de Heladería Goloso. 🍦' || E'\n\n' ||
               'Por ahora te comparto el menú con fotos y precios 👉 ' || v_menu_link || E'\n\n' ||
               'Si quieres pedir, dime producto, cantidad, nombre, dirección/barrio y forma de pago.';
    INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
    VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'order_intent_safe');
    RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'order_intent_safe', 'source', 'fixed_safe');
  END IF;

  IF v_last_any IS NOT NULL AND v_last_any > v_now - v_cooldown THEN
    IF v_ai_authorized AND NOT v_is_greeting THEN
      RETURN jsonb_build_object('reply', null, 'use_ai', true, 'source', 'cooldown_ai');
    END IF;
    IF v_is_greeting THEN
      v_reply := '¡Hola! Soy Golosito, tu asistente de Heladería Goloso. 🍦' || E'\n\n' ||
                 'Te comparto el menú con fotos y precios 👉 ' || v_menu_link || E'\n\n' ||
                 'Dime qué producto te provoca y con gusto te ayudo.';
      INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
      VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'welcome_cooldown_safe');
      RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'welcome_cooldown_safe', 'source', 'fixed_safe');
    END IF;
    RETURN jsonb_build_object('reply', null, 'skipped', 'cooldown');
  END IF;

  v_online_open   := public.whatsapp_bot_is_online_open(v_cfg.branch_id);
  v_physical_open := public.whatsapp_bot_is_physical_open(v_cfg.branch_id);

  IF NOT v_online_open AND v_physical_open AND v_cfg.pickup_after_hours_enabled THEN
    v_len := coalesce(array_length(v_cfg.pickup_after_hours_messages,1),0);
    IF v_len > 0 THEN
      IF v_len = 1 THEN v_idx := 1;
      ELSE
        v_idx := 1 + floor(random() * v_len)::int;
        IF v_last_idx IS NOT NULL AND v_idx = v_last_idx THEN
          v_idx := 1 + (v_idx % v_len);
        END IF;
      END IF;
      v_after := replace(v_cfg.pickup_after_hours_messages[v_idx], '{menu_link}', v_menu_link);
      v_reply := v_after;
      INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
      VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'pickup_after_hours');
      UPDATE public.whatsapp_bot_greeted
         SET last_greeted_at = v_now, last_after_hours_at = v_now, last_menu_at = v_now,
             last_msg_idx = v_idx, greeted_date = current_date
       WHERE branch_id = v_cfg.branch_id AND phone = _from;
      RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'pickup_after_hours');
    END IF;
    IF v_ai_authorized THEN RETURN jsonb_build_object('reply', null, 'use_ai', true, 'source', 'pickup_after_hours_ai'); END IF;
    RETURN jsonb_build_object('reply', null);
  END IF;

  IF v_cfg.after_hours_enabled AND NOT v_online_open AND NOT v_physical_open THEN
    v_len := coalesce(array_length(v_cfg.after_hours_messages,1),0);
    IF v_len > 0 THEN
      IF v_len = 1 THEN v_idx := 1;
      ELSE
        v_idx := 1 + floor(random() * v_len)::int;
        IF v_last_idx IS NOT NULL AND v_idx = v_last_idx THEN
          v_idx := 1 + (v_idx % v_len);
        END IF;
      END IF;
      v_after := replace(v_cfg.after_hours_messages[v_idx], '{menu_link}', v_menu_link);
      v_reply := v_after;
      INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
      VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'after_hours');
      UPDATE public.whatsapp_bot_greeted
         SET last_greeted_at = v_now, last_after_hours_at = v_now, last_menu_at = v_now,
             last_msg_idx = v_idx, greeted_date = current_date
       WHERE branch_id = v_cfg.branch_id AND phone = _from;
      RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'after_hours');
    END IF;
    IF v_ai_authorized THEN RETURN jsonb_build_object('reply', null, 'use_ai', true, 'source', 'after_hours_ai'); END IF;
    RETURN jsonb_build_object('reply', null);
  END IF;

  IF v_cfg.menu_triggers IS NOT NULL AND NOT v_is_order_intent THEN
    FOREACH v_trigger IN ARRAY v_cfg.menu_triggers LOOP
      IF v_trigger IS NOT NULL AND length(v_trigger) > 0
         AND position(lower(translate(v_trigger,'áéíóúÁÉÍÓÚñÑ','aeiouAEIOUnN')) in v_normalized) > 0 THEN
        v_should_menu := true;
        v_matched_trigger := v_trigger;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_is_greeting AND NOT v_is_short THEN
    v_len := coalesce(array_length(v_cfg.welcome_messages,1),0);
    IF v_len > 0 THEN
      IF v_len = 1 THEN v_idx := 1;
      ELSE
        v_idx := 1 + floor(random() * v_len)::int;
        IF v_last_idx IS NOT NULL AND v_idx = v_last_idx THEN
          v_idx := 1 + (v_idx % v_len);
        END IF;
      END IF;
      v_greeting := replace(v_cfg.welcome_messages[v_idx], '{menu_link}', v_menu_link);
      v_reply := v_greeting;
    ELSE
      v_reply := '¡Hola! Soy Golosito, tu asistente de Heladería Goloso. 🍦' || E'\n\n' ||
                 'Te comparto el menú con fotos y precios 👉 ' || v_menu_link || E'\n\n' ||
                 'Dime en qué te ayudo.';
    END IF;
  END IF;

  IF v_should_menu THEN
    v_menu_msg := replace(coalesce(v_cfg.menu_message,''), '{menu_link}', v_menu_link);
    IF v_reply <> '' THEN
      v_reply := v_reply || E'\n\n' || v_menu_msg;
    ELSE
      v_reply := v_menu_msg;
    END IF;
  END IF;

  IF v_reply = '' OR v_reply IS NULL THEN
    IF v_ai_authorized THEN
      RETURN jsonb_build_object('reply', null, 'use_ai', true, 'source', 'fallback_ai');
    END IF;
    RETURN jsonb_build_object('reply', null);
  END IF;

  INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
  VALUES (v_cfg.branch_id, _from, 'out', v_reply, v_matched_trigger);

  UPDATE public.whatsapp_bot_greeted
     SET last_greeted_at = v_now, last_menu_at = CASE WHEN v_should_menu THEN v_now ELSE last_menu_at END,
         last_msg_idx = coalesce(v_idx, last_msg_idx), greeted_date = current_date
   WHERE branch_id = v_cfg.branch_id AND phone = _from;

  RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', v_matched_trigger);
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
  duplicate_sale public.sales%ROWTYPE;
  v_order_type text;
  v_phone text;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;

  SELECT * INTO cfg FROM public.whatsapp_bot_config WHERE branch_id = bid;
  v_phone := regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');

  SELECT * INTO cart
  FROM public.whatsapp_ai_carts
  WHERE branch_id = bid AND phone = _phone AND status = 'building'
  ORDER BY created_at DESC
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

    IF COALESCE(item->>'product_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
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
$function$;