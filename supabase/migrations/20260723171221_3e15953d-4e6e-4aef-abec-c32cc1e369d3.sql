
ALTER TABLE public.whatsapp_bot_faqs ALTER COLUMN branch_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_bot_faqs_scope_idx ON public.whatsapp_bot_faqs (branch_id, active);

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
  v_flavor_groups jsonb;
  v_products jsonb;
  v_faqs jsonb;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  v_branch_id := public.whatsapp_bot_resolve_branch_id(_token);
  IF v_branch_id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;

  SELECT * INTO v_cfg FROM public.whatsapp_bot_config WHERE branch_id = v_branch_id;
  SELECT * INTO v_branch FROM public.branches WHERE id = v_branch_id;

  IF NOT v_cfg.ai_enabled THEN RETURN jsonb_build_object('error','ai_disabled'); END IF;

  v_phone_clean := regexp_replace(coalesce(_phone,''), '[^0-9]', '', 'g');

  IF v_cfg.ai_sandbox_numbers IS NULL OR array_length(v_cfg.ai_sandbox_numbers,1) IS NULL THEN
    RETURN jsonb_build_object('error','sandbox_empty');
  END IF;

  SELECT true INTO v_authorized
  FROM unnest(v_cfg.ai_sandbox_numbers) AS n
  WHERE regexp_replace(n, '[^0-9]', '', 'g') = v_phone_clean
     OR right(regexp_replace(n, '[^0-9]', '', 'g'), 10) = right(v_phone_clean, 10)
  LIMIT 1;

  IF NOT coalesce(v_authorized, false) THEN RETURN jsonb_build_object('error','not_authorized'); END IF;

  SELECT reply_count INTO v_usage_today FROM public.whatsapp_ai_usage
   WHERE branch_id = v_branch_id AND phone = v_phone_clean AND usage_date = current_date;

  IF coalesce(v_usage_today, 0) >= v_max_per_day THEN RETURN jsonb_build_object('error','rate_limited'); END IF;

  SELECT coalesce(jsonb_agg(g_row ORDER BY (g_row->>'group_name')), '[]'::jsonb) INTO v_flavor_groups
  FROM (
    SELECT jsonb_build_object(
             'group_name', g.name,
             'flavors', jsonb_agg(jsonb_build_object('name', m.name, 'extra_price', CASE WHEN m.price > 0 THEN m.price ELSE null END) ORDER BY m.name)
           ) AS g_row
    FROM public.modifier_groups g
    JOIN public.modifiers m ON m.group_id = g.id
    WHERE m.active = true
      AND (m.disabled_branch_ids IS NULL OR NOT (v_branch_id = ANY(m.disabled_branch_ids)))
      AND (m.branch_id IS NULL OR m.branch_id = v_branch_id)
      AND (g.branch_id IS NULL OR g.branch_id = v_branch_id)
      AND g.name ILIKE '%sabor%'
    GROUP BY g.id, g.name
  ) sub;

  SELECT coalesce(jsonb_agg(row_to_json(p2)::jsonb), '[]'::jsonb) INTO v_products
  FROM (
    SELECT p.name, p.price, c.name AS category, coalesce(c.sort_order, 999) AS cat_order, p.is_favorite
    FROM public.products p
    LEFT JOIN public.categories c ON c.id = p.category_id
    WHERE p.active = true
      AND (p.available_branch_ids IS NULL OR array_length(p.available_branch_ids, 1) IS NULL OR v_branch_id = ANY(p.available_branch_ids))
      AND (c.active IS NULL OR c.active = true)
    ORDER BY coalesce(c.sort_order, 999), c.name, p.name
  ) p2;

  -- FAQs: combina globales (branch_id IS NULL) + de la sede. Si la sede tiene una
  -- pregunta con el mismo texto normalizado que una global, la sede tiene prioridad.
  WITH candidates AS (
    SELECT f.id, f.question, f.answer, f.sort_order, f.created_at, f.branch_id,
           lower(btrim(regexp_replace(f.question, '\s+', ' ', 'g'))) AS qkey,
           CASE WHEN f.branch_id = v_branch_id THEN 1 ELSE 2 END AS priority
    FROM public.whatsapp_bot_faqs f
    WHERE f.active = true
      AND (f.branch_id = v_branch_id OR f.branch_id IS NULL)
  ),
  chosen AS (
    SELECT DISTINCT ON (qkey) id, question, answer, sort_order, created_at
    FROM candidates
    ORDER BY qkey, priority ASC, sort_order ASC, created_at ASC
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('q', question, 'a', answer) ORDER BY sort_order, created_at), '[]'::jsonb)
    INTO v_faqs FROM chosen;

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
    'flavor_groups', v_flavor_groups,
    'flavors', '[]'::jsonb,
    'products', v_products,
    'faqs', v_faqs
  );
END;
$function$;
