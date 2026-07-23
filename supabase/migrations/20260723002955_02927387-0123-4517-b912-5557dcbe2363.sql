
CREATE TABLE IF NOT EXISTS public.whatsapp_bot_faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_bot_faqs_branch ON public.whatsapp_bot_faqs(branch_id, active, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_bot_faqs TO authenticated;
GRANT ALL ON public.whatsapp_bot_faqs TO service_role;

ALTER TABLE public.whatsapp_bot_faqs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_faqs admin/supervisor read"
  ON public.whatsapp_bot_faqs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));

CREATE POLICY "wa_faqs admin/supervisor write"
  ON public.whatsapp_bot_faqs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));

CREATE TRIGGER trg_wa_bot_faqs_updated
  BEFORE UPDATE ON public.whatsapp_bot_faqs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Ampliar el contexto de IA para incluir las FAQs activas de la sede
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
  v_max_per_day int := 20;
  v_flavors jsonb;
  v_products jsonb;
  v_faqs jsonb;
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

  SELECT reply_count INTO v_usage_today
    FROM public.whatsapp_ai_usage
   WHERE branch_id = v_branch_id
     AND phone = v_phone_clean
     AND usage_date = current_date;

  IF coalesce(v_usage_today, 0) >= v_max_per_day THEN
    RETURN jsonb_build_object('error','rate_limited');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'name', m.name,
           'extra_price', CASE WHEN m.price > 0 THEN m.price ELSE null END
         ) ORDER BY m.name), '[]'::jsonb)
    INTO v_flavors
  FROM public.modifiers m
  JOIN public.modifier_groups g ON g.id = m.group_id
  WHERE m.active = true
    AND (m.disabled_branch_ids IS NULL OR NOT (v_branch_id = ANY(m.disabled_branch_ids)))
    AND (m.branch_id IS NULL OR m.branch_id = v_branch_id)
    AND (g.branch_id IS NULL OR g.branch_id = v_branch_id)
    AND g.name ILIKE '%sabor%';

  SELECT coalesce(jsonb_agg(row_to_json(p2)::jsonb), '[]'::jsonb)
    INTO v_products
  FROM (
    SELECT p.name,
           p.price,
           c.name AS category,
           p.is_favorite
    FROM public.products p
    LEFT JOIN public.categories c ON c.id = p.category_id
    WHERE p.active = true
      AND (
        p.available_branch_ids IS NULL
        OR array_length(p.available_branch_ids, 1) IS NULL
        OR v_branch_id = ANY(p.available_branch_ids)
      )
      AND (c.active IS NULL OR c.active = true)
    ORDER BY p.is_favorite DESC NULLS LAST, c.sort_order NULLS LAST, p.name
    LIMIT 40
  ) p2;

  -- FAQs curadas por la sede (Opción 3: few-shot)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'q', f.question,
           'a', f.answer
         ) ORDER BY f.sort_order, f.created_at), '[]'::jsonb)
    INTO v_faqs
  FROM public.whatsapp_bot_faqs f
  WHERE f.branch_id = v_branch_id
    AND f.active = true;

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
    'phone_clean', v_phone_clean,
    'flavors', v_flavors,
    'products', v_products,
    'faqs', v_faqs
  );
END;
$function$;
