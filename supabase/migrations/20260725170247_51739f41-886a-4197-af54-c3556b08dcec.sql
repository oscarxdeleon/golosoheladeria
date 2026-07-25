
CREATE OR REPLACE FUNCTION public.whatsapp_bot_request_command(_branch_id uuid, _command text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
BEGIN
  IF _command NOT IN ('unlink','reconnect','restart','update') THEN
    RAISE EXCEPTION 'invalid_command';
  END IF;

  -- 'update' es solo admin. Los demás: admin o supervisor.
  IF _command = 'update' THEN
    IF NOT public.has_role(_uid,'admin') THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  ELSE
    IF NOT (public.has_role(_uid,'admin') OR public.has_role(_uid,'supervisor')) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  UPDATE public.whatsapp_bot_config
  SET pending_command = _command,
      command_requested_at = now(),
      command_ack_at = NULL,
      connection_status = CASE WHEN _command = 'unlink' THEN 'disconnected' ELSE connection_status END,
      qr_code = CASE WHEN _command = 'unlink' THEN NULL ELSE qr_code END,
      connected_phone = CASE WHEN _command = 'unlink' THEN NULL ELSE connected_phone END
  WHERE branch_id = _branch_id;

  SELECT full_name INTO _uname FROM public.profiles WHERE id = _uid;

  INSERT INTO public.audit_log (entity, entity_id, action, user_id, user_name, branch_id, meta)
  VALUES (
    'whatsapp_bot',
    _branch_id,
    'command:' || _command,
    _uid,
    _uname,
    _branch_id,
    jsonb_build_object('command', _command, 'requested_at', now())
  );

  RETURN jsonb_build_object('ok', true, 'command', _command);
END;
$function$;
