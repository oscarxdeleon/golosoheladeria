CREATE OR REPLACE FUNCTION public.whatsapp_bot_report_status(
  _token text,
  _status text,
  _qr text DEFAULT NULL::text,
  _phone text DEFAULT NULL::text,
  _version text DEFAULT NULL::text,
  _instance_id text DEFAULT NULL::text,
  _started_at timestamptz DEFAULT NULL::timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_cmd text;
  v_cfg public.whatsapp_bot_config%ROWTYPE;
  v_now timestamptz := now();
  v_instance_id text := nullif(btrim(coalesce(_instance_id, '')), '');
  v_started_at timestamptz := coalesce(_started_at, v_now);
  v_recent_connected boolean := false;
  v_is_stale_instance boolean := false;
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

  SELECT * INTO v_cfg
    FROM public.whatsapp_bot_config
   WHERE branch_id = v_branch_id
   FOR UPDATE;

  v_recent_connected := v_cfg.connected_phone IS NOT NULL
    AND (
      v_cfg.connection_status = 'connected'
      OR v_cfg.last_connected_at > (v_now - interval '15 minutes')
    );

  v_is_stale_instance := v_instance_id IS NOT NULL
    AND v_cfg.active_instance_id IS NOT NULL
    AND v_cfg.active_instance_id <> v_instance_id
    AND v_recent_connected;

  -- Un proceso viejo/duplicado puede generar QR aunque otro proceso ya esté conectado.
  -- Nunca dejamos que ese QR sobreescriba una conexión real reciente.
  IF _status = 'qr' AND v_recent_connected THEN
    UPDATE public.whatsapp_bot_config
       SET connection_status = CASE WHEN connection_status = 'qr' THEN 'connected' ELSE connection_status END,
           qr_code = NULL,
           bot_version = coalesce(nullif(_version, ''), bot_version),
           last_seen_at = CASE WHEN connection_status = 'connected' THEN v_now ELSE last_seen_at END
     WHERE branch_id = v_branch_id
     RETURNING pending_command INTO v_cmd;

    RETURN jsonb_build_object(
      'ok', true,
      'branch_id', v_branch_id,
      'status', 'connected',
      'ignored', true,
      'reason', CASE WHEN v_is_stale_instance THEN 'stale_instance_qr_ignored' ELSE 'recent_connected_qr_ignored' END,
      'pending_command', v_cmd
    );
  END IF;

  IF _status = 'connected' THEN
    UPDATE public.whatsapp_bot_config
       SET connection_status = 'connected',
           qr_code = NULL,
           connected_phone = coalesce(NULLIF(_phone, ''), connected_phone),
           last_seen_at = v_now,
           last_connected_at = v_now,
           bot_version = coalesce(nullif(_version, ''), bot_version),
           active_instance_id = coalesce(v_instance_id, active_instance_id),
           active_instance_started_at = CASE WHEN v_instance_id IS NOT NULL THEN v_started_at ELSE active_instance_started_at END
     WHERE branch_id = v_branch_id
     RETURNING pending_command INTO v_cmd;
  ELSE
    UPDATE public.whatsapp_bot_config
       SET connection_status = _status,
           qr_code = CASE WHEN _status = 'qr' THEN NULLIF(_qr, '') ELSE NULL END,
           qr_generated_at = CASE WHEN _status = 'qr' AND NULLIF(_qr, '') IS NOT NULL THEN v_now ELSE qr_generated_at END,
           last_seen_at = v_now,
           bot_version = coalesce(nullif(_version, ''), bot_version),
           active_instance_id = CASE
             WHEN _status IN ('qr','connecting') AND (active_instance_id IS NULL OR NOT v_recent_connected) THEN coalesce(v_instance_id, active_instance_id)
             ELSE active_instance_id
           END,
           active_instance_started_at = CASE
             WHEN _status IN ('qr','connecting') AND v_instance_id IS NOT NULL AND (active_instance_id IS NULL OR NOT v_recent_connected) THEN v_started_at
             ELSE active_instance_started_at
           END
     WHERE branch_id = v_branch_id
     RETURNING pending_command INTO v_cmd;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch_id,
    'status', _status,
    'qr_saved', (_status = 'qr' AND NULLIF(_qr, '') IS NOT NULL),
    'pending_command', v_cmd
  );
END;
$function$;

UPDATE public.whatsapp_bot_config
   SET connection_status = 'connected',
       qr_code = NULL
 WHERE connected_phone IS NOT NULL
   AND last_connected_at > now() - interval '15 minutes'
   AND connection_status = 'qr';

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_report_status(text, text, text, text, text, text, timestamptz) TO anon, authenticated;
