CREATE OR REPLACE FUNCTION public.supervisor_dashboard_rpc(
  _session_token text,
  _branch_id uuid DEFAULT NULL,
  _log_switch boolean DEFAULT false,
  _date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supervisor supervisor_accounts%ROWTYPE;
  v_session supervisor_sessions%ROWTYPE;
  v_branch_id uuid;
  v_target_date date;
  v_tz text := 'America/Bogota';
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
  v_branches jsonb;
  v_summary jsonb;
  v_by_hour jsonb;
  v_by_service jsonb;
  v_by_payment jsonb;
  v_top jsonb;
  v_low jsonb;
  v_active_cash jsonb;
  v_recent jsonb;
BEGIN
  SELECT * INTO v_session FROM supervisor_sessions WHERE session_token = _session_token AND expires_at > now() AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión de supervisor inválida o expirada';
  END IF;
  SELECT * INTO v_supervisor FROM supervisor_accounts WHERE id = v_session.account_id AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Acceso de supervisor no autorizado';
  END IF;

  v_target_date := COALESCE(_date, (now() AT TIME ZONE v_tz)::date);
  v_start := (v_target_date::timestamp) AT TIME ZONE v_tz;
  v_end := ((v_target_date + 1)::timestamp) AT TIME ZONE v_tz;

  IF _branch_id IS NOT NULL THEN
    v_branch_id := _branch_id;
  ELSE
    SELECT id INTO v_branch_id FROM branches WHERE COALESCE(active, true) = true
      ORDER BY is_main DESC NULLS LAST, name ASC LIMIT 1;
  END IF;

  IF _log_switch THEN
    INSERT INTO supervisor_audit_log(account_id, username, event, detail)
    VALUES (v_supervisor.id, v_supervisor.username, 'switch_branch',
      jsonb_build_object('branch_id', v_branch_id, 'date', v_target_date));
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'is_main', COALESCE(is_main,false)) ORDER BY is_main DESC NULLS LAST, name), '[]'::jsonb)
    INTO v_branches
    FROM branches WHERE COALESCE(active, true) = true;

  WITH day_sales AS (
    SELECT * FROM sales
    WHERE branch_id = v_branch_id
      AND created_at >= v_start AND created_at < v_end
  ),
  active_sales AS ( SELECT * FROM day_sales WHERE status <> 'cancelled' ),
  cancelled_sales AS ( SELECT * FROM day_sales WHERE status = 'cancelled' ),
  pay_split AS (
    SELECT LOWER(TRIM(COALESCE(sp->>'method','otro'))) AS method,
      COALESCE((sp->>'amount')::numeric, 0) AS amount
    FROM active_sales s,
    LATERAL jsonb_array_elements(
      CASE WHEN (s.payment_details->>'split')::boolean IS TRUE
             AND jsonb_typeof(s.payment_details->'splits') = 'array'
           THEN s.payment_details->'splits' ELSE '[]'::jsonb END
    ) sp
  ),
  pay_single AS (
    SELECT LOWER(TRIM(COALESCE(payment_method,'otro'))) AS method, total AS amount
    FROM active_sales
    WHERE NOT ((payment_details->>'split')::boolean IS TRUE
      AND jsonb_typeof(payment_details->'splits') = 'array') OR payment_details IS NULL
  ),
  pay_all AS (
    SELECT method, SUM(amount)::numeric AS amount FROM (
      SELECT method, amount FROM pay_split
      UNION ALL SELECT method, amount FROM pay_single
    ) x GROUP BY method
  ),
  totals AS (
    SELECT COALESCE(SUM(total),0)::numeric AS total_sales, COUNT(*)::int AS order_count FROM active_sales
  ),
  cash_sum AS ( SELECT COALESCE(SUM(amount),0)::numeric AS v FROM pay_all WHERE method = 'efectivo' ),
  digital_sum AS ( SELECT COALESCE(SUM(amount),0)::numeric AS v FROM pay_all WHERE method <> 'efectivo' ),
  cancel_agg AS ( SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0)::numeric AS v FROM cancelled_sales ),
  exp_agg AS ( SELECT COALESCE(SUM(amount),0)::numeric AS v FROM expenses
    WHERE branch_id = v_branch_id AND created_at >= v_start AND created_at < v_end ),
  pur_agg AS ( SELECT COALESCE(SUM(total),0)::numeric AS v FROM purchases
    WHERE branch_id = v_branch_id AND created_at >= v_start AND created_at < v_end ),
  dep_agg AS ( SELECT COALESCE(SUM(amount),0)::numeric AS v FROM cash_deposits
    WHERE branch_id = v_branch_id AND created_at >= v_start AND created_at < v_end AND status = 'active' ),
  tables_occ AS ( SELECT COUNT(*)::int AS n FROM restaurant_tables
    WHERE branch_id = v_branch_id AND COALESCE(status,'available') = 'occupied' ),
  preparing_agg AS ( SELECT COUNT(*)::int AS n FROM sales
    WHERE branch_id = v_branch_id AND status IN ('pending','confirmed') ),
  pending_dom AS ( SELECT COUNT(*)::int AS n FROM sales
    WHERE branch_id = v_branch_id AND order_type = 'domicilio' AND status IN ('pending','confirmed','ready') ),
  pending_llevar AS ( SELECT COUNT(*)::int AS n FROM sales
    WHERE branch_id = v_branch_id AND order_type = 'llevar' AND status IN ('pending','confirmed','ready') ),
  tips_agg AS ( SELECT COALESCE(SUM(tip_amount),0)::numeric AS v FROM active_sales )
  SELECT jsonb_build_object(
    'total_sales', t.total_sales,
    'order_count', t.order_count,
    'avg_ticket', CASE WHEN t.order_count > 0 THEN (t.total_sales / t.order_count)::numeric ELSE 0 END,
    'cash_total', cs.v, 'digital_total', ds.v,
    'expenses', ex.v, 'purchases', pu.v, 'deposits', dp.v,
    'entries', dp.v, 'exits', ex.v + pu.v, 'refunds', 0, 'tips', tp.v,
    'cancelled_count', ca.n, 'cancelled_value', ca.v,
    'net_balance', (t.total_sales - ex.v - pu.v + dp.v),
    'tables_occupied', tb.n,
    'pending_llevar', pl.n, 'pending_domicilio', pd.n, 'preparing', pr.n
  ) INTO v_summary
  FROM totals t, cash_sum cs, digital_sum ds, exp_agg ex, pur_agg pu, dep_agg dp,
       cancel_agg ca, tables_occ tb, preparing_agg pr, pending_dom pd, pending_llevar pl, tips_agg tp;

  SELECT COALESCE(jsonb_object_agg(hh, v), '{}'::jsonb) INTO v_by_hour FROM (
    SELECT LPAD(EXTRACT(HOUR FROM (created_at AT TIME ZONE v_tz))::text, 2, '0') AS hh,
           SUM(total)::numeric AS v
    FROM sales WHERE branch_id = v_branch_id AND created_at >= v_start AND created_at < v_end
      AND status <> 'cancelled' GROUP BY 1
  ) q;

  SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) INTO v_by_service FROM (
    SELECT COALESCE(NULLIF(order_type,''), NULLIF(source,''), 'mesa') AS k,
           SUM(total)::numeric AS v
    FROM sales WHERE branch_id = v_branch_id AND created_at >= v_start AND created_at < v_end
      AND status <> 'cancelled' GROUP BY 1
  ) q;

  SELECT COALESCE(jsonb_object_agg(method, amount), '{}'::jsonb) INTO v_by_payment FROM (
    WITH day_sales AS (
      SELECT * FROM sales WHERE branch_id = v_branch_id AND created_at >= v_start AND created_at < v_end
        AND status <> 'cancelled'
    ),
    sp AS (
      SELECT LOWER(TRIM(COALESCE(x->>'method','otro'))) AS method,
             COALESCE((x->>'amount')::numeric,0) AS amount
      FROM day_sales s, LATERAL jsonb_array_elements(
        CASE WHEN (s.payment_details->>'split')::boolean IS TRUE
                  AND jsonb_typeof(s.payment_details->'splits')='array'
             THEN s.payment_details->'splits' ELSE '[]'::jsonb END
      ) x
    ),
    single AS (
      SELECT LOWER(TRIM(COALESCE(payment_method,'otro'))) AS method, total AS amount
      FROM day_sales
      WHERE NOT ((payment_details->>'split')::boolean IS TRUE
                 AND jsonb_typeof(payment_details->'splits')='array') OR payment_details IS NULL
    )
    SELECT method, SUM(amount)::numeric AS amount FROM (
      SELECT * FROM sp UNION ALL SELECT * FROM single
    ) u GROUP BY method
  ) q;

  WITH day_sales AS (
    SELECT id FROM sales WHERE branch_id = v_branch_id AND created_at >= v_start AND created_at < v_end
      AND status <> 'cancelled'
  ),
  agg AS (
    SELECT COALESCE(NULLIF(p.name, ''), TRIM(SPLIT_PART(COALESCE(si.product_name,''), '+', 1))) AS name,
      SUM(COALESCE(si.qty,0))::numeric AS qty,
      SUM(COALESCE(si.subtotal,0))::numeric AS total
    FROM sale_items si
    JOIN day_sales ds ON ds.id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id
    WHERE COALESCE(TRIM(SPLIT_PART(COALESCE(si.product_name,''), '+', 1)), '') <> ''
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'total', total)), '[]'::jsonb)
    INTO v_top FROM (SELECT * FROM agg ORDER BY total DESC LIMIT 5) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'total', total)), '[]'::jsonb)
    INTO v_low FROM (
      WITH day_sales AS (
        SELECT id FROM sales WHERE branch_id = v_branch_id AND created_at >= v_start AND created_at < v_end AND status <> 'cancelled'
      )
      SELECT COALESCE(NULLIF(p.name,''), TRIM(SPLIT_PART(COALESCE(si.product_name,''),'+',1))) AS name,
             SUM(COALESCE(si.qty,0))::numeric AS qty,
             SUM(COALESCE(si.subtotal,0))::numeric AS total
      FROM sale_items si JOIN day_sales ds ON ds.id=si.sale_id LEFT JOIN products p ON p.id=si.product_id
      WHERE COALESCE(TRIM(SPLIT_PART(COALESCE(si.product_name,''),'+',1)),'') <> ''
      GROUP BY 1 ORDER BY total ASC LIMIT 5
    ) t;

  SELECT to_jsonb(cs.*) INTO v_active_cash FROM cash_sessions cs
    WHERE cs.branch_id = v_branch_id AND cs.status = 'open'
    ORDER BY cs.opened_at DESC LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(cs.*) ORDER BY cs.opened_at DESC), '[]'::jsonb)
    INTO v_recent FROM cash_sessions cs
    WHERE cs.branch_id = v_branch_id
      AND ( (cs.closed_at IS NOT NULL AND cs.closed_at >= v_start AND cs.closed_at < v_end)
         OR (cs.opened_at >= v_start AND cs.opened_at < v_end) );

  v_result := jsonb_build_object(
    'supervisor', jsonb_build_object('username', v_supervisor.username, 'display_name', v_supervisor.display_name),
    'branches', v_branches,
    'active_branch_id', v_branch_id,
    'generated_at', now(),
    'scope', jsonb_build_object(
      'kind', CASE WHEN _date IS NULL THEN 'today' ELSE 'date' END,
      'date', v_target_date, 'start_at', v_start, 'end_at', v_end,
      'timezone', v_tz, 'cash_session_id', NULL
    ),
    'summary', v_summary,
    'by_hour', v_by_hour, 'by_service', v_by_service, 'by_payment', v_by_payment,
    'top_products', v_top, 'low_products', v_low,
    'active_cash', v_active_cash, 'recent_closures', v_recent
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.supervisor_dashboard_rpc(text, uuid, boolean, date) TO anon, authenticated, service_role;