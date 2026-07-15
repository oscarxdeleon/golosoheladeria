CREATE OR REPLACE FUNCTION public._shared_cash_session_detail(_cash_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cs public.cash_sessions%ROWTYPE;
  v_result jsonb;
  v_payments jsonb;
  v_services jsonb;
  v_products jsonb;
  v_entradas jsonb;
  v_salidas jsonb;
  v_devoluciones jsonb;
  v_deposits jsonb;
  v_summary jsonb;
  v_sale_ids uuid[] := ARRAY[]::uuid[];
  v_sales_total numeric := 0;
  v_tx_count integer := 0;
  v_cancelled integer := 0;
  v_cancelled_value numeric := 0;
  v_cash_sales numeric := 0;
  v_entries_cash numeric := 0;
  v_cash_expense_out numeric := 0;
  v_cash_purchases_out numeric := 0;
  v_expected numeric := 0;
  v_declared numeric := 0;
  v_diff numeric := 0;
  v_branch_name text;
BEGIN
  SELECT * INTO cs FROM public.cash_sessions WHERE id = _cash_session_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_branch_name FROM public.branches WHERE id = cs.branch_id;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
  INTO v_sale_ids
  FROM (
    SELECT DISTINCT id
    FROM (
      SELECT id
      FROM public.sales
      WHERE cash_session_id = cs.id
      UNION ALL
      SELECT id
      FROM public.sales
      WHERE branch_id = cs.branch_id
        AND created_at >= cs.opened_at
        AND (cs.closed_at IS NULL OR created_at <= cs.closed_at)
    ) scoped_sales
  ) sale_ids;

  SELECT
    COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE status <> 'cancelled'),
    COUNT(*) FILTER (WHERE status = 'cancelled'),
    COALESCE(SUM(CASE WHEN status = 'cancelled' THEN total ELSE 0 END), 0)
  INTO v_sales_total, v_tx_count, v_cancelled, v_cancelled_value
  FROM public.sales
  WHERE id = ANY(v_sale_ids);

  WITH exploded AS (
    SELECT
      sale.id,
      CASE
        WHEN sale.payment_details ? 'split'
          AND (sale.payment_details->>'split')::boolean = true
          AND jsonb_typeof(sale.payment_details->'splits') = 'array'
          THEN public._normalize_payment_method(split_elem->>'method')
        ELSE public._normalize_payment_method(sale.payment_method)
      END AS method_key,
      CASE
        WHEN sale.payment_details ? 'split'
          AND (sale.payment_details->>'split')::boolean = true
          AND jsonb_typeof(sale.payment_details->'splits') = 'array'
          THEN COALESCE((split_elem->>'amount')::numeric, 0)
        ELSE COALESCE(sale.total, 0)
      END AS amount,
      ROW_NUMBER() OVER (PARTITION BY sale.id) AS rn
    FROM public.sales sale
    LEFT JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN sale.payment_details ? 'split'
          AND (sale.payment_details->>'split')::boolean = true
          AND jsonb_typeof(sale.payment_details->'splits') = 'array'
          THEN sale.payment_details->'splits'
        ELSE '[null]'::jsonb
      END
    ) split_elem ON true
    WHERE sale.id = ANY(v_sale_ids)
      AND sale.status <> 'cancelled'
  )
  SELECT COALESCE(jsonb_object_agg(method_key, jsonb_build_object('amount', amount_sum, 'count', cnt)), '{}'::jsonb)
  INTO v_payments
  FROM (
    SELECT method_key,
           SUM(amount) AS amount_sum,
           SUM(CASE WHEN rn = 1 THEN 1 ELSE 0 END) AS cnt
    FROM exploded
    GROUP BY method_key
  ) payment_totals;

  v_cash_sales := COALESCE((v_payments->'efectivo'->>'amount')::numeric, 0);

  SELECT COALESCE(jsonb_object_agg(k, jsonb_build_object('amount', amt, 'count', cnt)), '{}'::jsonb)
  INTO v_services
  FROM (
    SELECT COALESCE(NULLIF(order_type, ''), NULLIF(source, ''), 'mesa') AS k,
           SUM(total) AS amt,
           COUNT(*) AS cnt
    FROM public.sales
    WHERE id = ANY(v_sale_ids)
      AND status <> 'cancelled'
    GROUP BY 1
  ) service_totals;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'total', total)
                            ORDER BY qty DESC, name ASC), '[]'::jsonb)
  INTO v_products
  FROM (
    SELECT
      COALESCE(
        p.name,
        TRIM(split_part(REGEXP_REPLACE(si.product_name, '\s*[(].*$', ''), '+', 1))
      ) AS name,
      SUM(si.qty)::numeric AS qty,
      SUM(si.subtotal)::numeric AS total
    FROM public.sale_items si
    JOIN public.sales sale ON sale.id = si.sale_id AND sale.status <> 'cancelled'
    LEFT JOIN public.products p ON p.id = si.product_id
    WHERE sale.id = ANY(v_sale_ids)
      AND COALESCE(si.product_name, '') !~ '^\s*[+→\-·•]'
      AND NOT EXISTS (
        SELECT 1
        FROM public.modifiers m
        WHERE LOWER(TRIM(m.name)) = LOWER(TRIM(si.product_name))
      )
    GROUP BY 1
  ) product_totals;

  WITH cats AS (
    SELECT id, LOWER(COALESCE(category, '')) AS c, amount, payment_method, description, category, user_name, created_at
    FROM public.expenses
    WHERE cash_session_id = cs.id
      AND branch_id = cs.branch_id
  )
  SELECT
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'kind', 'entrada', 'amount', amount, 'category', category, 'description', description,
        'method', payment_method, 'user_name', user_name, 'created_at', created_at) ORDER BY created_at), '[]'::jsonb)
     FROM cats WHERE c IN ('ingreso', 'entrada', 'propina')),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'kind', 'salida', 'amount', amount, 'category', category, 'description', description,
        'method', payment_method, 'user_name', user_name, 'created_at', created_at) ORDER BY created_at), '[]'::jsonb)
     FROM cats WHERE c IN ('retiro', 'salida') OR c NOT IN ('ingreso', 'entrada', 'propina', 'devolucion', 'devolución', 'reembolso')),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'kind', 'devolucion', 'amount', amount, 'category', category, 'description', description,
        'method', payment_method, 'user_name', user_name, 'created_at', created_at) ORDER BY created_at), '[]'::jsonb)
     FROM cats WHERE c IN ('devolucion', 'devolución', 'reembolso'))
  INTO v_entradas, v_salidas, v_devoluciones;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'kind', 'deposit', 'amount', amount, 'description', description, 'method', method,
    'user_name', user_name, 'status', status, 'created_at', created_at) ORDER BY created_at), '[]'::jsonb)
  INTO v_deposits
  FROM public.cash_deposits
  WHERE cash_session_id = cs.id
    AND branch_id = cs.branch_id
    AND status = 'active';

  SELECT COALESCE(SUM(amount), 0)
  INTO v_entries_cash
  FROM public.cash_deposits
  WHERE cash_session_id = cs.id
    AND branch_id = cs.branch_id
    AND status = 'active'
    AND public._normalize_payment_method(COALESCE(method, 'efectivo')) = 'efectivo';

  SELECT COALESCE(SUM(amount), 0)
  INTO v_cash_expense_out
  FROM public.expenses
  WHERE cash_session_id = cs.id
    AND branch_id = cs.branch_id
    AND public._normalize_payment_method(COALESCE(payment_method, 'efectivo')) = 'efectivo';

  SELECT COALESCE(SUM(total), 0)
  INTO v_cash_purchases_out
  FROM public.purchases
  WHERE cash_session_id = cs.id
    AND branch_id = cs.branch_id
    AND public._normalize_payment_method(COALESCE(payment_method, 'efectivo')) = 'efectivo';

  v_expected := COALESCE(
    cs.expected_amount,
    COALESCE(cs.opening_amount, 0) + v_cash_sales + v_entries_cash - (v_cash_expense_out + v_cash_purchases_out)
  );
  v_declared := COALESCE(cs.counted_amount, 0);
  v_diff := v_declared - v_expected;

  v_summary := jsonb_build_object(
    'total_sales', v_sales_total,
    'order_count', v_tx_count,
    'avg_ticket', CASE WHEN v_tx_count > 0 THEN v_sales_total / v_tx_count ELSE 0 END,
    'cancelled_count', v_cancelled,
    'cancelled_value', v_cancelled_value,
    'cash_sales', v_cash_sales,
    'entries_cash', v_entries_cash,
    'expenses_cash', v_cash_expense_out,
    'purchases_cash', v_cash_purchases_out,
    'opening_amount', COALESCE(cs.opening_amount, 0),
    'expected_cash', v_expected,
    'counted_amount', v_declared,
    'difference', v_diff,
    'nequi_counted', COALESCE(cs.nequi_counted, 0),
    'bancolombia_counted', COALESCE(cs.bancolombia_counted, 0)
  );

  v_result := jsonb_build_object(
    'session', jsonb_build_object(
      'id', cs.id,
      'branch_id', cs.branch_id,
      'branch_name', v_branch_name,
      'opened_at', cs.opened_at,
      'closed_at', cs.closed_at,
      'opening_amount', cs.opening_amount,
      'counted_amount', cs.counted_amount,
      'expected_amount', cs.expected_amount,
      'difference', cs.difference,
      'user_name', cs.user_name,
      'status', cs.status,
      'opening_notes', cs.opening_notes,
      'closing_notes', cs.closing_notes
    ),
    'summary', v_summary,
    'payments', v_payments,
    'services', v_services,
    'products', v_products,
    'entradas', v_entradas,
    'salidas', v_salidas,
    'devoluciones', v_devoluciones,
    'deposits', v_deposits
  );

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cash_session_detail_rpc(_cash_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'supervisor')
  ) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN public._shared_cash_session_detail(_cash_session_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public._shared_cash_session_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cash_session_detail_rpc(uuid) TO authenticated;