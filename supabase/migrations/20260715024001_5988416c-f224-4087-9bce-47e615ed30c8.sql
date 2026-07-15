CREATE OR REPLACE FUNCTION public.supervisor_dashboard_rpc(
  _session_token text,
  _branch_id uuid DEFAULT NULL,
  _log_switch boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _acct record;
  _branches jsonb;
  _active_branch uuid;
  _active_cash_row public.cash_sessions%ROWTYPE;
  _start_at timestamptz;
  _end_at timestamptz;
  _scope_label text := 'active_cash_session';
  _summary jsonb;
  _by_hour jsonb;
  _by_service jsonb;
  _by_payment jsonb;
  _top_products jsonb;
  _low_products jsonb;
  _active_cash jsonb;
  _recent_closures jsonb;
BEGIN
  SELECT * INTO _acct FROM public.require_supervisor_session_rpc(_session_token) LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'is_main', b.is_main) ORDER BY b.is_main DESC, b.name), '[]'::jsonb)
  INTO _branches
  FROM public.branches b;

  SELECT COALESCE(
    (SELECT b.id FROM public.branches b WHERE b.id = _branch_id LIMIT 1),
    (SELECT b.id FROM public.branches b WHERE b.is_main ORDER BY b.name LIMIT 1),
    (SELECT b.id FROM public.branches b ORDER BY b.name LIMIT 1)
  ) INTO _active_branch;

  IF COALESCE(_log_switch, false) AND _active_branch IS NOT NULL THEN
    INSERT INTO public.supervisor_audit_log(account_id, username, event, detail)
    VALUES (_acct.account_id, _acct.username, 'branch_switch', jsonb_build_object('branch_id', _active_branch));
  END IF;

  SELECT * INTO _active_cash_row
  FROM public.cash_sessions cs
  WHERE cs.branch_id = _active_branch
    AND cs.status = 'open'
  ORDER BY cs.opened_at DESC NULLS LAST
  LIMIT 1;

  IF _active_cash_row.id IS NOT NULL THEN
    _start_at := _active_cash_row.opened_at;
    _end_at := now();
  ELSE
    SELECT * INTO _active_cash_row
    FROM public.cash_sessions cs
    WHERE cs.branch_id = _active_branch
    ORDER BY cs.opened_at DESC NULLS LAST
    LIMIT 1;

    IF _active_cash_row.id IS NOT NULL THEN
      _start_at := _active_cash_row.opened_at;
      _end_at := COALESCE(_active_cash_row.closed_at, now());
      _scope_label := 'latest_cash_session';
    ELSE
      _start_at := ((now() AT TIME ZONE 'America/Bogota')::date AT TIME ZONE 'America/Bogota');
      _end_at := now();
      _scope_label := 'bogota_business_day';
    END IF;
  END IF;

  WITH scoped_sales AS (
    SELECT s.*
    FROM public.sales s
    WHERE s.branch_id = _active_branch
      AND COALESCE(s.status, '') <> 'cancelled'
      AND (
        (_active_cash_row.id IS NOT NULL AND (s.cash_session_id = _active_cash_row.id OR s.created_at >= _start_at))
        OR (_active_cash_row.id IS NULL AND s.created_at >= _start_at AND s.created_at <= _end_at)
      )
  ), cancelled_sales AS (
    SELECT s.*
    FROM public.sales s
    WHERE s.branch_id = _active_branch
      AND s.status = 'cancelled'
      AND (
        (_active_cash_row.id IS NOT NULL AND (s.cash_session_id = _active_cash_row.id OR s.created_at >= _start_at))
        OR (_active_cash_row.id IS NULL AND s.created_at >= _start_at AND s.created_at <= _end_at)
      )
  ), open_orders AS (
    SELECT s.*
    FROM public.sales s
    WHERE s.branch_id = _active_branch
      AND s.status IN ('open', 'pending', 'in_progress', 'ready', 'preparing')
      AND s.created_at >= _start_at
  ), scoped_expenses AS (
    SELECT e.*
    FROM public.expenses e
    WHERE e.branch_id = _active_branch
      AND (
        (_active_cash_row.id IS NOT NULL AND (e.cash_session_id = _active_cash_row.id OR e.created_at >= _start_at))
        OR (_active_cash_row.id IS NULL AND e.created_at >= _start_at AND e.created_at <= _end_at)
      )
  ), scoped_purchases AS (
    SELECT p.*
    FROM public.purchases p
    WHERE p.branch_id = _active_branch
      AND (
        (_active_cash_row.id IS NOT NULL AND (p.cash_session_id = _active_cash_row.id OR p.created_at >= _start_at))
        OR (_active_cash_row.id IS NULL AND p.created_at >= _start_at AND p.created_at <= _end_at)
      )
  ), scoped_deposits AS (
    SELECT cd.*
    FROM public.cash_deposits cd
    WHERE cd.branch_id = _active_branch
      AND COALESCE(cd.status, 'active') <> 'voided'
      AND (
        (_active_cash_row.id IS NOT NULL AND (cd.cash_session_id = _active_cash_row.id OR cd.created_at >= _start_at))
        OR (_active_cash_row.id IS NULL AND cd.created_at >= _start_at AND cd.created_at <= _end_at)
      )
  ), payment_breakdown AS (
    SELECT
      lower(trim(COALESCE(sp.method, ss.payment_method, 'otros'))) AS method,
      COALESCE(sp.amount, ss.total, 0)::numeric AS amount
    FROM scoped_sales ss
    LEFT JOIN LATERAL (
      SELECT NULLIF(trim(e->>'method'), '') AS method,
             COALESCE(NULLIF(e->>'amount', '')::numeric, 0) AS amount
      FROM jsonb_array_elements(COALESCE(ss.payment_details->'splits','[]'::jsonb)) e
      WHERE COALESCE(ss.payment_details->>'split','false') = 'true'
    ) sp ON true
  ), normalized_payments AS (
    SELECT
      CASE
        WHEN method LIKE '%efectivo%' OR method = 'cash' THEN 'Efectivo'
        WHEN method LIKE '%nequi%' THEN 'Nequi'
        WHEN method LIKE '%bancolom%' THEN 'Bancolombia'
        WHEN method LIKE '%tarjeta%' OR method LIKE '%card%' THEN 'Tarjeta'
        WHEN method LIKE '%transfer%' THEN 'Transferencia'
        WHEN method LIKE '%pendiente%' THEN 'Pendiente'
        ELSE COALESCE(NULLIF(initcap(method), ''), 'Otros')
      END AS method,
      amount
    FROM payment_breakdown
  ), expense_totals AS (
    SELECT
      COALESCE(sum(amount) FILTER (WHERE source = 'expense' AND category IN ('ingreso','entrada','propina')), 0) AS entries,
      COALESCE(sum(amount) FILTER (WHERE source = 'expense' AND category IN ('retiro','salida')), 0) AS exits,
      COALESCE(sum(amount) FILTER (WHERE source = 'expense' AND category IN ('devolucion','devolución','reembolso')), 0) AS refunds,
      COALESCE(sum(amount) FILTER (WHERE source = 'purchase' OR (source = 'expense' AND category NOT IN ('ingreso','entrada','propina','retiro','salida','devolucion','devolución','reembolso'))), 0) AS expenses,
      COALESCE(sum(amount) FILTER (WHERE source = 'purchase'), 0) AS purchases
    FROM (
      SELECT 'expense'::text AS source, lower(COALESCE(e.category,'')) AS category, e.amount::numeric AS amount FROM scoped_expenses e
      UNION ALL
      SELECT 'purchase'::text AS source, 'compra'::text AS category, p.total::numeric AS amount FROM scoped_purchases p
    ) x
  ), deposit_totals AS (
    SELECT COALESCE(sum(amount), 0) AS deposits FROM scoped_deposits
  ), payment_totals AS (
    SELECT
      COALESCE(sum(amount) FILTER (WHERE method = 'Efectivo'), 0) AS cash_total,
      COALESCE(sum(amount) FILTER (WHERE method <> 'Efectivo'), 0) AS digital_total
    FROM normalized_payments
  ), sales_totals AS (
    SELECT
      COALESCE(sum(COALESCE(total, 0)), 0) AS total_sales,
      COALESCE(count(*), 0) AS order_count,
      COALESCE(avg(COALESCE(total, 0)), 0) AS avg_ticket,
      COALESCE(sum(COALESCE(tip_amount, 0)), 0) AS tips
    FROM scoped_sales
  ), cancelled_totals AS (
    SELECT COALESCE(count(*), 0) AS cancelled_count, COALESCE(sum(COALESCE(total, 0)), 0) AS cancelled_value
    FROM cancelled_sales
  )
  SELECT jsonb_build_object(
    'total_sales', st.total_sales,
    'order_count', st.order_count,
    'avg_ticket', st.avg_ticket,
    'cash_total', pt.cash_total,
    'digital_total', pt.digital_total,
    'tables_occupied', COALESCE((SELECT count(DISTINCT table_id) FROM open_orders WHERE order_type = 'mesa' AND table_id IS NOT NULL), 0),
    'pending_llevar', COALESCE((SELECT count(*) FROM open_orders WHERE order_type = 'llevar'), 0),
    'pending_domicilio', COALESCE((SELECT count(*) FROM open_orders WHERE order_type = 'domicilio'), 0),
    'preparing', COALESCE((SELECT count(*) FROM open_orders WHERE status IN ('preparing', 'in_progress')), 0),
    'expenses', et.expenses,
    'purchases', et.purchases,
    'deposits', dt.deposits,
    'entries', et.entries,
    'exits', et.exits,
    'refunds', et.refunds,
    'tips', st.tips,
    'cancelled_count', ct.cancelled_count,
    'cancelled_value', ct.cancelled_value,
    'net_balance', st.total_sales + et.entries + dt.deposits - et.exits - et.expenses - et.refunds
  ) INTO _summary
  FROM sales_totals st CROSS JOIN payment_totals pt CROSS JOIN expense_totals et CROSS JOIN deposit_totals dt CROSS JOIN cancelled_totals ct;

  WITH scoped_sales AS (
    SELECT s.*
    FROM public.sales s
    WHERE s.branch_id = _active_branch
      AND COALESCE(s.status, '') <> 'cancelled'
      AND ((_active_cash_row.id IS NOT NULL AND (s.cash_session_id = _active_cash_row.id OR s.created_at >= _start_at)) OR (_active_cash_row.id IS NULL AND s.created_at >= _start_at AND s.created_at <= _end_at))
  )
  SELECT COALESCE(jsonb_object_agg(h, total ORDER BY h), '{}'::jsonb)
  INTO _by_hour
  FROM (
    SELECT to_char(created_at AT TIME ZONE 'America/Bogota', 'HH24') AS h, sum(COALESCE(total, 0)) AS total
    FROM scoped_sales
    GROUP BY 1
  ) q;

  WITH scoped_sales AS (
    SELECT s.*
    FROM public.sales s
    WHERE s.branch_id = _active_branch
      AND COALESCE(s.status, '') <> 'cancelled'
      AND ((_active_cash_row.id IS NOT NULL AND (s.cash_session_id = _active_cash_row.id OR s.created_at >= _start_at)) OR (_active_cash_row.id IS NULL AND s.created_at >= _start_at AND s.created_at <= _end_at))
  )
  SELECT COALESCE(jsonb_object_agg(k, total), '{}'::jsonb)
  INTO _by_service
  FROM (
    SELECT COALESCE(NULLIF(order_type, ''), NULLIF(source, ''), 'otro') AS k, sum(COALESCE(total, 0)) AS total
    FROM scoped_sales
    GROUP BY 1
  ) q;

  WITH scoped_sales AS (
    SELECT s.*
    FROM public.sales s
    WHERE s.branch_id = _active_branch
      AND COALESCE(s.status, '') <> 'cancelled'
      AND ((_active_cash_row.id IS NOT NULL AND (s.cash_session_id = _active_cash_row.id OR s.created_at >= _start_at)) OR (_active_cash_row.id IS NULL AND s.created_at >= _start_at AND s.created_at <= _end_at))
  ), payment_breakdown AS (
    SELECT
      lower(trim(COALESCE(sp.method, scoped_sales.payment_method, 'otros'))) AS method,
      COALESCE(sp.amount, scoped_sales.total, 0)::numeric AS amount
    FROM scoped_sales
    LEFT JOIN LATERAL (
      SELECT NULLIF(trim(e->>'method'), '') AS method,
             COALESCE(NULLIF(e->>'amount', '')::numeric, 0) AS amount
      FROM jsonb_array_elements(COALESCE(scoped_sales.payment_details->'splits','[]'::jsonb)) e
      WHERE COALESCE(scoped_sales.payment_details->>'split','false') = 'true'
    ) sp ON true
  ), normalized AS (
    SELECT
      CASE
        WHEN method LIKE '%efectivo%' OR method = 'cash' THEN 'Efectivo'
        WHEN method LIKE '%nequi%' THEN 'Nequi'
        WHEN method LIKE '%bancolom%' THEN 'Bancolombia'
        WHEN method LIKE '%tarjeta%' OR method LIKE '%card%' THEN 'Tarjeta'
        WHEN method LIKE '%transfer%' THEN 'Transferencia'
        WHEN method LIKE '%pendiente%' THEN 'Pendiente'
        ELSE COALESCE(NULLIF(initcap(method), ''), 'Otros')
      END AS k,
      amount
    FROM payment_breakdown
  )
  SELECT COALESCE(jsonb_object_agg(k, total), '{}'::jsonb)
  INTO _by_payment
  FROM (
    SELECT k, sum(amount) AS total
    FROM normalized
    GROUP BY 1
  ) q;

  WITH scoped_sales AS (
    SELECT s.id
    FROM public.sales s
    WHERE s.branch_id = _active_branch
      AND COALESCE(s.status, '') <> 'cancelled'
      AND ((_active_cash_row.id IS NOT NULL AND (s.cash_session_id = _active_cash_row.id OR s.created_at >= _start_at)) OR (_active_cash_row.id IS NULL AND s.created_at >= _start_at AND s.created_at <= _end_at))
  ), modifier_names AS (
    SELECT lower(trim(m.name)) AS name FROM public.modifiers m WHERE COALESCE(m.active, true) = true
  ), product_totals AS (
    SELECT
      COALESCE(p.id::text, 'name:' || lower(trim(regexp_replace(COALESCE(si.product_name, '—'), '\s*[+(].*$', '')))) AS product_key,
      COALESCE(p.name, NULLIF(trim(regexp_replace(COALESCE(si.product_name, '—'), '\s*[+(].*$', '')), ''), '—') AS name,
      sum(COALESCE(si.qty, 0)) AS qty,
      sum(COALESCE(si.subtotal, COALESCE(si.qty, 0) * COALESCE(si.unit_price, 0))) AS total
    FROM public.sale_items si
    JOIN scoped_sales ss ON ss.id = si.sale_id
    LEFT JOIN public.products p ON p.id = si.product_id
    WHERE COALESCE(si.product_name, '') !~ '^\s*(\+|→|-|·|•)'
      AND NOT EXISTS (SELECT 1 FROM modifier_names mn WHERE mn.name = lower(trim(COALESCE(si.product_name, ''))))
    GROUP BY 1, 2
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'total', total) ORDER BY total DESC, qty DESC, name) FROM (SELECT * FROM product_totals ORDER BY total DESC, qty DESC, name LIMIT 8) t), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'total', total) ORDER BY qty ASC, name) FROM (SELECT * FROM product_totals ORDER BY qty ASC, name LIMIT 5) t), '[]'::jsonb)
  INTO _top_products, _low_products;

  IF _active_cash_row.id IS NOT NULL THEN
    SELECT to_jsonb(c)
    INTO _active_cash
    FROM (
      SELECT
        cs.id, cs.status, cs.opened_at, cs.closed_at, cs.opening_amount,
        cs.counted_amount, cs.expected_amount, cs.difference,
        cs.cash_counted, cs.nequi_counted, cs.bancolombia_counted,
        cs.cash_expected, cs.nequi_expected, cs.bancolombia_expected,
        cs.cash_difference, cs.nequi_difference, cs.bancolombia_difference,
        cs.user_name, cs.user_id, cs.branch_id
      FROM public.cash_sessions cs
      WHERE cs.id = _active_cash_row.id
    ) c;
  ELSE
    _active_cash := NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.opened_at DESC), '[]'::jsonb)
  INTO _recent_closures
  FROM (
    SELECT
      cs.id, cs.status, cs.opened_at, cs.closed_at, cs.opening_amount,
      cs.counted_amount, cs.expected_amount, cs.difference,
      cs.cash_counted, cs.nequi_counted, cs.bancolombia_counted,
      cs.cash_expected, cs.nequi_expected, cs.bancolombia_expected,
      cs.cash_difference, cs.nequi_difference, cs.bancolombia_difference,
      cs.user_name, cs.user_id, cs.branch_id
    FROM public.cash_sessions cs
    WHERE cs.branch_id = _active_branch
    ORDER BY cs.opened_at DESC NULLS LAST
    LIMIT 10
  ) c;

  RETURN jsonb_build_object(
    'supervisor', jsonb_build_object('username', _acct.username, 'display_name', _acct.display_name),
    'branches', COALESCE(_branches, '[]'::jsonb),
    'active_branch_id', _active_branch,
    'generated_at', now(),
    'scope', jsonb_build_object(
      'kind', _scope_label,
      'cash_session_id', _active_cash_row.id,
      'start_at', _start_at,
      'end_at', _end_at,
      'timezone', 'America/Bogota'
    ),
    'summary', COALESCE(_summary, '{}'::jsonb),
    'by_hour', COALESCE(_by_hour, '{}'::jsonb),
    'by_service', COALESCE(_by_service, '{}'::jsonb),
    'by_payment', COALESCE(_by_payment, '{}'::jsonb),
    'top_products', COALESCE(_top_products, '[]'::jsonb),
    'low_products', COALESCE(_low_products, '[]'::jsonb),
    'active_cash', _active_cash,
    'recent_closures', COALESCE(_recent_closures, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.supervisor_dashboard_rpc(text, uuid, boolean) TO anon, authenticated;