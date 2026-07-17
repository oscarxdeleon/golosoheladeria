GRANT SELECT, UPDATE ON public.whatsapp_bot_config TO anon;
GRANT INSERT ON public.whatsapp_bot_messages TO anon;
GRANT SELECT, INSERT ON public.whatsapp_bot_greeted TO anon;

DROP POLICY IF EXISTS "whatsapp_bot_config bot token read" ON public.whatsapp_bot_config;
CREATE POLICY "whatsapp_bot_config bot token read"
  ON public.whatsapp_bot_config
  FOR SELECT
  TO anon
  USING (false);

DROP POLICY IF EXISTS "whatsapp_bot_config bot token update" ON public.whatsapp_bot_config;
CREATE POLICY "whatsapp_bot_config bot token update"
  ON public.whatsapp_bot_config
  FOR UPDATE
  TO anon
  USING (false)
  WITH CHECK (false);

ALTER TABLE public.whatsapp_bot_config REPLICA IDENTITY FULL;
ALTER TABLE public.whatsapp_bot_messages REPLICA IDENTITY FULL;

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

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_report_status(text, text, text, text) TO anon, authenticated;