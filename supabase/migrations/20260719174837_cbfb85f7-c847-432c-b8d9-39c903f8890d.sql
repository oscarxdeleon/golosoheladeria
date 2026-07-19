
CREATE OR REPLACE FUNCTION public.whatsapp_bot_get_pending(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Marcar hasta 10 pendientes como "sending" de forma atómica.
  UPDATE public.whatsapp_outbound_queue
     SET status = 'sending', attempts = attempts + 1
   WHERE id IN (
     SELECT id FROM public.whatsapp_outbound_queue
      WHERE branch_id = v_branch AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT 10
      FOR UPDATE SKIP LOCKED
   );

  -- Devolver todo lo que quedó en estado "sending" para esta sede.
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object('id', id, 'to', to_phone, 'body', body) ORDER BY created_at ASC),
           '[]'::jsonb
         )
    INTO v_rows
    FROM public.whatsapp_outbound_queue
   WHERE branch_id = v_branch AND status = 'sending';

  RETURN jsonb_build_object('pending', v_rows);
END;
$function$;

-- Recuperar los mensajes de prueba que quedaron "colgados" en 'sending'
-- para que el bot los procese en su próximo ciclo.
UPDATE public.whatsapp_outbound_queue
   SET status = 'pending'
 WHERE status = 'sending' AND sent_at IS NULL;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_get_pending(text) TO anon, authenticated;
