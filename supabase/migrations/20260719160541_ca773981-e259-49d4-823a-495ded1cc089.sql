CREATE OR REPLACE FUNCTION public.whatsapp_bot_handle_incoming(
  _token text,
  _from text,
  _body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_cfg public.whatsapp_bot_config%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_normalized text;
  v_trigger text;
  v_matched_trigger text;
  v_should_greet boolean := false;
  v_should_menu boolean := false;
  v_is_short boolean := false;
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
  v_public_base text := 'https://golosoheladeria.vercel.app';
  v_cooldown interval;
  v_last_greet timestamptz;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  v_branch_id := public.whatsapp_bot_resolve_branch_id(_token);
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  SELECT * INTO v_cfg FROM public.whatsapp_bot_config WHERE branch_id = v_branch_id;
  UPDATE public.whatsapp_bot_config SET last_seen_at = now() WHERE branch_id = v_cfg.branch_id;

  IF NOT v_cfg.enabled THEN
    INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body)
    VALUES (v_cfg.branch_id, _from, 'in', _body);
    RETURN jsonb_build_object('reply', null);
  END IF;

  SELECT * INTO v_branch FROM public.branches WHERE id = v_cfg.branch_id;

  INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body)
  VALUES (v_cfg.branch_id, _from, 'in', _body);

  v_normalized := lower(btrim(coalesce(_body,'')));
  v_normalized := translate(v_normalized, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN');
  IF v_cfg.short_reply_words IS NOT NULL AND array_length(v_cfg.short_reply_words,1) > 0 THEN
    IF v_normalized = ANY(
      SELECT lower(translate(w,'áéíóúÁÉÍÓÚñÑ','aeiouAEIOUnN')) FROM unnest(v_cfg.short_reply_words) AS w
    ) THEN
      v_is_short := true;
    END IF;
  END IF;

  v_cooldown := make_interval(hours => greatest(coalesce(v_cfg.greet_cooldown_hours,24), 0));
  SELECT max(last_greeted_at), (array_agg(last_msg_idx ORDER BY last_greeted_at DESC))[1]
    INTO v_last_greet, v_last_idx
    FROM public.whatsapp_bot_greeted
   WHERE branch_id = v_cfg.branch_id AND phone = _from;

  IF NOT v_is_short AND (v_last_greet IS NULL OR v_last_greet < now() - v_cooldown) THEN
    v_should_greet := true;
  END IF;

  -- Nuevo formato de link: Vercel + query param sede
  v_menu_link := v_public_base || '/menu?sede=' || coalesce(v_branch.slug,'');

  v_online_open   := public.whatsapp_bot_is_online_open(v_cfg.branch_id);
  v_physical_open := public.whatsapp_bot_is_physical_open(v_cfg.branch_id);

  -- Caso 1: domicilio cerrado PERO heladería abierta
  IF NOT v_online_open AND v_physical_open AND v_cfg.pickup_after_hours_enabled THEN
    IF v_should_greet THEN
      v_len := coalesce(array_length(v_cfg.pickup_after_hours_messages,1),0);
      IF v_len > 0 THEN
        IF v_len = 1 THEN v_idx := 1;
        ELSE
          v_idx := 1 + (abs(hashtext(_from || now()::text)) % v_len);
          IF v_last_idx IS NOT NULL AND v_idx = v_last_idx THEN
            v_idx := 1 + (v_idx % v_len);
          END IF;
        END IF;
        v_after := replace(v_cfg.pickup_after_hours_messages[v_idx], '{menu_link}', v_menu_link);
        v_reply := v_after;
        INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
        VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'pickup_after_hours');
        INSERT INTO public.whatsapp_bot_greeted(branch_id, phone, greeted_date, last_greeted_at, last_msg_idx)
        VALUES (v_cfg.branch_id, _from, current_date, now(), v_idx)
        ON CONFLICT (branch_id, phone, greeted_date) DO UPDATE
          SET last_greeted_at = excluded.last_greeted_at, last_msg_idx = excluded.last_msg_idx;
        RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'pickup_after_hours');
      END IF;
    END IF;
    RETURN jsonb_build_object('reply', null);
  END IF;

  -- Caso 2: todo cerrado
  IF v_cfg.after_hours_enabled AND NOT v_online_open AND NOT v_physical_open THEN
    IF v_should_greet THEN
      v_len := coalesce(array_length(v_cfg.after_hours_messages,1),0);
      IF v_len > 0 THEN
        IF v_len = 1 THEN v_idx := 1;
        ELSE
          v_idx := 1 + (abs(hashtext(_from || now()::text)) % v_len);
          IF v_last_idx IS NOT NULL AND v_idx = v_last_idx THEN
            v_idx := 1 + (v_idx % v_len);
          END IF;
        END IF;
        v_after := replace(v_cfg.after_hours_messages[v_idx], '{menu_link}', v_menu_link);
        v_reply := v_after;
        INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
        VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'after_hours');
        INSERT INTO public.whatsapp_bot_greeted(branch_id, phone, greeted_date, last_greeted_at, last_msg_idx)
        VALUES (v_cfg.branch_id, _from, current_date, now(), v_idx)
        ON CONFLICT (branch_id, phone, greeted_date) DO UPDATE
          SET last_greeted_at = excluded.last_greeted_at, last_msg_idx = excluded.last_msg_idx;
        RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'after_hours');
      END IF;
    END IF;
    RETURN jsonb_build_object('reply', null);
  END IF;

  -- Flujo normal
  IF v_cfg.menu_triggers IS NOT NULL THEN
    FOREACH v_trigger IN ARRAY v_cfg.menu_triggers LOOP
      IF v_trigger IS NOT NULL AND length(v_trigger) > 0
         AND position(lower(translate(v_trigger,'áéíóúÁÉÍÓÚñÑ','aeiouAEIOUnN')) in v_normalized) > 0 THEN
        v_should_menu := true;
        v_matched_trigger := v_trigger;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_should_greet THEN
    v_len := coalesce(array_length(v_cfg.welcome_messages,1),0);
    IF v_len > 0 THEN
      IF v_len = 1 THEN v_idx := 1;
      ELSE
        v_idx := 1 + (abs(hashtext(_from || now()::text)) % v_len);
        IF v_last_idx IS NOT NULL AND v_idx = v_last_idx THEN
          v_idx := 1 + (v_idx % v_len);
        END IF;
      END IF;
      v_greeting := v_cfg.welcome_messages[v_idx];
      v_reply := v_greeting;
    END IF;
  END IF;

  IF v_should_menu THEN
    -- v_menu_link ya apunta al menú (con ?sede=slug); no concatenar '/menu'
    v_menu_msg := replace(v_cfg.menu_message, '{menu_link}', v_menu_link);
    IF v_reply <> '' THEN
      v_reply := v_reply || E'\n\n' || v_menu_msg;
    ELSE
      v_reply := v_menu_msg;
    END IF;
  END IF;

  IF v_reply = '' THEN
    RETURN jsonb_build_object('reply', null);
  END IF;

  INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
  VALUES (v_cfg.branch_id, _from, 'out', v_reply, v_matched_trigger);

  IF v_should_greet THEN
    INSERT INTO public.whatsapp_bot_greeted(branch_id, phone, greeted_date, last_greeted_at, last_msg_idx)
    VALUES (v_cfg.branch_id, _from, current_date, now(), v_idx)
    ON CONFLICT (branch_id, phone, greeted_date) DO UPDATE
      SET last_greeted_at = excluded.last_greeted_at, last_msg_idx = excluded.last_msg_idx;
  END IF;

  RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', v_matched_trigger);
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_handle_incoming(text, text, text) TO anon, authenticated;