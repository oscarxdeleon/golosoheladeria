ALTER TABLE public.whatsapp_bot_config
  ADD COLUMN IF NOT EXISTS evolution_webhook_token text NOT NULL
  DEFAULT replace(gen_random_uuid()::text, '-', '');

CREATE OR REPLACE FUNCTION public.whatsapp_evolution_auth(_branch_id uuid, _token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  IF _token IS NULL OR length(_token) < 16 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token');
  END IF;
  SELECT device_token, evolution_webhook_token, chatbot_mode, enabled, ai_enabled, ai_ordering_enabled
    INTO r FROM public.whatsapp_bot_config WHERE branch_id = _branch_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'branch_not_found');
  END IF;
  IF r.evolution_webhook_token IS DISTINCT FROM _token THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_token');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'device_token', r.device_token,
    'chatbot_mode', r.chatbot_mode,
    'enabled', r.enabled,
    'ai_enabled', r.ai_enabled,
    'ai_ordering_enabled', r.ai_ordering_enabled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_evolution_auth(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.whatsapp_evolution_auth(uuid, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_evolution_persist(_branch_id uuid, _token text, _patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE auth_res jsonb;
BEGIN
  auth_res := public.whatsapp_evolution_auth(_branch_id, _token);
  IF (auth_res->>'ok')::boolean IS NOT TRUE THEN
    RETURN auth_res;
  END IF;

  INSERT INTO public.whatsapp_hub_sessions AS s (
    branch_id, status, connected_phone, last_qr, last_qr_at,
    last_error, last_connected_at, last_disconnected_at, updated_at
  ) VALUES (
    _branch_id,
    COALESCE(_patch->>'status', 'disconnected'),
    NULLIF(_patch->>'connected_phone', ''),
    NULLIF(_patch->>'last_qr', ''),
    CASE WHEN _patch ? 'last_qr' THEN now() ELSE NULL END,
    NULLIF(_patch->>'last_error', ''),
    CASE WHEN _patch->>'status' = 'connected' THEN now() ELSE NULL END,
    CASE WHEN _patch->>'status' = 'disconnected' THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (branch_id) DO UPDATE SET
    status = EXCLUDED.status,
    connected_phone = COALESCE(EXCLUDED.connected_phone, s.connected_phone),
    last_qr = CASE WHEN _patch ? 'last_qr' THEN EXCLUDED.last_qr ELSE s.last_qr END,
    last_qr_at = CASE WHEN _patch ? 'last_qr' THEN EXCLUDED.last_qr_at ELSE s.last_qr_at END,
    last_error = CASE WHEN _patch ? 'last_error' THEN EXCLUDED.last_error ELSE s.last_error END,
    last_connected_at = COALESCE(EXCLUDED.last_connected_at, s.last_connected_at),
    last_disconnected_at = COALESCE(EXCLUDED.last_disconnected_at, s.last_disconnected_at),
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_evolution_persist(uuid, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.whatsapp_evolution_persist(uuid, text, jsonb) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_evolution_get_token(_branch_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE t text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Solo administradores';
  END IF;
  SELECT evolution_webhook_token INTO t FROM public.whatsapp_bot_config WHERE branch_id = _branch_id;
  RETURN t;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_evolution_get_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.whatsapp_evolution_get_token(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_evolution_rotate_token(_branch_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE t text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Solo administradores';
  END IF;
  t := replace(gen_random_uuid()::text, '-', '');
  UPDATE public.whatsapp_bot_config SET evolution_webhook_token = t, updated_at = now()
   WHERE branch_id = _branch_id;
  RETURN t;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_evolution_rotate_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.whatsapp_evolution_rotate_token(uuid) TO authenticated, service_role;