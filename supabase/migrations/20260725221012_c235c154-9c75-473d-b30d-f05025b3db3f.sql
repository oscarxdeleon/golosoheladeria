CREATE OR REPLACE FUNCTION public.whatsapp_bot_report_status(
  _token text,
  _status text,
  _qr text DEFAULT NULL::text,
  _phone text DEFAULT NULL::text,
  _version text DEFAULT NULL::text,
  _instance_id text DEFAULT NULL::text,
  _started_at timestamptz DEFAULT NULL::timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_cmd text;
  v_cfg public.whatsapp_bot_config%ROWTYPE;
  v_now timestamptz := now();
  v_instance_id text := nullif(btrim(coalesce(_instance_id, '')), '');
  v_started_at timestamptz := coalesce(_started_at, v_now);
  v_same_instance boolean := false;
  v_recent_active_connection boolean := false;
  v_report_is_older_instance boolean := false;
  v_obsolete_report boolean := false;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;
  IF _status NOT IN ('connected','disconnected','qr','connecting','error') THEN
    RETURN jsonb_build_object('error','invalid_status');
  END IF;

  v_branch_id := public.whatsapp_bot_resolve_branch_id(_token);
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  SELECT * INTO v_cfg
    FROM public.whatsapp_bot_config
   WHERE branch_id = v_branch_id
   FOR UPDATE;

  v_same_instance := v_instance_id IS NOT NULL
    AND v_cfg.active_instance_id IS NOT NULL
    AND v_cfg.active_instance_id = v_instance_id;

  v_recent_active_connection := v_cfg.connection_status = 'connected'
    AND v_cfg.connected_phone IS NOT NULL
    AND coalesce(v_cfg.last_connected_at, v_cfg.last_seen_at) > (v_now - interval '15 minutes');

  v_report_is_older_instance := v_recent_active_connection
    AND NOT v_same_instance
    AND (
      v_instance_id IS NULL
      OR v_cfg.active_instance_id IS NULL
      OR (
        v_cfg.active_instance_started_at IS NOT NULL
        AND v_started_at <= v_cfg.active_instance_started_at
      )
    );

  v_obsolete_report := v_recent_active_connection
    AND NOT v_same_instance
    AND (
      _status <> 'connected'
      OR v_report_is_older_instance
      OR v_instance_id IS NULL
    );

  IF v_obsolete_report THEN
    UPDATE public.whatsapp_bot_config
       SET last_seen_at = v_now,
           bot_version = coalesce(nullif(_version, ''), bot_version)
     WHERE branch_id = v_branch_id
     RETURNING pending_command INTO v_cmd;

    RETURN jsonb_build_object(
      'ok', true,
      'branch_id', v_branch_id,
      'status', v_cfg.connection_status,
      'ignored', true,
      'duplicate_instance', true,
      'reason', 'obsolete_instance_report_ignored',
      'active_instance_id', v_cfg.active_instance_id,
      'pending_command', v_cmd
    );
  END IF;

  IF _status = 'connected' THEN
    UPDATE public.whatsapp_bot_config
       SET connection_status = 'connected',
           qr_code = NULL,
           connected_phone = coalesce(NULLIF(_phone, ''), connected_phone),
           last_seen_at = v_now,
           last_connected_at = v_now,
           bot_version = coalesce(nullif(_version, ''), bot_version),
           active_instance_id = coalesce(v_instance_id, active_instance_id),
           active_instance_started_at = CASE WHEN v_instance_id IS NOT NULL THEN v_started_at ELSE active_instance_started_at END
     WHERE branch_id = v_branch_id
     RETURNING pending_command INTO v_cmd;
  ELSE
    UPDATE public.whatsapp_bot_config
       SET connection_status = _status,
           qr_code = CASE WHEN _status = 'qr' THEN NULLIF(_qr, '') ELSE NULL END,
           qr_generated_at = CASE WHEN _status = 'qr' AND NULLIF(_qr, '') IS NOT NULL THEN v_now ELSE qr_generated_at END,
           last_seen_at = v_now,
           bot_version = coalesce(nullif(_version, ''), bot_version),
           active_instance_id = CASE WHEN v_instance_id IS NOT NULL THEN v_instance_id ELSE active_instance_id END,
           active_instance_started_at = CASE WHEN v_instance_id IS NOT NULL THEN v_started_at ELSE active_instance_started_at END
     WHERE branch_id = v_branch_id
     RETURNING pending_command INTO v_cmd;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch_id,
    'status', _status,
    'qr_saved', (_status = 'qr' AND NULLIF(_qr, '') IS NOT NULL),
    'pending_command', v_cmd
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_report_status(text, text, text, text, text, text, timestamptz) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_handle_incoming(_token text, _from text, _body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
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
BEGIN
  SELECT * INTO v_cfg FROM public.whatsapp_bot_config WHERE device_token = _token;
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

  IF coalesce(v_cfg.ai_enabled, false) THEN
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

    -- Antes este punto devolvía reply:null durante hasta 24h. Eso dejaba el
    -- chatbot conectado pero mudo para preguntas reales. Solo silenciamos
    -- confirmaciones muy cortas; cualquier mensaje con contenido recibe ayuda.
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

  IF v_is_greeting AND NOT v_is_short THEN
    v_len := coalesce(array_length(v_cfg.welcome_messages,1),0);
    IF v_len > 0 THEN
      IF v_len = 1 THEN v_idx := 1; ELSE v_idx := 1 + floor(random() * v_len)::int; IF v_last_idx IS NOT NULL AND v_idx = v_last_idx THEN v_idx := 1 + (v_idx % v_len); END IF; END IF;
      v_reply := replace(v_cfg.welcome_messages[v_idx], '{menu_link}', v_menu_link);
    ELSE
      v_reply := '¡Hola! Soy Golosito, tu asistente de Heladería Goloso. 🍦' || E'\n\n' || 'Te comparto el menú con fotos y precios 👉 ' || v_menu_link || E'\n\n' || 'Dime en qué te ayudo.';
    END IF;
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