-- ============================================================
-- WhatsApp Bot — RPCs consumidas por el bot local
-- ============================================================

-- 1) Obtener configuración por device_token
CREATE OR REPLACE FUNCTION public.whatsapp_bot_get_config(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg public.whatsapp_bot_config%ROWTYPE;
  v_branch public.branches%ROWTYPE;
BEGIN
  IF _token IS NULL OR length(_token) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  SELECT * INTO v_cfg FROM public.whatsapp_bot_config WHERE device_token = _token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  SELECT * INTO v_branch FROM public.branches WHERE id = v_cfg.branch_id;

  RETURN jsonb_build_object(
    'branch_id',        v_cfg.branch_id,
    'branch_name',      v_branch.name,
    'branch_slug',      v_branch.slug,
    'enabled',          v_cfg.enabled,
    'welcome_messages', to_jsonb(v_cfg.welcome_messages),
    'menu_triggers',    to_jsonb(v_cfg.menu_triggers),
    'menu_message',     v_cfg.menu_message
  );
END;
$$;

-- 2) Reportar estado + QR
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
  IF _token IS NULL OR length(_token) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;
  IF _status NOT IN ('connected','disconnected','qr','connecting','error') THEN
    RETURN jsonb_build_object('error','invalid_status');
  END IF;

  SELECT branch_id INTO v_branch_id
  FROM public.whatsapp_bot_config
  WHERE device_token = _token;

  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  UPDATE public.whatsapp_bot_config
  SET
    connection_status = _status,
    qr_code = CASE WHEN _status = 'qr' THEN _qr ELSE NULL END,
    qr_generated_at = CASE WHEN _status = 'qr' THEN now() ELSE qr_generated_at END,
    connected_phone = COALESCE(_phone, connected_phone),
    last_seen_at = now()
  WHERE device_token = _token;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 3) Procesar un mensaje entrante y devolver qué responder
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
  IF _token IS NULL OR length(_token) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  SELECT * INTO v_cfg FROM public.whatsapp_bot_config WHERE device_token = _token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  UPDATE public.whatsapp_bot_config SET last_seen_at = now() WHERE branch_id = v_cfg.branch_id;

  IF NOT v_cfg.enabled THEN
    -- Log incoming pero no responder
    INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body)
    VALUES (v_cfg.branch_id, _from, 'in', _body);
    RETURN jsonb_build_object('reply', null);
  END IF;

  SELECT * INTO v_branch FROM public.branches WHERE id = v_cfg.branch_id;

  -- Log incoming
  INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body)
  VALUES (v_cfg.branch_id, _from, 'in', _body);

  -- Normalizar body para triggers (lowercase + sin tildes básicos)
  v_normalized := lower(coalesce(_body,''));
  v_normalized := translate(v_normalized, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN');

  -- ¿Ya saludamos hoy?
  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_bot_greeted
    WHERE branch_id = v_cfg.branch_id AND phone = _from AND greeted_date = current_date
  ) THEN
    v_should_greet := true;
    INSERT INTO public.whatsapp_bot_greeted(branch_id, phone, greeted_date)
    VALUES (v_cfg.branch_id, _from, current_date)
    ON CONFLICT DO NOTHING;
  END IF;

  -- ¿Menciona un trigger de menú?
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

  -- Construir respuesta
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

-- 4) Regenerar device_token (solo admin/supervisor)
CREATE OR REPLACE FUNCTION public.whatsapp_bot_rotate_token(_branch_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_token text;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'supervisor')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_new_token := encode(gen_random_bytes(24),'hex');
  UPDATE public.whatsapp_bot_config
  SET device_token = v_new_token,
      connection_status = 'disconnected',
      qr_code = NULL,
      connected_phone = NULL
  WHERE branch_id = _branch_id;
  RETURN v_new_token;
END;
$$;

-- Permisos: los RPCs del bot los llama el bot local (sin sesión) usando la clave anon/publishable.
-- Las funciones son SECURITY DEFINER y validan el device_token internamente.
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_get_config(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_report_status(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_handle_incoming(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_rotate_token(uuid) TO authenticated;
