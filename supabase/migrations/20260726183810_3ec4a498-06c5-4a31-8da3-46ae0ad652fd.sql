
-- 1) Columna chatbot_mode
ALTER TABLE public.whatsapp_bot_config
  ADD COLUMN IF NOT EXISTS chatbot_mode text NOT NULL DEFAULT 'full';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_bot_config_chatbot_mode_check'
  ) THEN
    ALTER TABLE public.whatsapp_bot_config
      ADD CONSTRAINT whatsapp_bot_config_chatbot_mode_check
      CHECK (chatbot_mode IN ('full','welcome_only','disabled'));
  END IF;
END $$;

-- 2) Helper para consultar el modo por token (usado por defensa en ai_reply)
CREATE OR REPLACE FUNCTION public.whatsapp_bot_get_mode(_token text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_mode text;
  v_enabled boolean;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) < 16 THEN
    RETURN 'disabled';
  END IF;
  v_branch_id := public.whatsapp_bot_resolve_branch_id(_token);
  IF v_branch_id IS NULL THEN
    RETURN 'disabled';
  END IF;
  SELECT chatbot_mode, enabled INTO v_mode, v_enabled
  FROM public.whatsapp_bot_config WHERE branch_id = v_branch_id;
  IF NOT FOUND THEN RETURN 'disabled'; END IF;
  IF NOT coalesce(v_enabled, true) THEN RETURN 'disabled'; END IF;
  RETURN coalesce(v_mode, 'full');
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_get_mode(text) TO anon, authenticated, service_role;

-- 3) handle_incoming: inyectar branching por modo justo antes del gate maestro
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
  v_menu_link text;
  v_len int := 0;
  v_idx int := null;
  v_last_idx int := null;
  v_online_open boolean := true;
  v_physical_open boolean := true;
  v_is_greeting boolean := false;
  v_is_order_intent boolean := false;
  v_is_short boolean := false;
  v_phone_digits text;
  v_contact_key text;
  v_last_any timestamptz;
  v_cooldown interval;
  v_ai_authorized boolean := false;
  v_sandbox_empty boolean := true;
  v_whitelisted boolean := false;
  v_has_active_cart boolean := false;
  v_last_ai_reply timestamptz;
  v_in_active_conversation boolean := false;
  v_mode text;
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
  v_contact_key := public.whatsapp_bot_contact_key(_from);

  INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body)
  VALUES (v_cfg.branch_id, _from, 'in', v_body);

  IF NOT coalesce(v_cfg.enabled, true) THEN
    RETURN jsonb_build_object('reply', null, 'skipped', 'disabled', 'skip_reason', 'bot_disabled');
  END IF;

  v_mode := coalesce(v_cfg.chatbot_mode, 'full');

  -- ============================================================
  -- MODO: DESACTIVADO — no responder absolutamente nada
  -- ============================================================
  IF v_mode = 'disabled' THEN
    RETURN jsonb_build_object('reply', null, 'skipped', 'chatbot_disabled', 'skip_reason', 'chatbot_disabled');
  END IF;

  -- ============================================================
  -- MODO: SOLO BIENVENIDA + MENÚ (Autorespondedor)
  -- No interpreta, no toma pedidos, no llama IA. Solo envía
  -- el mensaje de bienvenida respetando el cooldown por contacto.
  -- ============================================================
  IF v_mode = 'welcome_only' THEN
    INSERT INTO public.whatsapp_bot_greeted(branch_id, phone, last_greeted_at, greeted_date)
    VALUES (v_cfg.branch_id, v_contact_key, NULL, current_date)
    ON CONFLICT (branch_id, phone) DO NOTHING;

    SELECT greatest(coalesce(last_greeted_at, 'epoch'::timestamptz),
                    coalesce(last_menu_at, 'epoch'::timestamptz),
                    coalesce(last_after_hours_at, 'epoch'::timestamptz)),
           last_msg_idx
      INTO v_last_any, v_last_idx
    FROM public.whatsapp_bot_greeted
    WHERE branch_id = v_cfg.branch_id AND public.whatsapp_bot_contact_key(phone) = v_contact_key;

    v_cooldown := make_interval(hours => greatest(coalesce(v_cfg.greet_cooldown_hours, 24), 0));

    IF v_last_any IS NOT NULL AND v_last_any > v_now - v_cooldown THEN
      RETURN jsonb_build_object('reply', null, 'skipped', 'welcome_only_cooldown', 'skip_reason', 'welcome_only_cooldown');
    END IF;

    v_len := coalesce(array_length(v_cfg.welcome_messages, 1), 0);
    IF v_len > 0 THEN
      v_idx := ((coalesce(v_last_idx, -1) + 1) % v_len);
      v_reply := v_cfg.welcome_messages[v_idx + 1];
    END IF;
    IF v_reply IS NULL OR btrim(v_reply) = '' THEN
      v_reply := '¡Hola! 🍦 Soy Golosito de Heladería Goloso. Mira nuestro menú con fotos y precios aquí 👉 ' || v_menu_link;
    ELSIF position(v_menu_link in v_reply) = 0 THEN
      v_reply := v_reply || E'\n\n👉 ' || v_menu_link;
    END IF;

    INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
    VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'welcome_only');

    UPDATE public.whatsapp_bot_greeted
    SET last_greeted_at = v_now,
        greeted_date = current_date,
        last_msg_idx = coalesce(v_idx, last_msg_idx)
    WHERE branch_id = v_cfg.branch_id AND public.whatsapp_bot_contact_key(phone) = v_contact_key;

    RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'welcome_only', 'source', 'welcome_only');
  END IF;

  -- ============================================================
  -- MODO: COMPLETO — comportamiento normal (código original)
  -- ============================================================
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

  SELECT EXISTS(
    SELECT 1 FROM public.whatsapp_ai_carts
    WHERE branch_id = v_cfg.branch_id
      AND public.whatsapp_bot_contact_key(phone) = v_contact_key
      AND status = 'building'
      AND coalesce(expires_at, updated_at + interval '45 minutes') > v_now
  ) INTO v_has_active_cart;

  SELECT max(created_at) INTO v_last_ai_reply
  FROM public.whatsapp_ai_messages
  WHERE branch_id = v_cfg.branch_id
    AND public.whatsapp_bot_contact_key(phone) = v_contact_key
    AND role = 'assistant'
    AND created_at > v_now - interval '20 minutes';

  v_in_active_conversation := v_has_active_cart OR v_last_ai_reply IS NOT NULL;

  IF v_in_active_conversation THEN
    IF v_ai_authorized THEN
      RETURN jsonb_build_object(
        'reply', null,
        'use_ai', true,
        'source', 'active_conversation',
        'has_cart', v_has_active_cart,
        'has_recent_ai', v_last_ai_reply IS NOT NULL
      );
    END IF;
    RETURN jsonb_build_object(
      'reply', null,
      'skipped', 'active_conversation_no_ai',
      'skip_reason', 'active_conversation_no_ai'
    );
  END IF;

  INSERT INTO public.whatsapp_bot_greeted(branch_id, phone, last_greeted_at, greeted_date)
  VALUES (v_cfg.branch_id, v_contact_key, NULL, current_date)
  ON CONFLICT (branch_id, phone) DO NOTHING;

  SELECT greatest(coalesce(last_greeted_at, 'epoch'::timestamptz), coalesce(last_menu_at, 'epoch'::timestamptz), coalesce(last_after_hours_at, 'epoch'::timestamptz)), last_msg_idx
    INTO v_last_any, v_last_idx
  FROM public.whatsapp_bot_greeted
  WHERE branch_id = v_cfg.branch_id AND public.whatsapp_bot_contact_key(phone) = v_contact_key;

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
    WHERE branch_id = v_cfg.branch_id AND public.whatsapp_bot_contact_key(phone) = v_contact_key;
    RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'order_intent_safe', 'source', 'fixed_safe');
  END IF;

  IF v_last_any IS NOT NULL AND v_last_any > v_now - v_cooldown THEN
    IF v_is_greeting THEN
      IF v_ai_authorized THEN
        RETURN jsonb_build_object('reply', null, 'use_ai', true, 'source', 'cooldown_greeting_ai');
      END IF;
      RETURN jsonb_build_object('reply', null, 'skipped', 'greeting_cooldown', 'skip_reason', 'greeting_cooldown');
    END IF;
    IF v_ai_authorized THEN
      RETURN jsonb_build_object('reply', null, 'use_ai', true, 'source', 'cooldown_free_ai');
    END IF;
    RETURN jsonb_build_object('reply', null, 'skipped', 'cooldown_free_text', 'skip_reason', 'cooldown_free_text');
  END IF;

  v_len := coalesce(array_length(v_cfg.welcome_messages, 1), 0);
  IF v_len > 0 THEN
    v_idx := ((coalesce(v_last_idx, -1) + 1) % v_len);
    v_reply := v_cfg.welcome_messages[v_idx + 1];
  END IF;
  IF v_reply IS NULL OR btrim(v_reply) = '' THEN
    v_reply := '¡Hola! 🍦 Soy Golosito de Heladería Goloso. Mira nuestro menú aquí 👉 ' || v_menu_link;
  END IF;

  INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
  VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'welcome');

  UPDATE public.whatsapp_bot_greeted
  SET last_greeted_at = v_now, greeted_date = current_date,
      last_msg_idx = coalesce(v_idx, last_msg_idx)
  WHERE branch_id = v_cfg.branch_id AND public.whatsapp_bot_contact_key(phone) = v_contact_key;

  RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'welcome', 'source', 'welcome');
END;
$function$;
