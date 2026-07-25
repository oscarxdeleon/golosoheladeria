CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_search_products(_token text, _query text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bid uuid;
  q text;
  q_words text[];
  result jsonb;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  q := public._whatsapp_normalize_text(_query);
  q_words := regexp_split_to_array(trim(q), '\s+');

  WITH candidates AS (
    SELECT
      p.id,
      p.name,
      p.price,
      c.name AS category,
      p.is_favorite,
      COALESCE(p.modifier_group_ids, ARRAY[]::uuid[]) AS modifier_group_ids,
      public._whatsapp_normalize_text(p.name || ' ' || COALESCE(c.name, '')) AS haystack
    FROM public.products p
    LEFT JOIN public.categories c ON c.id = p.category_id
    WHERE p.active
      AND p.show_in_online
      AND NOT (COALESCE(p.is_linked, false) = true AND p.source_product_id IS NOT NULL)
      AND (
        p.branch_id = bid
        OR bid = ANY(COALESCE(p.available_branch_ids, ARRAY[]::uuid[]))
        OR (p.branch_id IS NULL AND p.source_product_id IS NULL)
      )
  ), scored AS (
    SELECT *,
      CASE
        WHEN q = '' THEN 1
        WHEN haystack = q THEN 100
        WHEN haystack LIKE q || '%' THEN 80
        WHEN haystack LIKE '%' || q || '%' THEN 60
        ELSE COALESCE((
          SELECT SUM(CASE WHEN haystack LIKE '%' || w || '%' THEN 12 ELSE 0 END)
          FROM unnest(q_words) AS w
          WHERE length(w) >= 3
        ), 0)
      END + CASE WHEN is_favorite THEN 5 ELSE 0 END AS score
    FROM candidates
  ), picked AS (
    SELECT *
    FROM scored
    WHERE score > 0
    ORDER BY score DESC, name
    LIMIT 12
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'name', name,
    'price', price,
    'category', category,
    'is_favorite', is_favorite,
    'modifier_group_ids', modifier_group_ids
  ) ORDER BY score DESC, name), '[]'::jsonb)
  INTO result
  FROM picked;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_search_products(text, text) TO anon, authenticated, service_role;