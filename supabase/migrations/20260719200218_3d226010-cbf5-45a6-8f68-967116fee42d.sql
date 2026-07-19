ALTER TABLE public.whatsapp_bot_config
  ADD COLUMN IF NOT EXISTS bot_version text,
  ADD COLUMN IF NOT EXISTS last_outbound_poll_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_poll_status text,
  ADD COLUMN IF NOT EXISTS last_outbound_poll_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_outbound_error text;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_report_outbound_poll(
  _token text,
  _version text DEFAULT NULL::text,
  _poll_status text DEFAULT 'ok'::text,
  _poll_count integer DEFAULT 0,
  _error text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  v_branch_id := public.whatsapp_bot_resolve_branch_id(_token);
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  UPDATE public.whatsapp_bot_config
     SET bot_version = NULLIF(_version, ''),
         last_outbound_poll_at = now(),
         last_outbound_poll_status = COALESCE(NULLIF(_poll_status, ''), 'ok'),
         last_outbound_poll_count = GREATEST(COALESCE(_poll_count, 0), 0),
         last_outbound_error = NULLIF(_error, ''),
         last_seen_at = now()
   WHERE branch_id = v_branch_id;

  RETURN jsonb_build_object('ok', true, 'branch_id', v_branch_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_report_outbound_poll(text, text, text, integer, text) TO anon, authenticated, service_role;

UPDATE public.whatsapp_outbound_queue
   SET status = 'pending'
 WHERE status = 'sending'
   AND sent_at IS NULL
   AND created_at < now() - interval '2 minutes';