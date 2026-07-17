CREATE OR REPLACE FUNCTION public.whatsapp_bot_resolve_branch_id(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text := btrim(coalesce(_token, ''));
  v_hex text := lower(regexp_replace(btrim(coalesce(_token, '')), '[^0-9a-fA-F]', '', 'g'));
  v_prefix text;
  v_branch_id uuid;
BEGIN
  IF length(v_token) < 16 THEN
    RETURN NULL;
  END IF;

  SELECT c.branch_id INTO v_branch_id
  FROM public.whatsapp_bot_config c
  WHERE c.device_token = v_token
  LIMIT 1;

  IF v_branch_id IS NOT NULL THEN
    RETURN v_branch_id;
  END IF;

  IF length(v_hex) >= 20 THEN
    v_prefix := left(v_hex, 20);
    SELECT c.branch_id INTO v_branch_id
    FROM public.whatsapp_bot_config c
    WHERE left(lower(c.device_token), length(v_prefix)) = v_prefix
    ORDER BY c.updated_at DESC
    LIMIT 1;

    IF v_branch_id IS NOT NULL THEN
      RETURN v_branch_id;
    END IF;
  END IF;

  IF length(v_token) >= 20 THEN
    v_prefix := lower(left(v_token, 20));
    SELECT c.branch_id INTO v_branch_id
    FROM public.whatsapp_bot_config c
    WHERE left(lower(c.device_token), length(v_prefix)) = v_prefix
    ORDER BY c.updated_at DESC
    LIMIT 1;
  END IF;

  RETURN v_branch_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_get_config(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_cfg public.whatsapp_bot_config%ROWTYPE;
  v_branch public.branches%ROWTYPE;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  v_branch_id := public.whatsapp_bot_resolve_branch_id(_token);
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  SELECT * INTO v_cfg FROM public.whatsapp_bot_config WHERE branch_id = v_branch_id;
  SELECT * INTO v_branch FROM public.branches WHERE id = v_cfg.branch_id;

  RETURN jsonb_build_object(
    'branch_id',        v_cfg.branch_id,
    'branch_name',      v_branch.name,
    'branch_slug',      v_branch.slug,
    'device_token',     v_cfg.device_token,
    'enabled',          v_cfg.enabled,
    'welcome_messages', to_jsonb(v_cfg.welcome_messages),
    'menu_triggers',    to_jsonb(v_cfg.menu_triggers),
    'menu_message',     v_cfg.menu_message
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_report_status(
  _token text,
  _status text,
  _qr text DEFAULT NULL,
  _phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
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

  UPDATE public.whatsapp_bot_config
  SET
    connection_status = _status,
    qr_code = CASE WHEN _status = 'qr' THEN NULLIF(_qr, '') ELSE NULL END,
    qr_generated_at = CASE WHEN _status = 'qr' AND NULLIF(_qr, '') IS NOT NULL THEN now() ELSE qr_generated_at END,
    connected_phone = CASE WHEN _status = 'connected' THEN NULLIF(_phone, '') ELSE connected_phone END,
    last_seen_at = now()
  WHERE branch_id = v_branch_id;

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch_id,
    'status', _status,
    'qr_saved', (_status = 'qr' AND NULLIF(_qr, '') IS NOT NULL)
  );
END;
$$;

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

  v_normalized := lower(coalesce(_body,''));
  v_normalized := translate(v_normalized, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN');

  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_bot_greeted
    WHERE branch_id = v_cfg.branch_id AND phone = _from AND greeted_date = current_date
  ) THEN
    v_should_greet := true;
    INSERT INTO public.whatsapp_bot_greeted(branch_id, phone, greeted_date)
    VALUES (v_cfg.branch_id, _from, current_date)
    ON CONFLICT DO NOTHING;
  END IF;

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
    v_menu_link := v_public_base || '/s/' || coalesce(v_branch.slug,'') || '/menu';
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

  RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', v_matched_trigger);
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_get_config(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_report_status(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_handle_incoming(text, text, text) TO anon, authenticated;