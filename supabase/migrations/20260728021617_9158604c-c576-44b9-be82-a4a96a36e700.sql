ALTER TABLE public.whatsapp_ai_carts
  ADD COLUMN IF NOT EXISTS last_inbound_msg_id text,
  ADD COLUMN IF NOT EXISTS last_reply_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_wa_carts_last_msg
  ON public.whatsapp_ai_carts (branch_id, phone, last_inbound_msg_id);

-- Sobrecarga con parámetro opcional _msg_id (mantiene compatibilidad con bots viejos).
CREATE OR REPLACE FUNCTION public.whatsapp_bot_handle_incoming(
  _token text,
  _from text,
  _body text,
  _msg_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_phone_key text;
  v_dup boolean := false;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  v_branch_id := public.whatsapp_bot_resolve_branch_id(_token);
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  IF _msg_id IS NOT NULL AND length(btrim(_msg_id)) > 0 THEN
    v_phone_key := public.whatsapp_bot_contact_key(_from);

    SELECT true INTO v_dup
    FROM public.whatsapp_ai_carts
    WHERE branch_id = v_branch_id
      AND public.whatsapp_bot_contact_key(phone) = v_phone_key
      AND last_inbound_msg_id = _msg_id
      AND updated_at > now() - interval '10 minutes'
    LIMIT 1;

    IF coalesce(v_dup, false) THEN
      RETURN jsonb_build_object(
        'reply', null,
        'skipped', 'duplicate_msg_id',
        'skip_reason', 'duplicate_msg_id',
        'duplicate', true
      );
    END IF;

    -- Marcar msg_id en el carrito (si existe uno reciente) para
    -- deduplicar siguientes reintentos del mismo webhook.
    UPDATE public.whatsapp_ai_carts
       SET last_inbound_msg_id = _msg_id
     WHERE branch_id = v_branch_id
       AND public.whatsapp_bot_contact_key(phone) = v_phone_key
       AND updated_at > now() - interval '30 minutes';
  END IF;

  RETURN public.whatsapp_bot_handle_incoming(_token, _from, _body);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_handle_incoming(text, text, text, text) TO anon, authenticated, service_role;