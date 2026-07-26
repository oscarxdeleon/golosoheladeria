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
  v_same_instance boolean := false;
  v_recent_active_connection boolean := false;
  v_report_is_older_instance boolean := false;
  v_obsolete_report boolean := false;
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

  v_same_instance := v_instance_id IS NOT NULL
    AND v_cfg.active_instance_id IS NOT NULL
    AND v_cfg.active_instance_id = v_instance_id;

  v_recent_active_connection := v_cfg.connection_status = 'connected'
    AND v_cfg.connected_phone IS NOT NULL
    AND coalesce(v_cfg.last_connected_at, v_cfg.last_seen_at) > (v_now - interval '15 minutes');

  v_report_is_older_instance := v_recent_active_connection
    AND NOT v_same_instance
    AND (
      v_instance_id IS NULL
      OR v_cfg.active_instance_id IS NULL
      OR (
        v_cfg.active_instance_started_at IS NOT NULL
        AND v_started_at <= v_cfg.active_instance_started_at
      )
    );

  v_obsolete_report := v_recent_active_connection
    AND NOT v_same_instance
    AND (
      _status <> 'connected'
      OR v_report_is_older_instance
      OR v_instance_id IS NULL
    );

  IF v_obsolete_report THEN
    UPDATE public.whatsapp_bot_config
       SET last_seen_at = v_now
     WHERE branch_id = v_branch_id
     RETURNING pending_command INTO v_cmd;

    RETURN jsonb_build_object(
      'ok', true,
      'branch_id', v_branch_id,
      'status', v_cfg.connection_status,
      'ignored', true,
      'duplicate_instance', true,
      'reason', 'obsolete_instance_report_ignored_version_preserved',
      'active_instance_id', v_cfg.active_instance_id,
      'active_bot_version', v_cfg.bot_version,
      'reported_bot_version', nullif(_version, ''),
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
           active_instance_id = CASE WHEN v_instance_id IS NOT NULL THEN v_instance_id ELSE active_instance_id END,
           active_instance_started_at = CASE WHEN v_instance_id IS NOT NULL THEN v_started_at ELSE active_instance_started_at END
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

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_report_status(text, text, text, text, text, text, timestamptz) TO anon, authenticated, service_role;