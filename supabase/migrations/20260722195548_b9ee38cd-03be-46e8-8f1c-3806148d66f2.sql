
-- 1. Extender whatsapp_bot_config con campos para el asistente IA (Fase 1 MVP)
ALTER TABLE public.whatsapp_bot_config
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_sandbox_numbers text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_system_prompt text,
  ADD COLUMN IF NOT EXISTS ai_last_reply_at timestamptz;

-- 2. Tabla ligera de rate-limit por número/día
CREATE TABLE IF NOT EXISTS public.whatsapp_ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  phone text NOT NULL,
  usage_date date NOT NULL DEFAULT current_date,
  reply_count int NOT NULL DEFAULT 0,
  last_reply_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, phone, usage_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_ai_usage TO authenticated;
GRANT ALL ON public.whatsapp_ai_usage TO service_role;

ALTER TABLE public.whatsapp_ai_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_usage_admin_read" ON public.whatsapp_ai_usage
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3. RPC: contexto de sede para armar el prompt de IA (llamada por el endpoint TSS)
CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_context(_token text, _phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_cfg public.whatsapp_bot_config%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_phone_clean text;
  v_authorized boolean := false;
  v_usage_today int := 0;
  v_max_per_day int := 20;
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

  -- Normalizar teléfono: solo dígitos
  v_phone_clean := regexp_replace(coalesce(_phone,''), '[^0-9]', '', 'g');

  -- Sandbox check
  IF v_cfg.ai_sandbox_numbers IS NULL OR array_length(v_cfg.ai_sandbox_numbers,1) IS NULL THEN
    RETURN jsonb_build_object('error','sandbox_empty');
  END IF;

  SELECT true INTO v_authorized
  FROM unnest(v_cfg.ai_sandbox_numbers) AS n
  WHERE regexp_replace(n, '[^0-9]', '', 'g') = v_phone_clean
     OR right(regexp_replace(n, '[^0-9]', '', 'g'), 10) = right(v_phone_clean, 10)
  LIMIT 1;

  IF NOT coalesce(v_authorized, false) THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;

  -- Rate limit: 20 respuestas / día / número
  SELECT reply_count INTO v_usage_today
    FROM public.whatsapp_ai_usage
   WHERE branch_id = v_branch_id
     AND phone = v_phone_clean
     AND usage_date = current_date;

  IF coalesce(v_usage_today, 0) >= v_max_per_day THEN
    RETURN jsonb_build_object('error','rate_limited');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch_id,
    'branch_name', v_branch.name,
    'branch_slug', v_branch.slug,
    'branch_phone', v_cfg.connected_phone,
    'menu_link', 'https://golosoheladeria.vercel.app/menu?sede=' || coalesce(v_branch.slug,''),
    'online_open', public.whatsapp_bot_is_online_open(v_branch_id),
    'physical_open', public.whatsapp_bot_is_physical_open(v_branch_id),
    'system_prompt', v_cfg.ai_system_prompt,
    'phone_clean', v_phone_clean
  );
END;
$$;

-- 4. RPC: registrar respuesta IA enviada (incrementa contador de uso)
CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_record_reply(_token text, _phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_phone_clean text;
BEGIN
  v_branch_id := public.whatsapp_bot_resolve_branch_id(_token);
  IF v_branch_id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;

  v_phone_clean := regexp_replace(coalesce(_phone,''), '[^0-9]', '', 'g');

  INSERT INTO public.whatsapp_ai_usage(branch_id, phone, usage_date, reply_count, last_reply_at)
  VALUES (v_branch_id, v_phone_clean, current_date, 1, now())
  ON CONFLICT (branch_id, phone, usage_date)
  DO UPDATE SET reply_count = public.whatsapp_ai_usage.reply_count + 1,
                last_reply_at = now();

  UPDATE public.whatsapp_bot_config SET ai_last_reply_at = now() WHERE branch_id = v_branch_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 5. Modificar handle_incoming: si NO respondió (reply null y no ignorado) Y IA está habilitada
--    Y el número está en sandbox, devolver use_ai:true para que el bot local llame ai_reply.
--    Reemplazamos por completo la función manteniendo TODA la lógica actual, solo agregando
--    el bloque final antes de los RETURN null.
CREATE OR REPLACE FUNCTION public.whatsapp_bot_handle_incoming(_token text, _from text, _body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_cooldown interval;
  v_last_any timestamptz;
  v_from_clean text;
  v_now timestamptz := now();
  v_phone_digits text;
  v_ai_authorized boolean := false;
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
  UPDATE public.whatsapp_bot_config SET last_seen_at = v_now WHERE branch_id = v_cfg.branch_id;

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
    IF v_normalized = ANY(v_cfg.short_reply_words) THEN
      v_is_short := true;
    END IF;
  END IF;

  v_cooldown := make_interval(hours => greatest(coalesce(v_cfg.greet_cooldown_hours, 24), 1));

  INSERT INTO public.whatsapp_bot_greeted(branch_id, phone, greeted_date, last_greeted_at, last_msg_idx)
  VALUES (v_cfg.branch_id, _from, current_date, 'epoch'::timestamptz, NULL)
  ON CONFLICT (branch_id, phone) DO NOTHING;

  SELECT greatest(
           coalesce(last_greeted_at, 'epoch'::timestamptz),
           coalesce(last_menu_at, 'epoch'::timestamptz),
           coalesce(last_after_hours_at, 'epoch'::timestamptz)
         ),
         last_msg_idx
    INTO v_last_any, v_last_idx
    FROM public.whatsapp_bot_greeted
   WHERE branch_id = v_cfg.branch_id AND phone = _from
   FOR UPDATE;

  -- Helper: comprobar si este número está autorizado para IA (sandbox)
  v_phone_digits := regexp_replace(_from, '[^0-9]', '', 'g');
  IF v_cfg.ai_enabled AND v_cfg.ai_sandbox_numbers IS NOT NULL
     AND array_length(v_cfg.ai_sandbox_numbers,1) > 0 THEN
    SELECT true INTO v_ai_authorized
    FROM unnest(v_cfg.ai_sandbox_numbers) AS n
    WHERE regexp_replace(n, '[^0-9]', '', 'g') = v_phone_digits
       OR right(regexp_replace(n, '[^0-9]', '', 'g'), 10) = right(v_phone_digits, 10)
    LIMIT 1;
    v_ai_authorized := coalesce(v_ai_authorized, false);
  END IF;

  -- Dentro de cooldown fijo: si IA autorizada, DELEGAR a IA (permite conversación continua).
  IF v_last_any IS NOT NULL AND v_last_any > v_now - v_cooldown THEN
    IF v_ai_authorized THEN
      RETURN jsonb_build_object('reply', null, 'use_ai', true);
    END IF;
    RETURN jsonb_build_object('reply', null, 'skipped', 'cooldown');
  END IF;

  v_menu_link := v_public_base || '/menu?sede=' || coalesce(v_branch.slug,'');
  v_online_open   := public.whatsapp_bot_is_online_open(v_cfg.branch_id);
  v_physical_open := public.whatsapp_bot_is_physical_open(v_cfg.branch_id);

  -- Pickup fuera de horario
  IF NOT v_online_open AND v_physical_open AND v_cfg.pickup_after_hours_enabled THEN
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
      UPDATE public.whatsapp_bot_greeted
         SET last_greeted_at = v_now, last_after_hours_at = v_now, last_menu_at = v_now,
             last_msg_idx = v_idx, greeted_date = current_date
       WHERE branch_id = v_cfg.branch_id AND phone = _from;
      RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'pickup_after_hours');
    END IF;
    IF v_ai_authorized THEN RETURN jsonb_build_object('reply', null, 'use_ai', true); END IF;
    RETURN jsonb_build_object('reply', null);
  END IF;

  -- Fuera de horario total
  IF v_cfg.after_hours_enabled AND NOT v_online_open AND NOT v_physical_open THEN
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
      UPDATE public.whatsapp_bot_greeted
         SET last_greeted_at = v_now, last_after_hours_at = v_now, last_menu_at = v_now,
             last_msg_idx = v_idx, greeted_date = current_date
       WHERE branch_id = v_cfg.branch_id AND phone = _from;
      RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', 'after_hours');
    END IF;
    IF v_ai_authorized THEN RETURN jsonb_build_object('reply', null, 'use_ai', true); END IF;
    RETURN jsonb_build_object('reply', null);
  END IF;

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

  IF NOT v_is_short THEN
    v_should_greet := true;
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

  -- Si no hay respuesta fija disponible y la IA está autorizada, delegar
  IF v_reply = '' THEN
    IF v_ai_authorized THEN
      RETURN jsonb_build_object('reply', null, 'use_ai', true);
    END IF;
    RETURN jsonb_build_object('reply', null);
  END IF;

  INSERT INTO public.whatsapp_bot_messages(branch_id, from_number, direction, body, matched_trigger)
  VALUES (v_cfg.branch_id, _from, 'out', v_reply, v_matched_trigger);

  UPDATE public.whatsapp_bot_greeted
     SET last_greeted_at = v_now, last_menu_at = v_now, last_after_hours_at = v_now,
         last_msg_idx = coalesce(v_idx, last_msg_idx), greeted_date = current_date
   WHERE branch_id = v_cfg.branch_id AND phone = _from;

  RETURN jsonb_build_object('reply', v_reply, 'matched_trigger', v_matched_trigger);
END;
$$;
