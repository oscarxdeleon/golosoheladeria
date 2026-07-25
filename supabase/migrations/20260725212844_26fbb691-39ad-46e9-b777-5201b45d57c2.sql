CREATE OR REPLACE FUNCTION public.whatsapp_bot_enqueue_reply(
  _token text,
  _to text,
  _body text,
  _purpose text DEFAULT 'chatbot_reply'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_to text;
  v_body text;
  v_purpose text;
  v_existing_id uuid;
  v_id uuid;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) < 16 THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  v_branch_id := public.whatsapp_bot_resolve_branch_id(_token);
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  v_to := regexp_replace(coalesce(_to, ''), '[^0-9]', '', 'g');
  IF length(v_to) = 10 THEN
    v_to := '57' || v_to;
  END IF;

  v_body := left(btrim(coalesce(_body, '')), 3900);
  v_purpose := left(coalesce(nullif(btrim(_purpose), ''), 'chatbot_reply'), 80);

  IF length(v_to) < 8 THEN
    RETURN jsonb_build_object('error', 'invalid_phone');
  END IF;

  IF v_body = '' THEN
    RETURN jsonb_build_object('error', 'empty_body');
  END IF;

  SELECT id INTO v_existing_id
  FROM public.whatsapp_outbound_queue
  WHERE branch_id = v_branch_id
    AND to_phone = v_to
    AND body = v_body
    AND purpose = v_purpose
    AND status IN ('pending', 'sending')
    AND created_at > now() - interval '45 seconds'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'queued', true, 'deduped', true, 'id', v_existing_id);
  END IF;

  INSERT INTO public.whatsapp_outbound_queue(branch_id, to_phone, body, purpose, status)
  VALUES (v_branch_id, v_to, v_body, v_purpose, 'pending')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'queued', true, 'deduped', false, 'id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.whatsapp_bot_enqueue_reply(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_enqueue_reply(text, text, text, text) TO anon, authenticated, service_role;