-- Cola de mensajes de WhatsApp para envío saliente (cierre de caja, etc.)
CREATE TABLE IF NOT EXISTS public.whatsapp_outbound_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  to_phone TEXT NOT NULL,
  body TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

GRANT SELECT ON public.whatsapp_outbound_queue TO authenticated;
GRANT ALL ON public.whatsapp_outbound_queue TO service_role;

ALTER TABLE public.whatsapp_outbound_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can view outbound queue"
  ON public.whatsapp_outbound_queue FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_outbound_queue_pending
  ON public.whatsapp_outbound_queue (branch_id, status, created_at)
  WHERE status = 'pending';

-- Bot pide sus pendientes con el token de la sede
CREATE OR REPLACE FUNCTION public.whatsapp_bot_get_pending(_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch UUID;
  v_rows JSONB;
BEGIN
  SELECT branch_id INTO v_branch
  FROM public.whatsapp_bot_config
  WHERE device_token = _token;
  IF v_branch IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  UPDATE public.whatsapp_outbound_queue
    SET status = 'sending', attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM public.whatsapp_outbound_queue
      WHERE branch_id = v_branch AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    )
  RETURNING id, to_phone, body
  INTO v_rows;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'to', to_phone, 'body', body)), '[]'::jsonb)
    INTO v_rows
  FROM public.whatsapp_outbound_queue
  WHERE branch_id = v_branch AND status = 'sending';

  RETURN jsonb_build_object('pending', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_bot_get_pending(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_get_pending(TEXT) TO anon, authenticated, service_role;

-- Bot confirma envío (o falla) de mensajes
CREATE OR REPLACE FUNCTION public.whatsapp_bot_ack_outbound(
  _token TEXT,
  _sent UUID[],
  _failed UUID[],
  _error TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch UUID;
BEGIN
  SELECT branch_id INTO v_branch
  FROM public.whatsapp_bot_config
  WHERE device_token = _token;
  IF v_branch IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  IF _sent IS NOT NULL AND array_length(_sent, 1) > 0 THEN
    UPDATE public.whatsapp_outbound_queue
      SET status = 'sent', sent_at = now(), last_error = NULL
      WHERE id = ANY(_sent) AND branch_id = v_branch;
  END IF;

  IF _failed IS NOT NULL AND array_length(_failed, 1) > 0 THEN
    UPDATE public.whatsapp_outbound_queue
      SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
          last_error = _error
      WHERE id = ANY(_failed) AND branch_id = v_branch;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_bot_ack_outbound(TEXT, UUID[], UUID[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ack_outbound(TEXT, UUID[], UUID[], TEXT) TO anon, authenticated, service_role;
