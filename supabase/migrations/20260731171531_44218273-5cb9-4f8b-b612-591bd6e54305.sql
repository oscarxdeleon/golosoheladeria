CREATE TABLE IF NOT EXISTS public.app_ai_credentials (
  provider text PRIMARY KEY,
  api_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT ALL ON public.app_ai_credentials TO service_role;

ALTER TABLE public.app_ai_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "no direct access to ai credentials"
  ON public.app_ai_credentials FOR ALL
  TO authenticated
  USING (false) WITH CHECK (false);

-- Lectura interna para el motor del chatbot, validada por el token de la sede.
CREATE OR REPLACE FUNCTION public.whatsapp_bot_get_ai_keys(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
  v_res jsonb;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.whatsapp_bot_config WHERE device_token = _token) INTO v_ok;
  IF NOT v_ok THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;
  SELECT jsonb_object_agg(provider, api_key) INTO v_res FROM public.app_ai_credentials;
  RETURN coalesce(v_res, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_bot_get_ai_keys(text) FROM public;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_get_ai_keys(text) TO anon, authenticated, service_role;

-- Guardar / borrar la clave (solo administradores).
CREATE OR REPLACE FUNCTION public.admin_set_ai_key(_provider text, _api_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider text := lower(btrim(coalesce(_provider, '')));
  v_key text := btrim(coalesce(_api_key, ''));
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Solo administradores';
  END IF;
  IF v_provider NOT IN ('gemini', 'lovable') THEN
    RAISE EXCEPTION 'Proveedor inválido';
  END IF;

  IF v_key = '' THEN
    DELETE FROM public.app_ai_credentials WHERE provider = v_provider;
    RETURN jsonb_build_object('ok', true, 'provider', v_provider, 'configured', false);
  END IF;

  INSERT INTO public.app_ai_credentials (provider, api_key, updated_at, updated_by)
  VALUES (v_provider, v_key, now(), auth.uid())
  ON CONFLICT (provider) DO UPDATE
    SET api_key = EXCLUDED.api_key, updated_at = now(), updated_by = EXCLUDED.updated_by;

  RETURN jsonb_build_object('ok', true, 'provider', v_provider, 'configured', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_ai_key(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_set_ai_key(text, text) TO authenticated, service_role;

-- Estado enmascarado (solo administradores).
CREATE OR REPLACE FUNCTION public.admin_ai_key_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Solo administradores';
  END IF;
  SELECT jsonb_object_agg(provider, jsonb_build_object(
    'configured', true,
    'masked', '••••' || right(api_key, 4),
    'updated_at', updated_at
  )) INTO v_res
  FROM public.app_ai_credentials;
  RETURN coalesce(v_res, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ai_key_status() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_ai_key_status() TO authenticated, service_role;