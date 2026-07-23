
-- Tabla de memoria conversacional del asistente IA de WhatsApp
CREATE TABLE public.whatsapp_ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  phone text NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.whatsapp_ai_messages TO authenticated;
GRANT ALL ON public.whatsapp_ai_messages TO service_role;

ALTER TABLE public.whatsapp_ai_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins y supervisores ven historial IA"
  ON public.whatsapp_ai_messages FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'supervisor')
  );

CREATE INDEX idx_wa_ai_msgs_branch_phone_time
  ON public.whatsapp_ai_messages (branch_id, phone, created_at DESC);

-- Historial reciente (últimos N mensajes de las últimas 2 horas) para el bot
CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_history(
  _token text,
  _phone text,
  _limit integer DEFAULT 12
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _branch uuid;
  _norm text;
  _rows jsonb;
BEGIN
  SELECT branch_id INTO _branch
  FROM public.whatsapp_bot_config
  WHERE device_token = _token;

  IF _branch IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  _norm := regexp_replace(coalesce(_phone,''), '[^0-9]', '', 'g');

  SELECT coalesce(jsonb_agg(jsonb_build_object('role', role, 'content', content) ORDER BY created_at ASC), '[]'::jsonb)
    INTO _rows
  FROM (
    SELECT role, content, created_at
    FROM public.whatsapp_ai_messages
    WHERE branch_id = _branch
      AND regexp_replace(phone, '[^0-9]', '', 'g') = _norm
      AND created_at > now() - interval '2 hours'
    ORDER BY created_at DESC
    LIMIT greatest(1, least(_limit, 30))
  ) t;

  RETURN jsonb_build_object('messages', _rows);
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_bot_ai_history(text, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_history(text, text, integer) TO anon, authenticated, service_role;

-- Guardar un mensaje y limpiar viejos (> 24h) del mismo cliente/sede
CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_save_message(
  _token text,
  _phone text,
  _role text,
  _content text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _branch uuid;
BEGIN
  SELECT branch_id INTO _branch
  FROM public.whatsapp_bot_config
  WHERE device_token = _token;

  IF _branch IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  IF _role NOT IN ('user','assistant') THEN
    RETURN jsonb_build_object('error', 'invalid_role');
  END IF;

  IF _content IS NULL OR length(trim(_content)) = 0 THEN
    RETURN jsonb_build_object('error', 'empty_content');
  END IF;

  INSERT INTO public.whatsapp_ai_messages (branch_id, phone, role, content)
  VALUES (_branch, _phone, _role, left(_content, 4000));

  -- Housekeeping: descarta mensajes viejos del mismo cliente/sede
  DELETE FROM public.whatsapp_ai_messages
  WHERE branch_id = _branch
    AND regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(coalesce(_phone,''), '[^0-9]', '', 'g')
    AND created_at < now() - interval '24 hours';

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_bot_ai_save_message(text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_save_message(text, text, text, text) TO anon, authenticated, service_role;
