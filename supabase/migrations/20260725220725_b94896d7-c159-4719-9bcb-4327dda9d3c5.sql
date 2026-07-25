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
  v_recent_same_instance_connected boolean := false;
  v_recent_active_connection boolean := false;
  v_obsolete_non_connected_report boolean := false;
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

  v_recent_same_instance_connected := v_same_instance
    AND v_cfg.connected_phone IS NOT NULL
    AND v_cfg.last_connected_at > (v_now - interval '2 minutes');

  v_recent_active_connection := v_cfg.connection_status = 'connected'
    AND v_cfg.connected_phone IS NOT NULL
    AND coalesce(v_cfg.last_connected_at, v_cfg.last_seen_at) > (v_now - interval '15 minutes');

  -- Protección anti-flapping real:
  -- Si una instancia activa reciente ya reportó CONNECTED, no permitimos que
  -- procesos viejos, procesos sin instance_id (versiones antiguas) o instancias
  -- distintas pisen el estado con QR/connecting/disconnected/error.
  v_obsolete_non_connected_report := _status <> 'connected'
    AND v_recent_active_connection
    AND (
      v_instance_id IS NULL
      OR v_cfg.active_instance_id IS NULL
      OR v_cfg.active_instance_id <> v_instance_id
      OR (_status = 'qr' AND v_recent_same_instance_connected)
    );

  IF v_obsolete_non_connected_report THEN
    UPDATE public.whatsapp_bot_config
       SET last_seen_at = v_now,
           bot_version = coalesce(nullif(_version, ''), bot_version)
     WHERE branch_id = v_branch_id
     RETURNING pending_command INTO v_cmd;

    RETURN jsonb_build_object(
      'ok', true,
      'branch_id', v_branch_id,
      'status', v_cfg.connection_status,
      'ignored', true,
      'reason', 'obsolete_non_connected_report_ignored',
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

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_context(_token text, _phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_cfg public.whatsapp_bot_config%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_phone_clean text;
  v_authorized boolean := false;
  v_usage_today int := 0;
  v_max_per_day int;
  v_sandbox_empty boolean := true;
  v_menu_link text;
  v_products jsonb := '[]'::jsonb;
  v_faqs jsonb := '[]'::jsonb;
  v_flavor_groups jsonb := '[]'::jsonb;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  v_branch_id := public.whatsapp_bot_resolve_branch_id(_token);
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  SELECT * INTO v_cfg FROM public.whatsapp_bot_config WHERE branch_id = v_branch_id;
  SELECT * INTO v_branch FROM public.branches WHERE id = v_branch_id;

  IF NOT v_cfg.ai_enabled THEN
    RETURN jsonb_build_object('error','ai_disabled');
  END IF;

  v_phone_clean := regexp_replace(coalesce(_phone,''), '[^0-9]', '', 'g');
  v_sandbox_empty := v_cfg.ai_sandbox_numbers IS NULL
                    OR array_length(v_cfg.ai_sandbox_numbers, 1) IS NULL
                    OR array_length(v_cfg.ai_sandbox_numbers, 1) = 0;

  IF coalesce(v_cfg.ai_ordering_enabled, false) THEN
    v_authorized := true;
  ELSIF v_sandbox_empty THEN
    v_authorized := true;
  ELSE
    SELECT true INTO v_authorized
    FROM unnest(v_cfg.ai_sandbox_numbers) AS n
    WHERE regexp_replace(n, '[^0-9]', '', 'g') = v_phone_clean
       OR right(regexp_replace(n, '[^0-9]', '', 'g'), 10) = right(v_phone_clean, 10)
    LIMIT 1;
    v_authorized := coalesce(v_authorized, false);
  END IF;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;

  SELECT reply_count INTO v_usage_today
  FROM public.whatsapp_ai_usage
  WHERE branch_id = v_branch_id
    AND phone = v_phone_clean
    AND usage_date = current_date;

  -- Sin límite artificial por defecto. Solo se aplica si el administrador
  -- configura ai_daily_limit_per_phone con un valor positivo.
  v_max_per_day := NULLIF(v_cfg.ai_daily_limit_per_phone, 0);
  IF v_max_per_day IS NOT NULL AND coalesce(v_usage_today, 0) >= v_max_per_day THEN
    RETURN jsonb_build_object('error','rate_limited', 'usage_today', coalesce(v_usage_today, 0), 'limit', v_max_per_day);
  END IF;

  v_menu_link := coalesce(nullif(v_branch.online_menu_url, ''), 'https://golosoheladeria.vercel.app/menu?sede=' || coalesce(v_branch.slug,''));
  v_menu_link := replace(v_menu_link, 'https://golosoheladeria.lovable.app', 'https://golosoheladeria.vercel.app');
  v_menu_link := replace(v_menu_link, 'https://id-preview--d41c5d74-9f9e-4922-8c68-3a56b9c32d17.lovable.app', 'https://golosoheladeria.vercel.app');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'name', p.name,
           'price', p.price,
           'category', c.name,
           'is_favorite', coalesce(p.is_favorite, false),
           'modifier_group_ids', coalesce(to_jsonb(p.modifier_group_ids), '[]'::jsonb)
         ) ORDER BY coalesce(p.is_favorite, false) DESC, c.sort_order NULLS LAST, p.name), '[]'::jsonb)
  INTO v_products
  FROM public.products p
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE p.active = true
    AND coalesce(p.show_in_online, true) = true
    AND NOT (COALESCE(p.is_linked, false) = true AND p.source_product_id IS NOT NULL)
    AND (p.available_branch_ids IS NULL OR cardinality(p.available_branch_ids) = 0 OR v_branch_id = ANY(p.available_branch_ids));

  SELECT coalesce(jsonb_agg(jsonb_build_object('q', question, 'a', answer) ORDER BY sort_order, created_at), '[]'::jsonb)
  INTO v_faqs
  FROM public.whatsapp_bot_faqs
  WHERE branch_id = v_branch_id
    AND active = true;

  SELECT coalesce(jsonb_agg(group_payload ORDER BY group_name), '[]'::jsonb)
  INTO v_flavor_groups
  FROM (
    SELECT
      mg.name AS group_name,
      jsonb_build_object(
        'group_name', mg.name,
        'flavors', coalesce(jsonb_agg(jsonb_build_object('name', m.name, 'extra_price', m.price) ORDER BY m.name) FILTER (WHERE m.id IS NOT NULL), '[]'::jsonb)
      ) AS group_payload
    FROM public.modifier_groups mg
    JOIN public.modifiers m ON m.group_id = mg.id AND m.active = true
    WHERE (mg.branch_id IS NULL OR mg.branch_id = v_branch_id)
      AND (m.branch_id IS NULL OR m.branch_id = v_branch_id OR m.branch_id = mg.branch_id)
      AND (m.disabled_branch_ids IS NULL OR NOT (v_branch_id = ANY(m.disabled_branch_ids)))
    GROUP BY mg.id, mg.name
  ) grouped;

  RETURN jsonb_build_object(
    'branch_id', v_branch_id,
    'branch_name', coalesce(v_branch.name, 'Goloso'),
    'menu_link', v_menu_link,
    'system_prompt', coalesce(v_cfg.ai_system_prompt, ''),
    'usage_today', coalesce(v_usage_today, 0),
    'daily_limit', v_max_per_day,
    'online_open', public.whatsapp_bot_is_online_open(v_branch_id),
    'physical_open', public.whatsapp_bot_is_physical_open(v_branch_id),
    'products', v_products,
    'faqs', v_faqs,
    'flavor_groups', v_flavor_groups
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_context(text, text) TO anon, authenticated, service_role;