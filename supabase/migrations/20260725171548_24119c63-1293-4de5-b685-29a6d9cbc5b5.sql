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

  v_menu_link := coalesce(nullif(v_branch.online_menu_url, ''), 'https://golosoheladeria.lovable.app/menu?sede=' || coalesce(v_branch.slug,''));

  v_normalized := lower(btrim(coalesce(_body,'')));
  v_normalized := translate(v_normalized, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN');
  v_normalized := regexp_replace(v_normalized, '[¿?¡!.,;:()"'']+', '', 'g');
  v_normalized := regexp_replace(v_normalized, '\s+', ' ', 'g');
  v_normalized := btrim(v_normalized);

  v_is_greeting := v_normalized ~ '^(hola+|holi|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|saludos|que tal|hi|hello)$';
  v_is_order_intent := v_normalized ~ '\m(quiero|dame|deme|necesito|pideme|pedir|pedido|ordenar|comprar|agrega|anota|mandame|enviame|domicilio|banana|split|ensalada|brownie|helado|malteada|jugo|copa|cono|vaso|litro|waffle|cholado|fresas|frutas)\M';

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
    IF v_sandbox_empty THEN
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

  -- Cualquier mensaje con producto/intención de pedido va a Golosito.
  IF v_is_order_intent AND v_ai_authorized THEN
    RETURN jsonb_build_object('reply', null, 'use_ai', true, 'source', 'order_intent');
  END IF;

  -- Dentro del cooldown: no repetir la bienvenida completa, pero tampoco dejar silencio.
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