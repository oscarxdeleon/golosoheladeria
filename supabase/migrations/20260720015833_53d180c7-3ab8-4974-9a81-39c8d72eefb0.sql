
-- 1) Consolidar whatsapp_bot_greeted a un registro por (branch_id, phone)
ALTER TABLE public.whatsapp_bot_greeted
  ADD COLUMN IF NOT EXISTS last_menu_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_after_hours_at timestamptz;

-- Deduplicar antes de cambiar la PK: conservamos la fila más reciente por (branch_id, phone)
CREATE TEMP TABLE _wbg_dedup AS
SELECT DISTINCT ON (branch_id, phone)
  branch_id, phone, greeted_date, last_greeted_at, last_msg_idx,
  last_menu_at, last_after_hours_at
FROM public.whatsapp_bot_greeted
ORDER BY branch_id, phone, last_greeted_at DESC;

DELETE FROM public.whatsapp_bot_greeted;
INSERT INTO public.whatsapp_bot_greeted(branch_id, phone, greeted_date, last_greeted_at, last_msg_idx, last_menu_at, last_after_hours_at)
SELECT branch_id, phone, greeted_date, last_greeted_at, last_msg_idx, last_menu_at, last_after_hours_at FROM _wbg_dedup;

ALTER TABLE public.whatsapp_bot_greeted DROP CONSTRAINT IF EXISTS whatsapp_bot_greeted_pkey;
ALTER TABLE public.whatsapp_bot_greeted ADD PRIMARY KEY (branch_id, phone);

-- 2) Nuevas opciones de configuración por sede
ALTER TABLE public.whatsapp_bot_config
  ADD COLUMN IF NOT EXISTS menu_cooldown_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS after_hours_cooldown_hours integer NOT NULL DEFAULT 24;

-- 3) Reemplazar la función handle_incoming con cooldown por tipo de respuesta
CREATE OR REPLACE FUNCTION public.whatsapp_bot_handle_incoming(_token text, _from text, _body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_cfg public.whatsapp_bot_config%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_normalized text;
  v_trigger text;
  v_matched_trigger text;
  v_should_greet boolean := false;
  v_should_menu boolean := false;
  v_is_short boolean := false;
  v_greeting text;
  v_menu_link text;
  v_menu_msg text;
  v_reply text := '';
  v_idx int;
  v_last_idx int;
  v_len int;
  v_online_open boolean;
  v_physical_open boolean;
  v_after text;
  v_public_base text := 'https://golosoheladeria.vercel.app';
  v_greet_cd interval;
  v_menu_cd interval;
  v_afh_cd interval;
  v_last_greet timestamptz;
  v_last_menu timestamptz;
  v_last_afh timestamptz;
  v_from_clean text;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  v_from_clean := btrim(coalesce(_from,''));
  IF v_from_clean = ''
     OR v_from_clean ILIKE 'status%'
     OR v_from_clean ILIKE '%@broadcast'
     OR v_from_clean ILIKE '%@g.us'
     OR v_from_clean ILIKE '%@newsletter'
     OR v_from_clean !~ '^[0-9]{6,}$' THEN
    RETURN jsonb_build_object('reply', null, 'ignored', true);
  END IF;

  v_branch_id := public.whatsapp_bot_resolve_branch_id(_token);
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  SELECT * INTO v_cfg FROM public.whatsapp_bot_config WHERE branch_id = v_branch_id;
  UPDATE public.whatsapp_bot_config SET last_seen_at = now() WHERE branch_id = v_cfg.branch_id;

  IF NOT v_cfg.enabled THEN
    INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body)
    VALUES (v_cfg.branch_id, _from, 'in', _body);
    RETURN jsonb_build_object('reply', null);
  END IF;

  SELECT * INTO v_branch FROM public.branches WHERE id = v_cfg.branch_id;

  INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body)
  VALUES (v_cfg.branch_id, _from, 'in', _body);

  v_normalized := lower(btrim(coalesce(_body,'')));
  v_normalized := translate(v_normalized, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN');

  IF v_cfg.short_reply_words IS NOT NULL AND array_length(v_cfg.short_reply_words,1) > 0 THEN
    IF v_normalized = ANY(
      SELECT lower(translate(w,'áéíóúÁÉÍÓÚñÑ','aeiouAEIOUnN')) FROM unnest(v_cfg.short_reply_words) AS w
    ) THEN
      v_is_short := true;
    END IF;
  END IF;

  v_greet_cd := make_interval(hours => greatest(coalesce(v_cfg.greet_cooldown_hours,24), 0));
  v_menu_cd  := make_interval(hours => greatest(coalesce(v_cfg.menu_cooldown_hours,24), 0));
  v_afh_cd   := make_interval(hours => greatest(coalesce(v_cfg.after_hours_cooldown_hours,24), 0));

  SELECT last_greeted_at, last_msg_idx, last_menu_at, last_after_hours_at
    INTO v_last_greet, v_last_idx, v_last_menu, v_last_afh
    FROM public.whatsapp_bot_greeted
   WHERE branch_id = v_cfg.branch_id AND phone = _from;

  IF NOT v_is_short AND (v_last_greet IS NULL OR v_last_greet < now() - v_greet_cd) THEN
    v_should_greet := true;
  END IF;

  v_menu_link := v_public_base || '/menu?sede=' || coalesce(v_branch.slug,'');
  v_online_open   := public.whatsapp_bot_is_online_open(v_cfg.branch_id);
  v_physical_open := public.whatsapp_bot_is_physical_open(v_cfg.branch_id);

  -- Pickup fuera de horario (tienda abierta, online cerrado)
  IF NOT v_online_open AND v_physical_open AND v_cfg.pickup_after_hours_enabled THEN
    IF v_last_afh IS NULL OR v_last_afh < now() - v_afh_cd THEN
      v_len := coalesce(array_length(v_cfg.pickup_after_hours_messages,1),0);
      IF v_len > 0 THEN
        IF v_len = 1 THEN v_idx := 1;
        ELSE
          v_idx := 1 + floor(random() * v_len)::int;
          IF v_last_idx IS NOT NULL AND v_idx = v_last_idx THEN
            v_idx := 1 + (v_idx % v_len);
          END IF;
        END IF;
        v_after := replace(v_cfg.pickup_after_hours_messages[v_idx], '{menu_link}', v_menu_link);
        v_reply := v_after;
        INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
        VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'pickup_after_hours');
        INSERT INTO public.whatsapp_bot_greeted(branch_id, phone, greeted_date, last_greeted_at, last_msg_idx, last_after_hours_at)
        VALUES (v_cfg.branch_id, _from, current_date, now(), v_idx, now())
        ON CONFLICT (branch_id, phone) DO UPDATE
          SET last_after_hours_at = excluded.last_after_hours_at,
              last_msg_idx = excluded.last_msg_idx,
              greeted_date = excluded.greeted_date;
        RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'pickup_after_hours');
      END IF;
    END IF;
    RETURN jsonb_build_object('reply', null);
  END IF;

  -- Fuera de horario total
  IF v_cfg.after_hours_enabled AND NOT v_online_open AND NOT v_physical_open THEN
    IF v_last_afh IS NULL OR v_last_afh < now() - v_afh_cd THEN
      v_len := coalesce(array_length(v_cfg.after_hours_messages,1),0);
      IF v_len > 0 THEN
        IF v_len = 1 THEN v_idx := 1;
        ELSE
          v_idx := 1 + floor(random() * v_len)::int;
          IF v_last_idx IS NOT NULL AND v_idx = v_last_idx THEN
            v_idx := 1 + (v_idx % v_len);
          END IF;
        END IF;
        v_after := replace(v_cfg.after_hours_messages[v_idx], '{menu_link}', v_menu_link);
        v_reply := v_after;
        INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
        VALUES (v_cfg.branch_id, _from, 'out', v_reply, 'after_hours');
        INSERT INTO public.whatsapp_bot_greeted(branch_id, phone, greeted_date, last_greeted_at, last_msg_idx, last_after_hours_at)
        VALUES (v_cfg.branch_id, _from, current_date, now(), v_idx, now())
        ON CONFLICT (branch_id, phone) DO UPDATE
          SET last_after_hours_at = excluded.last_after_hours_at,
              last_msg_idx = excluded.last_msg_idx,
              greeted_date = excluded.greeted_date;
        RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'after_hours');
      END IF;
    END IF;
    RETURN jsonb_build_object('reply', null);
  END IF;

  -- Detectar trigger de menú
  IF v_cfg.menu_triggers IS NOT NULL THEN
    FOREACH v_trigger IN ARRAY v_cfg.menu_triggers LOOP
      IF v_trigger IS NOT NULL AND length(v_trigger) > 0
         AND position(lower(translate(v_trigger,'áéíóúÁÉÍÓÚñÑ','aeiouAEIOUnN')) in v_normalized) > 0 THEN
        v_should_menu := true;
        v_matched_trigger := v_trigger;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- Cooldown de menú: si ya se envió menu-link dentro del período, no reenviar
  IF v_should_menu AND v_last_menu IS NOT NULL AND v_last_menu > now() - v_menu_cd THEN
    v_should_menu := false;
  END IF;

  -- Componer bienvenida aleatoria
  IF v_should_greet THEN
    v_len := coalesce(array_length(v_cfg.welcome_messages,1),0);
    IF v_len > 0 THEN
      IF v_len = 1 THEN v_idx := 1;
      ELSE
        v_idx := 1 + floor(random() * v_len)::int;
        IF v_last_idx IS NOT NULL AND v_idx = v_last_idx THEN
          v_idx := 1 + (v_idx % v_len);
        END IF;
      END IF;
      v_greeting := v_cfg.welcome_messages[v_idx];
      v_reply := v_greeting;
    END IF;
  END IF;

  IF v_should_menu THEN
    v_menu_msg := replace(v_cfg.menu_message, '{menu_link}', v_menu_link);
    IF v_reply <> '' THEN
      v_reply := v_reply || E'\n\n' || v_menu_msg;
    ELSE
      v_reply := v_menu_msg;
    END IF;
  END IF;

  IF v_reply = '' THEN
    RETURN jsonb_build_object('reply', null);
  END IF;

  INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
  VALUES (v_cfg.branch_id, _from, 'out', v_reply, v_matched_trigger);

  -- Registrar timestamps por tipo enviado
  INSERT INTO public.whatsapp_bot_greeted(branch_id, phone, greeted_date, last_greeted_at, last_msg_idx, last_menu_at)
  VALUES (
    v_cfg.branch_id,
    _from,
    current_date,
    CASE WHEN v_should_greet THEN now() ELSE coalesce(v_last_greet, 'epoch'::timestamptz) END,
    CASE WHEN v_should_greet THEN v_idx ELSE v_last_idx END,
    CASE WHEN v_should_menu THEN now() ELSE v_last_menu END
  )
  ON CONFLICT (branch_id, phone) DO UPDATE
    SET last_greeted_at = CASE WHEN v_should_greet THEN excluded.last_greeted_at ELSE public.whatsapp_bot_greeted.last_greeted_at END,
        last_msg_idx    = CASE WHEN v_should_greet THEN excluded.last_msg_idx    ELSE public.whatsapp_bot_greeted.last_msg_idx END,
        last_menu_at    = CASE WHEN v_should_menu  THEN excluded.last_menu_at    ELSE public.whatsapp_bot_greeted.last_menu_at END,
        greeted_date    = current_date;

  RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', v_matched_trigger);
END;
$function$;
