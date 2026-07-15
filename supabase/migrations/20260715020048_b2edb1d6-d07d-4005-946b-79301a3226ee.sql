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
  _start_day timestamptz := date_trunc('day', now());
  _summary jsonb;
  _by_hour jsonb;
  _by_service jsonb;
  _by_payment jsonb;
  _top_products jsonb;
  _low_products jsonb;
  _active_cash jsonb;
BEGIN
  SELECT * INTO _acct FROM public.require_supervisor_session_rpc(_session_token) LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'is_main', b.is_main) ORDER BY b.is_main DESC, b.name), '[]'::jsonb)
  INTO _branches
  FROM public.branches b;

  SELECT COALESCE(
    _branch_id,
    (SELECT b.id FROM public.branches b WHERE b.is_main ORDER BY b.name LIMIT 1),
    (SELECT b.id FROM public.branches b ORDER BY b.name LIMIT 1)
  ) INTO _active_branch;

  IF COALESCE(_log_switch, false) AND _active_branch IS NOT NULL THEN
    INSERT INTO public.supervisor_audit_log(account_id, username, event, detail)
    VALUES (_acct.account_id, _acct.username, 'branch_switch', jsonb_build_object('branch_id', _active_branch));
  END IF;

  WITH sales_today AS (
    SELECT *
    FROM public.sales s
    WHERE s.created_at >= _start_day
      AND (_active_branch IS NULL OR s.branch_id = _active_branch)
      AND COALESCE(s.status, '') <> 'cancelled'
  ), open_orders AS (
    SELECT *
    FROM public.sales s
    WHERE (_active_branch IS NULL OR s.branch_id = _active_branch)
      AND s.status IN ('open', 'pending', 'in_progress', 'ready', 'preparing')
  )
  SELECT jsonb_build_object(
    'total_sales', COALESCE((SELECT sum(COALESCE(total, 0)) FROM sales_today), 0),
    'order_count', COALESCE((SELECT count(*) FROM sales_today), 0),
    'avg_ticket', COALESCE((SELECT avg(COALESCE(total, 0)) FROM sales_today), 0),
    'cash_total', COALESCE((SELECT sum(COALESCE(total, 0)) FROM sales_today WHERE lower(COALESCE(payment_method, '')) LIKE '%efectivo%' OR lower(COALESCE(payment_method, '')) = 'cash' OR lower(COALESCE(payment_method, '')) LIKE '%mixto%'), 0),
    'digital_total', COALESCE((SELECT sum(COALESCE(total, 0)) FROM sales_today), 0) - COALESCE((SELECT sum(COALESCE(total, 0)) FROM sales_today WHERE lower(COALESCE(payment_method, '')) LIKE '%efectivo%' OR lower(COALESCE(payment_method, '')) = 'cash' OR lower(COALESCE(payment_method, '')) LIKE '%mixto%'), 0),
    'tables_occupied', COALESCE((SELECT count(DISTINCT table_id) FROM open_orders WHERE order_type = 'mesa' AND table_id IS NOT NULL), 0),
    'pending_llevar', COALESCE((SELECT count(*) FROM open_orders WHERE order_type = 'llevar'), 0),
    'pending_domicilio', COALESCE((SELECT count(*) FROM open_orders WHERE order_type = 'domicilio'), 0),
    'preparing', COALESCE((SELECT count(*) FROM open_orders WHERE status IN ('preparing', 'in_progress')), 0)
  ) INTO _summary;

  WITH sales_today AS (
    SELECT * FROM public.sales s
    WHERE s.created_at >= _start_day
      AND (_active_branch IS NULL OR s.branch_id = _active_branch)
      AND COALESCE(s.status, '') <> 'cancelled'
  )
  SELECT COALESCE(jsonb_object_agg(h, total), '{}'::jsonb)
  INTO _by_hour
  FROM (
    SELECT to_char(created_at, 'HH24') AS h, sum(COALESCE(total, 0)) AS total
    FROM sales_today
    GROUP BY 1
  ) q;

  WITH sales_today AS (
    SELECT * FROM public.sales s
    WHERE s.created_at >= _start_day
      AND (_active_branch IS NULL OR s.branch_id = _active_branch)
      AND COALESCE(s.status, '') <> 'cancelled'
  )
  SELECT COALESCE(jsonb_object_agg(k, total), '{}'::jsonb)
  INTO _by_service
  FROM (
    SELECT COALESCE(order_type, 'otro') AS k, sum(COALESCE(total, 0)) AS total
    FROM sales_today
    GROUP BY 1
  ) q;

  WITH sales_today AS (
    SELECT * FROM public.sales s
    WHERE s.created_at >= _start_day
      AND (_active_branch IS NULL OR s.branch_id = _active_branch)
      AND COALESCE(s.status, '') <> 'cancelled'
  )
  SELECT COALESCE(jsonb_object_agg(k, total), '{}'::jsonb)
  INTO _by_payment
  FROM (
    SELECT COALESCE(payment_method, 'otro') AS k, sum(COALESCE(total, 0)) AS total
    FROM sales_today
    GROUP BY 1
  ) q;

  WITH sales_today AS (
    SELECT id FROM public.sales s
    WHERE s.created_at >= _start_day
      AND (_active_branch IS NULL OR s.branch_id = _active_branch)
      AND COALESCE(s.status, '') <> 'cancelled'
  ), product_totals AS (
    SELECT COALESCE(si.product_name, '—') AS name, sum(COALESCE(si.quantity, 0)) AS qty
    FROM public.sale_items si
    JOIN sales_today st ON st.id = si.sale_id
    GROUP BY 1
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'qty', qty) ORDER BY qty DESC, name) FROM (SELECT * FROM product_totals ORDER BY qty DESC, name LIMIT 5) t), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'qty', qty) ORDER BY qty ASC, name) FROM (SELECT * FROM product_totals ORDER BY qty ASC, name LIMIT 5) t), '[]'::jsonb)
  INTO _top_products, _low_products;

  SELECT to_jsonb(c)
  INTO _active_cash
  FROM (
    SELECT cs.id, cs.status, cs.opened_at, cs.closed_at, cs.opening_amount, cs.user_name, cs.user_id
    FROM public.cash_sessions cs
    WHERE (_active_branch IS NULL OR cs.branch_id = _active_branch)
    ORDER BY cs.opened_at DESC
    LIMIT 1
  ) c;

  RETURN jsonb_build_object(
    'supervisor', jsonb_build_object('username', _acct.username, 'display_name', _acct.display_name),
    'branches', _branches,
    'active_branch_id', _active_branch,
    'generated_at', now(),
    'summary', _summary,
    'by_hour', COALESCE(_by_hour, '{}'::jsonb),
    'by_service', COALESCE(_by_service, '{}'::jsonb),
    'by_payment', COALESCE(_by_payment, '{}'::jsonb),
    'top_products', COALESCE(_top_products, '[]'::jsonb),
    'low_products', COALESCE(_low_products, '[]'::jsonb),
    'active_cash', _active_cash
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.supervisor_dashboard_rpc(text, uuid, boolean) TO anon, authenticated;