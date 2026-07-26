CREATE OR REPLACE FUNCTION public.whatsapp_bot_handle_incoming(_token text, _from text, _body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_cfg public.whatsapp_bot_config%ROWTYPE;
  v_now timestamptz := now();
  v_body text := coalesce(_body, '');
  v_normalized text;
  v_reply text := '';
  v_trigger text;
  v_matched_trigger text := null;
  v_menu_link text;
  v_len int := 0;
  v_idx int := null;
  v_last_idx int := null;
  v_should_menu boolean := false;
  v_online_open boolean := true;
  v_physical_open boolean := true;
  v_is_greeting boolean := false;
  v_is_order_intent boolean := false;
  v_is_short boolean := false;
  v_phone_digits text;
  v_last_any timestamptz;
  v_cooldown interval;
  v_ai_authorized boolean := false;
  v_sandbox_empty boolean := true;
  v_whitelisted boolean := false;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  v_branch_id := public.whatsapp_bot_resolve_branch_id(_token);
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  SELECT * INTO v_cfg FROM public.whatsapp_bot_config WHERE branch_id = v_branch_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  v_menu_link := 'https://golosoheladeria.vercel.app/s/' || coalesce((SELECT slug FROM public.branches WHERE id = v_cfg.branch_id), '') || '/menu';
  v_normalized := lower(translate(v_body,'áéíóúÁÉÍÓÚñÑ','aeiouAEIOUnN'));
  v_phone_digits := regexp_replace(_from, '[^0-9]', '', 'g');

  INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body)
  VALUES (v_cfg.branch_id, _from, 'in', v_body);

  IF NOT coalesce(v_cfg.enabled, true) THEN
    RETURN jsonb_build_object('reply', null, 'skipped', 'disabled', 'skip_reason', 'bot_disabled');
  END IF;

  v_sandbox_empty := v_cfg.ai_sandbox_numbers IS NULL
                    OR array_length(v_cfg.ai_sandbox_numbers, 1) IS NULL
                    OR array_length(v_cfg.ai_sandbox_numbers, 1) = 0;

  IF NOT v_sandbox_empty THEN
    SELECT true INTO v_whitelisted
    FROM unnest(v_cfg.ai_sandbox_numbers) AS n
    WHERE regexp_replace(n, '[^0-9]', '', 'g') = v_phone_digits
       OR right(regexp_replace(n, '[^0-9]', '', 'g'), 10) = right(v_phone_digits, 10)
    LIMIT 1;
    v_whitelisted := coalesce(v_whitelisted, false);
    IF NOT v_whitelisted THEN
      RETURN jsonb_build_object('reply', null, 'skipped', 'not_whitelisted', 'skip_reason', 'not_whitelisted');
    END IF;
    v_ai_authorized := coalesce(v_cfg.ai_enabled, false);
  ELSE
    v_ai_authorized := coalesce(v_cfg.ai_enabled, false)
                       AND coalesce(v_cfg.ai_ordering_enabled, false);
  END IF;

  INSERT INTO public.whatsapp_bot_greeted(branch_id, phone, last_greeted_at, greeted_date)
  VALUES (v_cfg.branch_id, _from, NULL, current_date)
  ON CONFLICT (branch_id, phone) DO NOTHING;

  SELECT greatest(coalesce(last_greeted_at, 'epoch'::timestamptz), coalesce(last_menu_at, 'epoch'::timestamptz), coalesce(last_after_hours_at, 'epoch'::timestamptz)), last_msg_idx
    INTO v_last_any, v_last_idx
  FROM public.whatsapp_bot_greeted
  WHERE branch_id = v_cfg.branch_id AND phone = _from;

  v_is_short := array_length(regexp_split_to_array(trim(v_normalized), '\s+'), 1) <= 2;
  v_is_greeting := v_normalized ~ '(^|\s)(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|hello|menu|menú)(\s|$)';
  v_is_order_intent := v_normalized ~ '(pedido|pedir|domicilio|quiero|dame|deme|comprar|orden|helado|malteada|jugo|waffle|banana|ensalada|brownie|cholado|fresas|copa|cono|vaso|recoger)';

  v_cooldown := make_interval(hours => greatest(coalesce(v_cfg.greet_cooldown_hours, 24), 0));

  IF v_is_order_intent THEN
    IF v_ai_authorized THEN
      RETURN jsonb_build_object('reply', null, 'use_ai', true, 'source', 'order_intent');
    END IF;
    v_reply := '¡Hola! Soy Golosito, tu asistente de Heladería Goloso. 🍦' || E'\n\n' ||
               'Por ahora te comparto el menú con fotos y precios 👉 ' || v_menu_link || E'\n\n' ||
               'Si quieres pedir, dime producto, cantidad, nombre, dirección/barrio y forma de pago.';
    INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
    VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'order_intent_safe');
    UPDATE public.whatsapp_bot_greeted SET last_greeted_at = v_now, greeted_date = current_date
     WHERE branch_id = v_cfg.branch_id AND phone = _from;
    RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'order_intent_safe', 'source', 'fixed_safe');
  END IF;

  IF v_last_any IS NOT NULL AND v_last_any > v_now - v_cooldown THEN
    IF v_is_greeting THEN
      RETURN jsonb_build_object('reply', null, 'skipped', 'greeting_cooldown', 'skip_reason', 'greeting_cooldown');
    END IF;
    IF v_ai_authorized THEN
      RETURN jsonb_build_object('reply', null, 'use_ai', true, 'source', 'cooldown_ai');
    END IF;
    IF v_is_short THEN
      RETURN jsonb_build_object('reply', null, 'skipped', 'cooldown_short', 'skip_reason', 'cooldown_short');
    END IF;
    v_reply := 'Con gusto te ayudo. 🍦' || E'\n\n' ||
               'Puedes ver el menú actualizado con fotos y precios aquí 👉 ' || v_menu_link || E'\n\n' ||
               'Si quieres hacer un pedido por este chat, envíame producto, cantidad, nombre, dirección/barrio y forma de pago.';
    INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
    VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'cooldown_operational_safe');
    RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'cooldown_operational_safe', 'source', 'fixed_safe');
  END IF;

  v_online_open   := public.whatsapp_bot_is_online_open(v_cfg.branch_id);
  v_physical_open := public.whatsapp_bot_is_physical_open(v_cfg.branch_id);

  IF v_cfg.pickup_after_hours_enabled AND NOT v_online_open AND v_physical_open THEN
    v_len := coalesce(array_length(v_cfg.pickup_after_hours_messages,1),0);
    IF v_len > 0 THEN
      IF v_len = 1 THEN v_idx := 1; ELSE v_idx := 1 + floor(random() * v_len)::int; IF v_last_idx IS NOT NULL AND v_idx = v_last_idx THEN v_idx := 1 + (v_idx % v_len); END IF; END IF;
      v_reply := replace(v_cfg.pickup_after_hours_messages[v_idx], '{menu_link}', v_menu_link);
      INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
      VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'pickup_after_hours');
      UPDATE public.whatsapp_bot_greeted SET last_greeted_at = v_now, last_after_hours_at = v_now, last_menu_at = v_now, last_msg_idx = v_idx, greeted_date = current_date WHERE branch_id = v_cfg.branch_id AND phone = _from;
      RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'pickup_after_hours');
    END IF;
    IF v_ai_authorized THEN RETURN jsonb_build_object('reply', null, 'use_ai', true, 'source', 'pickup_after_hours_ai'); END IF;
    v_reply := 'En este momento no estamos recibiendo nuevos pedidos por domicilio. 🍦' || E'\n\n' || 'Puedes ver el menú aquí 👉 ' || v_menu_link || E'\n\n' || 'Si necesitas ayuda, escríbenos nuevamente en horario de atención.';
    INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
    VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'pickup_after_hours_safe');
    RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'pickup_after_hours_safe', 'source', 'fixed_safe');
  END IF;

  IF v_cfg.after_hours_enabled AND NOT v_online_open AND NOT v_physical_open THEN
    v_len := coalesce(array_length(v_cfg.after_hours_messages,1),0);
    IF v_len > 0 THEN
      IF v_len = 1 THEN v_idx := 1; ELSE v_idx := 1 + floor(random() * v_len)::int; IF v_last_idx IS NOT NULL AND v_idx = v_last_idx THEN v_idx := 1 + (v_idx % v_len); END IF; END IF;
      v_reply := replace(v_cfg.after_hours_messages[v_idx], '{menu_link}', v_menu_link);
      INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
      VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'after_hours');
      UPDATE public.whatsapp_bot_greeted SET last_greeted_at = v_now, last_after_hours_at = v_now, last_menu_at = v_now, last_msg_idx = v_idx, greeted_date = current_date WHERE branch_id = v_cfg.branch_id AND phone = _from;
      RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'after_hours');
    END IF;
    IF v_ai_authorized THEN RETURN jsonb_build_object('reply', null, 'use_ai', true, 'source', 'after_hours_ai'); END IF;
    v_reply := 'En este momento estamos fuera de horario de atención. 🍦' || E'\n\n' || 'Puedes ver el menú aquí 👉 ' || v_menu_link || E'\n\n' || 'Con gusto te atendemos nuevamente en nuestro horario habitual.';
    INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
    VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'after_hours_safe');
    RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'after_hours_safe', 'source', 'fixed_safe');
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

  IF v_is_greeting THEN
    v_len := coalesce(array_length(v_cfg.welcome_messages,1),0);
    IF v_len > 0 THEN
      IF v_len = 1 THEN v_idx := 1; ELSE v_idx := 1 + floor(random() * v_len)::int; IF v_last_idx IS NOT NULL AND v_idx = v_last_idx THEN v_idx := 1 + (v_idx % v_len); END IF; END IF;
      v_reply := replace(v_cfg.welcome_messages[v_idx], '{menu_link}', v_menu_link);
    ELSE
      v_reply := '¡Hola! Soy Golosito, tu asistente de Heladería Goloso. 🍦' || E'\n\n' || 'Te comparto el menú con fotos y precios 👉 ' || v_menu_link || E'\n\n' || 'Dime en qué te ayudo.';
    END IF;
    v_matched_trigger := coalesce(v_matched_trigger, 'welcome');
  END IF;

  IF v_should_menu THEN
    IF v_reply <> '' THEN v_reply := v_reply || E'\n\n' || replace(coalesce(v_cfg.menu_message,''), '{menu_link}', v_menu_link);
    ELSE v_reply := replace(coalesce(v_cfg.menu_message,''), '{menu_link}', v_menu_link);
    END IF;
  END IF;

  IF v_reply = '' OR v_reply IS NULL THEN
    IF v_ai_authorized THEN
      RETURN jsonb_build_object('reply', null, 'use_ai', true, 'source', 'fallback_ai');
    END IF;
    IF v_is_short THEN
      RETURN jsonb_build_object('reply', null, 'skipped', 'short_no_rule_no_ai', 'skip_reason', 'short_no_rule_no_ai');
    END IF;
    v_reply := 'Con gusto te ayudo. 🍦' || E'\n\n' ||
               'Puedes ver el menú actualizado con fotos y precios aquí 👉 ' || v_menu_link || E'\n\n' ||
               'Si quieres hacer un pedido por este chat, envíame producto, cantidad, nombre, dirección/barrio y forma de pago.';
    INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
    VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'no_ai_operational_safe');
    RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'no_ai_operational_safe', 'source', 'fixed_safe');
  END IF;

  INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
  VALUES (v_cfg.branch_id, _from, 'out', v_reply, v_matched_trigger);

  UPDATE public.whatsapp_bot_greeted
     SET last_greeted_at = v_now,
         last_menu_at = CASE WHEN v_should_menu THEN v_now ELSE last_menu_at END,
         last_msg_idx = coalesce(v_idx, last_msg_idx),
         greeted_date = current_date
   WHERE branch_id = v_cfg.branch_id AND phone = _from;

  RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', v_matched_trigger);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_handle_incoming(text, text, text) TO anon, authenticated, service_role;