CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_context(_token text, _phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_branch_id uuid;
  v_cfg public.whatsapp_bot_config%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_phone_clean text;
  v_authorized boolean := false;
  v_usage_today int := 0;
  v_max_per_day int := 20;
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

  IF v_sandbox_empty THEN
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

  IF coalesce(v_usage_today, 0) >= v_max_per_day THEN
    RETURN jsonb_build_object('error','rate_limited');
  END IF;

  v_menu_link := coalesce(nullif(v_branch.online_menu_url, ''), 'https://golosoheladeria.lovable.app/menu?sede=' || coalesce(v_branch.slug,''));
  v_menu_link := replace(v_menu_link, 'https://golosoheladeria.vercel.app', 'https://golosoheladeria.lovable.app');

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
        AND (m.branch_id IS NULL OR m.branch_id = v_branch_id)
        AND (m.disabled_branch_ids IS NULL OR NOT (v_branch_id = ANY(m.disabled_branch_ids)))
        AND lower(mg.name) ~ '(sabor|sabores|helado|jugo|malteada)'
      GROUP BY mg.id, mg.name
    ) s;

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch_id,
    'branch_name', v_branch.name,
    'branch_slug', v_branch.slug,
    'branch_phone', v_cfg.connected_phone,
    'menu_link', v_menu_link,
    'online_open', public.whatsapp_bot_is_online_open(v_branch_id),
    'physical_open', public.whatsapp_bot_is_physical_open(v_branch_id),
    'system_prompt', v_cfg.ai_system_prompt,
    'phone_clean', v_phone_clean,
    'usage_today', coalesce(v_usage_today, 0),
    'daily_limit', v_max_per_day,
    'products', v_products,
    'faqs', v_faqs,
    'flavor_groups', v_flavor_groups
  );
END;
$$;

UPDATE public.whatsapp_bot_config
   SET pending_command = NULL
 WHERE pending_command IN ('update','restart')
   AND coalesce(bot_version, '') < '8.17.1';