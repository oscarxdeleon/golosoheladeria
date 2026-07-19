
ALTER TABLE public.whatsapp_bot_config
  ADD COLUMN IF NOT EXISTS pending_command text,
  ADD COLUMN IF NOT EXISTS command_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS command_ack_at timestamptz;

-- Report status now also returns the pending command so the bot can act on it in the next heartbeat
CREATE OR REPLACE FUNCTION public.whatsapp_bot_report_status(_token text, _status text, _qr text DEFAULT NULL::text, _phone text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_cmd text;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;
  IF _status NOT IN ('connected','disconnected','qr','connecting','error') THEN
    RETURN jsonb_build_object('error','invalid_status');
  END IF;

  v_branch_id := public.whatsapp_bot_resolve_branch_id(_token);
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
  WHERE branch_id = v_branch_id
  RETURNING pending_command INTO v_cmd;

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch_id,
    'status', _status,
    'qr_saved', (_status = 'qr' AND NULLIF(_qr, '') IS NOT NULL),
    'pending_command', v_cmd
  );
END;
$function$;

-- Admin/supervisor requests a command for the bot (unlink | reconnect)
CREATE OR REPLACE FUNCTION public.whatsapp_bot_request_command(_branch_id uuid, _command text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'supervisor')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _command NOT IN ('unlink','reconnect') THEN
    RAISE EXCEPTION 'invalid_command';
  END IF;
  UPDATE public.whatsapp_bot_config
  SET pending_command = _command,
      command_requested_at = now(),
      command_ack_at = NULL,
      connection_status = CASE WHEN _command = 'unlink' THEN 'disconnected' ELSE connection_status END,
      qr_code = CASE WHEN _command = 'unlink' THEN NULL ELSE qr_code END,
      connected_phone = CASE WHEN _command = 'unlink' THEN NULL ELSE connected_phone END
  WHERE branch_id = _branch_id;
  RETURN jsonb_build_object('ok', true, 'command', _command);
END;
$function$;

-- Bot acks the command was executed
CREATE OR REPLACE FUNCTION public.whatsapp_bot_ack_command(_token text, _command text)
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
  SET pending_command = NULL,
      command_ack_at = now()
  WHERE branch_id = v_branch_id
    AND pending_command = _command;
  RETURN jsonb_build_object('ok', true);
END;
$function$;
