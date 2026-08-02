-- Estado global del runtime del chatbot -------------------------------------
CREATE TABLE IF NOT EXISTS public.bot_runtime_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config_revision bigint NOT NULL DEFAULT 1,
  refresh_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_details jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO public.bot_runtime_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.bot_runtime_state TO authenticated;
GRANT ALL ON public.bot_runtime_state TO service_role;
ALTER TABLE public.bot_runtime_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_runtime_state_admin_read" ON public.bot_runtime_state;
CREATE POLICY "bot_runtime_state_admin_read"
ON public.bot_runtime_state FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Historial de sincronizaciones ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.bot_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  config_revision bigint,
  status text NOT NULL,
  targets jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text
);

GRANT SELECT ON public.bot_sync_log TO authenticated;
GRANT ALL ON public.bot_sync_log TO service_role;
ALTER TABLE public.bot_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_sync_log_admin_read" ON public.bot_sync_log;
CREATE POLICY "bot_sync_log_admin_read"
ON public.bot_sync_log FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Sube la versión de configuración (invalida cachés del bot) -----------------
CREATE OR REPLACE FUNCTION public.bot_bump_config_revision()
RETURNS TABLE (config_revision bigint, refresh_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  UPDATE public.bot_runtime_state s
     SET config_revision = s.config_revision + 1,
         updated_at = now(),
         updated_by = auth.uid()
   WHERE s.id = 1
  RETURNING s.config_revision, s.refresh_token;
END;
$$;

REVOKE ALL ON FUNCTION public.bot_bump_config_revision() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bot_bump_config_revision() TO authenticated, service_role;

-- Registra el resultado de una sincronización --------------------------------
CREATE OR REPLACE FUNCTION public.bot_record_sync(
  _revision bigint,
  _status text,
  _targets jsonb,
  _error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  INSERT INTO public.bot_sync_log (created_by, config_revision, status, targets, error)
  VALUES (auth.uid(), _revision, _status, COALESCE(_targets, '[]'::jsonb), _error);

  UPDATE public.bot_runtime_state
     SET last_sync_at = now(),
         last_sync_status = _status,
         last_sync_details = jsonb_build_object('targets', COALESCE(_targets, '[]'::jsonb), 'error', _error)
   WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.bot_record_sync(bigint, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bot_record_sync(bigint, text, jsonb, text) TO authenticated, service_role;

-- Autoriza al endpoint público de refresco (token interno) -------------------
CREATE OR REPLACE FUNCTION public.bot_refresh_authorize(_token text)
RETURNS TABLE (ok boolean, config_revision bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (s.refresh_token = _token) AS ok,
         CASE WHEN s.refresh_token = _token THEN s.config_revision ELSE NULL END
    FROM public.bot_runtime_state s
   WHERE s.id = 1;
$$;

REVOKE ALL ON FUNCTION public.bot_refresh_authorize(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bot_refresh_authorize(text) TO anon, authenticated, service_role;