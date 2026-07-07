CREATE OR REPLACE FUNCTION public.kds_public_pending(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_result jsonb;
BEGIN
  IF p_slug IS NULL OR p_slug = '' THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT id INTO v_branch_id FROM public.branches WHERE slug = p_slug LIMIT 1;
  IF v_branch_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.created_at), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      s.id,
      s.ticket_number,
      s.user_name,
      s.customer_name,
      s.customer_phone,
      s.source,
      s.notes,
      s.order_type,
      s.created_at,
      s.table_id,
      s.delivery_address,
      s.status,
      s.branch_id,
      (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', i.id, 'product_name', i.product_name, 'qty', i.qty,
          'ready_at', i.ready_at, 'modifiers', i.modifiers
        ) ORDER BY i.id), '[]'::jsonb)
        FROM public.sale_items i WHERE i.sale_id = s.id
      ) AS sale_items,
      (
        SELECT jsonb_build_object('number', t.number, 'label', t.label)
        FROM public.restaurant_tables t WHERE t.id = s.table_id
      ) AS restaurant_tables
    FROM public.sales s
    WHERE s.branch_id = v_branch_id
      AND s.status IN ('pending','confirmed')
  ) s;
  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.kds_public_pending(text) TO anon, authenticated;