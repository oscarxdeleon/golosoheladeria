CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_context(_token text, _phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg public.whatsapp_bot_config%ROWTYPE;
  b public.branches%ROWTYPE;
  today_count int := 0;
  limit_count int := 20;
  allowed_sandbox boolean := false;
  ordering_on boolean := false;
  result jsonb;
BEGIN
  SELECT * INTO cfg
  FROM public.whatsapp_bot_config
  WHERE device_token = _token;

  IF NOT FOUND OR NOT cfg.enabled THEN
    RETURN jsonb_build_object('error', 'bot_disabled');
  END IF;

  IF NOT COALESCE(cfg.ai_enabled, false) THEN
    RETURN jsonb_build_object('error', 'ai_disabled');
  END IF;

  ordering_on := COALESCE(cfg.ai_ordering_enabled, false);
  allowed_sandbox := COALESCE(array_length(cfg.ai_sandbox_numbers, 1), 0) = 0
    OR regexp_replace(COALESCE(_phone, ''), '\D', '', 'g') = ANY(cfg.ai_sandbox_numbers);

  IF NOT allowed_sandbox AND NOT ordering_on THEN
    RETURN jsonb_build_object('error', 'not_in_sandbox');
  END IF;

  SELECT * INTO b FROM public.branches WHERE id = cfg.branch_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'branch_not_found');
  END IF;

  limit_count := COALESCE(cfg.ai_daily_limit_per_phone, cfg.ordering_daily_limit_per_phone, 20);
  SELECT COALESCE(reply_count, 0) INTO today_count
  FROM public.whatsapp_ai_usage
  WHERE branch_id = cfg.branch_id
    AND phone = regexp_replace(COALESCE(_phone, ''), '\D', '', 'g')
    AND usage_date = CURRENT_DATE;

  IF COALESCE(today_count, 0) >= limit_count THEN
    RETURN jsonb_build_object('error', 'rate_limited', 'usage_today', today_count, 'daily_limit', limit_count);
  END IF;

  SELECT jsonb_build_object(
    'branch_id', cfg.branch_id,
    'branch_name', b.name,
    'menu_link', COALESCE(b.online_menu_url, (SELECT menu_link FROM public.settings LIMIT 1), 'https://golosoheladeria.lovable.app/menu'),
    'online_open', true,
    'physical_open', true,
    'system_prompt', cfg.ai_system_prompt,
    'usage_today', COALESCE(today_count, 0),
    'daily_limit', limit_count,
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'price', p.price,
        'category', c.name,
        'is_favorite', p.is_favorite,
        'modifier_group_ids', COALESCE(p.modifier_group_ids, ARRAY[]::uuid[])
      ) ORDER BY p.is_favorite DESC, c.sort_order, p.name)
      FROM public.products p
      LEFT JOIN public.categories c ON c.id = p.category_id
      WHERE p.active
        AND p.show_in_online
        AND COALESCE(p.is_linked, false) = false
        AND (
          p.branch_id = cfg.branch_id
          OR cfg.branch_id = ANY(COALESCE(p.available_branch_ids, ARRAY[]::uuid[]))
          OR (p.branch_id IS NULL AND p.source_product_id IS NULL)
        )
    ), '[]'::jsonb),
    'faqs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('q', question, 'a', answer) ORDER BY sort_order, created_at)
      FROM public.whatsapp_bot_faqs
      WHERE active AND (branch_id = cfg.branch_id OR branch_id IS NULL)
    ), '[]'::jsonb),
    'flavor_groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'group_name', g.name,
        'flavors', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('name', m.name, 'extra_price', m.price) ORDER BY m.name)
          FROM public.modifiers m
          WHERE m.group_id = g.id
            AND m.active
            AND NOT (cfg.branch_id = ANY(COALESCE(m.disabled_branch_ids, ARRAY[]::uuid[])))
        ), '[]'::jsonb)
      ) ORDER BY g.name)
      FROM public.modifier_groups g
      WHERE g.branch_id = cfg.branch_id
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_context(text, text) TO anon, authenticated, service_role;