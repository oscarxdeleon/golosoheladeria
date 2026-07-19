ALTER TABLE public.whatsapp_outbound_queue
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_get_pending(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch uuid;
  v_rows jsonb;
BEGIN
  SELECT branch_id INTO v_branch
  FROM public.whatsapp_bot_config
  WHERE device_token = _token;

  IF v_branch IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  WITH claimed AS (
    UPDATE public.whatsapp_outbound_queue q
       SET status = 'sending',
           attempts = attempts + 1,
           last_attempt_at = now(),
           last_error = NULL
     WHERE q.id IN (
       SELECT id
       FROM public.whatsapp_outbound_queue
       WHERE branch_id = v_branch
         AND attempts < 5
         AND (
           status = 'pending'
           OR (
             status = 'sending'
             AND COALESCE(last_attempt_at, created_at) < now() - interval '2 minutes'
           )
         )
       ORDER BY created_at ASC
       LIMIT 10
       FOR UPDATE SKIP LOCKED
     )
     RETURNING q.id, q.to_phone, q.body, q.created_at
  )
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object('id', id, 'to', to_phone, 'body', body) ORDER BY created_at ASC),
           '[]'::jsonb
         )
    INTO v_rows
  FROM claimed;

  UPDATE public.whatsapp_outbound_queue
     SET status = 'failed',
         last_error = COALESCE(last_error, 'Máximo de intentos alcanzado')
   WHERE branch_id = v_branch
     AND status IN ('pending', 'sending')
     AND attempts >= 5;

  RETURN jsonb_build_object('pending', v_rows);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_get_pending(text) TO anon, authenticated, service_role;