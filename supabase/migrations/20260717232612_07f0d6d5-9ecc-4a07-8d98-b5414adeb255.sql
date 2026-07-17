
ALTER TABLE public.whatsapp_bot_config
  ADD COLUMN IF NOT EXISTS after_hours_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS after_hours_messages text[] NOT NULL DEFAULT ARRAY[
    '¡Hola! 🍨 En este momento estamos fuera de nuestro horario de servicio a domicilio. ¡No te quedes con las ganas! Puedes dejar tu pedido programado aquí 👉 {menu_link}',
    '¡Hola! 👋 Gracias por escribirnos. Ahora mismo el servicio a domicilio está cerrado, pero puedes programar tu pedido y te lo llevamos en cuanto abramos 👉 {menu_link}'
  ]::text[];

CREATE OR REPLACE FUNCTION public.whatsapp_bot_is_online_open(_branch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sched jsonb;
  v_local timestamp := (now() AT TIME ZONE 'America/Bogota');
  v_dow int := extract(dow from v_local)::int;
  v_keys text[] := ARRAY['dom','lun','mar','mie','jue','vie','sab'];
  v_key text := v_keys[v_dow + 1];
  v_day jsonb;
  v_from text;
  v_to text;
  v_hhmm text := to_char(v_local, 'HH24:MI');
BEGIN
  SELECT schedules INTO v_sched FROM public.branches WHERE id = _branch_id;
  IF v_sched IS NULL THEN RETURN true; END IF;
  v_day := v_sched -> 'online' -> v_key;
  IF v_day IS NULL THEN RETURN true; END IF;
  IF coalesce((v_day->>'open')::boolean, true) = false THEN RETURN false; END IF;
  v_from := coalesce(v_day->>'from','00:00');
  v_to   := coalesce(v_day->>'to','23:59');
  RETURN v_hhmm >= v_from AND v_hhmm <= v_to;
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_is_online_open(uuid) TO anon, authenticated;

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
  v_greeting text;
  v_menu_link text;
  v_menu_msg text;
  v_reply text := '';
  v_idx int;
  v_online_open boolean;
  v_after text;
  v_public_base text := 'https://golosoheladeria.lovable.app';
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

  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_bot_greeted
    WHERE branch_id = v_cfg.branch_id AND phone = _from AND greeted_date = current_date
  ) THEN
    v_should_greet := true;
    INSERT INTO public.whatsapp_bot_greeted(branch_id, phone, greeted_date)
    VALUES (v_cfg.branch_id, _from, current_date)
    ON CONFLICT DO NOTHING;
  END IF;

  v_menu_link := v_public_base || '/s/' || coalesce(v_branch.slug,'');

  -- Fuera de horario (domicilio cerrado) → respuesta especial
  v_online_open := public.whatsapp_bot_is_online_open(v_cfg.branch_id);

  IF v_cfg.after_hours_enabled AND NOT v_online_open THEN
    IF v_should_greet AND array_length(v_cfg.after_hours_messages,1) > 0 THEN
      v_idx := 1 + (abs(hashtext(_from || current_date::text)) % array_length(v_cfg.after_hours_messages,1));
      v_after := replace(v_cfg.after_hours_messages[v_idx], '{menu_link}', v_menu_link);
      v_reply := v_after;
      INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
      VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'after_hours');
      RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'after_hours');
    END IF;
    -- Ya saludado hoy y cerrado: no responder de nuevo
    RETURN jsonb_build_object('reply', null);
  END IF;

  -- Flujo normal (horario abierto)
  v_normalized := lower(coalesce(_body,''));
  v_normalized := translate(v_normalized, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN');

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

  IF v_should_greet AND array_length(v_cfg.welcome_messages,1) > 0 THEN
    v_idx := 1 + (abs(hashtext(_from || current_date::text)) % array_length(v_cfg.welcome_messages,1));
    v_greeting := v_cfg.welcome_messages[v_idx];
    v_reply := v_greeting;
  END IF;

  IF v_should_menu THEN
    v_menu_msg := replace(v_cfg.menu_message, '{menu_link}', v_menu_link || '/menu');
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

  RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', v_matched_trigger);
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_handle_incoming(text, text, text) TO anon, authenticated;
