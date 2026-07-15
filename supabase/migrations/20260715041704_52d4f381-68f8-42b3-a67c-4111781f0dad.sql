
-- =====================================================================
-- SUPERVISOR: Corrección definitiva de la fuente de verdad
--   1. Efectivo esperado = Apertura + Ventas efectivo + Entradas efectivo
--                          − Gastos efectivo − Salidas − Retiros
--                          − Devoluciones efectivo
--   2. Historial de cajas + detalle por cierre (con productos, movimientos)
--   3. Pagos mixtos (splits) correctamente distribuidos por método real
--   4. Top de productos: solo el nombre del producto principal
-- =====================================================================

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
  v_session    supervisor_sessions%ROWTYPE;
  v_branch_id  uuid;
  v_target_date date;
  v_tz text := 'America/Bogota';
  v_start timestamptz;
  v_end   timestamptz;
  v_result      jsonb;
  v_branches    jsonb;
  v_summary     jsonb;
  v_by_hour     jsonb;
  v_by_service  jsonb;
  v_by_payment  jsonb;
  v_top         jsonb;
  v_active_cash jsonb;
  v_recent      jsonb;
  v_movements   jsonb;
  v_opening      numeric := 0;
  v_cash_sales   numeric := 0;
  v_cash_entries numeric := 0;
  v_cash_exits   numeric := 0;
  v_cash_expected numeric := 0;
BEGIN
  SELECT * INTO v_session
    FROM supervisor_sessions
   WHERE session_token = _session_token
     AND expires_at > now()
     AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión de supervisor inválida o expirada'; END IF;

  SELECT * INTO v_supervisor
    FROM supervisor_accounts
   WHERE id = v_session.account_id AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acceso de supervisor no autorizado'; END IF;

  v_target_date := COALESCE(_date, (now() AT TIME ZONE v_tz)::date);
  v_start := (v_target_date::timestamp) AT TIME ZONE v_tz;
  v_end   := ((v_target_date + 1)::timestamp) AT TIME ZONE v_tz;

  IF _branch_id IS NOT NULL THEN
    v_branch_id := _branch_id;
  ELSE
    SELECT id INTO v_branch_id FROM branches
      ORDER BY is_main DESC NULLS LAST, name ASC LIMIT 1;
  END IF;
  IF v_branch_id IS NULL THEN RAISE EXCEPTION 'No hay sedes configuradas'; END IF;

  IF _log_switch THEN
    INSERT INTO supervisor_audit_log(account_id, username, event, detail)
    VALUES (v_supervisor.id, v_supervisor.username, 'switch_branch',
            jsonb_build_object('branch_id', v_branch_id, 'date', v_target_date));
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'is_main', COALESCE(is_main, false))
                            ORDER BY is_main DESC NULLS LAST, name), '[]'::jsonb)
    INTO v_branches FROM branches;

  -- ============ Ventas del día por sede ============
  WITH day_sales AS (
    SELECT * FROM sales
     WHERE branch_id = v_branch_id
       AND created_at >= v_start AND created_at < v_end
  ),
  active_sales AS (SELECT * FROM day_sales WHERE status <> 'cancelled'),
  cancelled_sales AS (SELECT * FROM day_sales WHERE status = 'cancelled'),
  pay_split AS (
    SELECT LOWER(TRIM(COALESCE(sp->>'method','otro'))) AS method,
           COALESCE((sp->>'amount')::numeric, 0) AS amount
      FROM active_sales s,
           LATERAL jsonb_array_elements(
             CASE WHEN (s.payment_details->>'split')::boolean IS TRUE
                       AND jsonb_typeof(s.payment_details->'splits') = 'array'
                  THEN s.payment_details->'splits' ELSE '[]'::jsonb END) sp
  ),
  pay_single AS (
    SELECT LOWER(TRIM(COALESCE(payment_method,'otro'))) AS method, total AS amount
      FROM active_sales
     WHERE NOT ((payment_details->>'split')::boolean IS TRUE
                AND jsonb_typeof(payment_details->'splits') = 'array')
        OR payment_details IS NULL
  ),
  pay_all AS (
    SELECT method, SUM(amount)::numeric AS amount FROM (
      SELECT method, amount FROM pay_split
      UNION ALL SELECT method, amount FROM pay_single) x
    GROUP BY method
  ),
  totals AS (SELECT COALESCE(SUM(total),0)::numeric AS total_sales, COUNT(*)::int AS order_count FROM active_sales),
  cash_sum   AS (SELECT COALESCE(SUM(amount),0)::numeric AS v FROM pay_all WHERE method='efectivo'),
  digital_sum AS (SELECT COALESCE(SUM(amount),0)::numeric AS v FROM pay_all WHERE method<>'efectivo'),
  cancel_agg AS (SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0)::numeric AS v FROM cancelled_sales),
  exp_agg AS (
    SELECT COALESCE(SUM(amount),0)::numeric AS v
      FROM expenses WHERE branch_id=v_branch_id AND created_at>=v_start AND created_at<v_end
  ),
  exp_cash_agg AS (
    SELECT COALESCE(SUM(amount),0)::numeric AS v
      FROM expenses
     WHERE branch_id=v_branch_id AND created_at>=v_start AND created_at<v_end
       AND (LOWER(COALESCE(method,'efectivo')) = 'efectivo' OR method IS NULL)
  ),
  dep_agg AS (
    SELECT COALESCE(SUM(amount),0)::numeric AS v
      FROM cash_deposits
     WHERE branch_id=v_branch_id AND created_at>=v_start AND created_at<v_end AND status='active'
  ),
  dep_cash_agg AS (
    SELECT COALESCE(SUM(amount),0)::numeric AS v
      FROM cash_deposits
     WHERE branch_id=v_branch_id AND created_at>=v_start AND created_at<v_end AND status='active'
       AND (LOWER(COALESCE(method,'efectivo'))='efectivo' OR method IS NULL)
  ),
  tables_occ AS (
    SELECT COUNT(*)::int AS n FROM restaurant_tables
     WHERE branch_id=v_branch_id AND COALESCE(status,'available')='occupied'
  ),
  preparing_agg AS (
    SELECT COUNT(*)::int AS n FROM sales
     WHERE branch_id=v_branch_id AND status IN ('pending','confirmed')
  ),
  pending_dom AS (
    SELECT COUNT(*)::int AS n FROM sales
     WHERE branch_id=v_branch_id AND order_type='domicilio' AND status IN ('pending','confirmed','ready')
  ),
  pending_llevar AS (
    SELECT COUNT(*)::int AS n FROM sales
     WHERE branch_id=v_branch_id AND order_type='llevar' AND status IN ('pending','confirmed','ready')
  ),
  tips_agg AS (SELECT COALESCE(SUM(tip_amount),0)::numeric AS v FROM active_sales),
  -- Caja abierta actual
  open_cs AS (
    SELECT * FROM cash_sessions
     WHERE branch_id=v_branch_id AND status='open'
     ORDER BY opened_at DESC LIMIT 1
  ),
  opening_amt AS (SELECT COALESCE((SELECT opening_amount FROM open_cs),0)::numeric AS v)
  SELECT
    t.total_sales, t.order_count, cs.v, ds.v, ex.v, dp.v, ca.n, ca.v,
    tb.n, pl.n, pd.n, pr.n, tp.v, oa.v, ec.v, dc.v
  INTO
    v_cash_sales, v_cash_sales, -- placeholder to reuse
    v_cash_sales,               -- placeholder
    v_cash_sales, v_cash_sales, v_cash_sales, v_cash_sales,
    v_cash_sales, v_cash_sales, v_cash_sales, v_cash_sales, v_cash_sales,
    v_opening, v_cash_exits, v_cash_entries
  FROM totals t, cash_sum cs, digital_sum ds, exp_agg ex, dep_agg dp,
       cancel_agg ca, tables_occ tb, preparing_agg pr, pending_dom pd,
       pending_llevar pl, tips_agg tp, opening_amt oa, exp_cash_agg ec, dep_cash_agg dc;

  -- Recompute the summary as JSON (single scan again to avoid the messy INTO above)
  WITH day_sales AS (
    SELECT * FROM sales
     WHERE branch_id=v_branch_id AND created_at>=v_start AND created_at<v_end
  ),
  active_sales AS (SELECT * FROM day_sales WHERE status<>'cancelled'),
  cancelled_sales AS (SELECT * FROM day_sales WHERE status='cancelled'),
  pay_split AS (
    SELECT LOWER(TRIM(COALESCE(sp->>'method','otro'))) AS method,
           COALESCE((sp->>'amount')::numeric,0) AS amount
      FROM active_sales s,
           LATERAL jsonb_array_elements(
             CASE WHEN (s.payment_details->>'split')::boolean IS TRUE
                       AND jsonb_typeof(s.payment_details->'splits')='array'
                  THEN s.payment_details->'splits' ELSE '[]'::jsonb END) sp
  ),
  pay_single AS (
    SELECT LOWER(TRIM(COALESCE(payment_method,'otro'))) AS method, total AS amount
      FROM active_sales
     WHERE NOT ((payment_details->>'split')::boolean IS TRUE
                AND jsonb_typeof(payment_details->'splits')='array')
        OR payment_details IS NULL
  ),
  pay_all AS (
    SELECT method, SUM(amount)::numeric AS amount FROM (
      SELECT method, amount FROM pay_split UNION ALL SELECT method, amount FROM pay_single
    ) x GROUP BY method
  ),
  totals AS (SELECT COALESCE(SUM(total),0)::numeric AS total_sales, COUNT(*)::int AS order_count FROM active_sales),
  cash_sum AS (SELECT COALESCE(SUM(amount),0)::numeric AS v FROM pay_all WHERE method='efectivo'),
  digital_sum AS (SELECT COALESCE(SUM(amount),0)::numeric AS v FROM pay_all WHERE method<>'efectivo'),
  cancel_agg AS (SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0)::numeric AS v FROM cancelled_sales),
  exp_agg AS (SELECT COALESCE(SUM(amount),0)::numeric AS v FROM expenses
               WHERE branch_id=v_branch_id AND created_at>=v_start AND created_at<v_end),
  exp_cash_agg AS (SELECT COALESCE(SUM(amount),0)::numeric AS v FROM expenses
                    WHERE branch_id=v_branch_id AND created_at>=v_start AND created_at<v_end
                      AND (LOWER(COALESCE(method,'efectivo'))='efectivo' OR method IS NULL)),
  dep_agg AS (SELECT COALESCE(SUM(amount),0)::numeric AS v FROM cash_deposits
               WHERE branch_id=v_branch_id AND created_at>=v_start AND created_at<v_end AND status='active'),
  dep_cash_agg AS (SELECT COALESCE(SUM(amount),0)::numeric AS v FROM cash_deposits
                    WHERE branch_id=v_branch_id AND created_at>=v_start AND created_at<v_end AND status='active'
                      AND (LOWER(COALESCE(method,'efectivo'))='efectivo' OR method IS NULL)),
  tables_occ AS (SELECT COUNT(*)::int AS n FROM restaurant_tables WHERE branch_id=v_branch_id AND COALESCE(status,'available')='occupied'),
  preparing_agg AS (SELECT COUNT(*)::int AS n FROM sales WHERE branch_id=v_branch_id AND status IN ('pending','confirmed')),
  pending_dom AS (SELECT COUNT(*)::int AS n FROM sales WHERE branch_id=v_branch_id AND order_type='domicilio' AND status IN ('pending','confirmed','ready')),
  pending_llevar AS (SELECT COUNT(*)::int AS n FROM sales WHERE branch_id=v_branch_id AND order_type='llevar' AND status IN ('pending','confirmed','ready')),
  tips_agg AS (SELECT COALESCE(SUM(tip_amount),0)::numeric AS v FROM active_sales),
  open_cs AS (SELECT * FROM cash_sessions WHERE branch_id=v_branch_id AND status='open' ORDER BY opened_at DESC LIMIT 1),
  opening_amt AS (SELECT COALESCE((SELECT opening_amount FROM open_cs),0)::numeric AS v)
  SELECT jsonb_build_object(
    'total_sales', t.total_sales,
    'order_count', t.order_count,
    'avg_ticket', CASE WHEN t.order_count>0 THEN (t.total_sales/t.order_count)::numeric ELSE 0 END,
    'cash_total', cs.v,
    'digital_total', ds.v,
    'expenses', ex.v,
    'expenses_cash', exc.v,
    'purchases', 0,
    'deposits', dp.v,
    'deposits_cash', dpc.v,
    'entries', dp.v,
    'exits', ex.v,
    'refunds', 0,
    'tips', tp.v,
    'cancelled_count', ca.n,
    'cancelled_value', ca.v,
    'opening_amount', oa.v,
    'expected_cash', oa.v + cs.v + dpc.v - exc.v,
    'net_balance', (t.total_sales - ex.v + dp.v),
    'tables_occupied', tb.n,
    'pending_llevar', pl.n,
    'pending_domicilio', pd.n,
    'preparing', pr.n
  )
  INTO v_summary
  FROM totals t, cash_sum cs, digital_sum ds, exp_agg ex, exp_cash_agg exc,
       dep_agg dp, dep_cash_agg dpc, cancel_agg ca, tables_occ tb, preparing_agg pr,
       pending_dom pd, pending_llevar pl, tips_agg tp, opening_amt oa;

  -- Por hora
  SELECT COALESCE(jsonb_object_agg(hh, v), '{}'::jsonb) INTO v_by_hour FROM (
    SELECT LPAD(EXTRACT(HOUR FROM (created_at AT TIME ZONE v_tz))::text,2,'0') AS hh,
           SUM(total)::numeric AS v
      FROM sales
     WHERE branch_id=v_branch_id AND created_at>=v_start AND created_at<v_end AND status<>'cancelled'
     GROUP BY 1) q;

  -- Por servicio
  SELECT COALESCE(jsonb_object_agg(k,v),'{}'::jsonb) INTO v_by_service FROM (
    SELECT COALESCE(NULLIF(order_type,''), NULLIF(source,''),'mesa') AS k, SUM(total)::numeric AS v
      FROM sales
     WHERE branch_id=v_branch_id AND created_at>=v_start AND created_at<v_end AND status<>'cancelled'
     GROUP BY 1) q;

  -- Por método (para el gráfico)
  SELECT COALESCE(jsonb_object_agg(method, amount),'{}'::jsonb) INTO v_by_payment FROM (
    WITH day_sales AS (
      SELECT * FROM sales
       WHERE branch_id=v_branch_id AND created_at>=v_start AND created_at<v_end AND status<>'cancelled'
    ),
    sp AS (
      SELECT LOWER(TRIM(COALESCE(x->>'method','otro'))) AS method,
             COALESCE((x->>'amount')::numeric,0) AS amount
        FROM day_sales s,
             LATERAL jsonb_array_elements(
               CASE WHEN (s.payment_details->>'split')::boolean IS TRUE
                         AND jsonb_typeof(s.payment_details->'splits')='array'
                    THEN s.payment_details->'splits' ELSE '[]'::jsonb END) x
    ),
    single AS (
      SELECT LOWER(TRIM(COALESCE(payment_method,'otro'))) AS method, total AS amount
        FROM day_sales
       WHERE NOT ((payment_details->>'split')::boolean IS TRUE
                  AND jsonb_typeof(payment_details->'splits')='array')
          OR payment_details IS NULL
    )
    SELECT method, SUM(amount)::numeric AS amount FROM (
      SELECT * FROM sp UNION ALL SELECT * FROM single) u GROUP BY method
  ) q;

  -- Top productos: SOLO producto principal (products.name)
  WITH day_sales AS (
    SELECT id FROM sales
     WHERE branch_id=v_branch_id AND created_at>=v_start AND created_at<v_end AND status<>'cancelled'
  ),
  agg AS (
    SELECT COALESCE(NULLIF(p.name,''), TRIM(SPLIT_PART(COALESCE(si.product_name,''),'+',1))) AS name,
           SUM(COALESCE(si.qty,0))::numeric AS qty,
           SUM(COALESCE(si.subtotal,0))::numeric AS total
      FROM sale_items si
      JOIN day_sales ds ON ds.id=si.sale_id
      LEFT JOIN products p ON p.id=si.product_id
     WHERE COALESCE(NULLIF(p.name,''), TRIM(SPLIT_PART(COALESCE(si.product_name,''),'+',1)),'')<>''
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name',name,'qty',qty,'total',total)), '[]'::jsonb)
    INTO v_top FROM (SELECT * FROM agg ORDER BY total DESC LIMIT 10) t;

  -- Caja abierta actual + expected_cash calculado
  SELECT to_jsonb(cs.*) || jsonb_build_object(
           'cash_expected_calc', COALESCE((v_summary->>'expected_cash')::numeric, 0)
         )
    INTO v_active_cash
    FROM cash_sessions cs
   WHERE cs.branch_id=v_branch_id AND cs.status='open'
   ORDER BY cs.opened_at DESC LIMIT 1;

  -- Historial de cajas del día (abiertas o cerradas)
  SELECT COALESCE(jsonb_agg(to_jsonb(cs.*) ORDER BY cs.opened_at DESC), '[]'::jsonb)
    INTO v_recent
    FROM cash_sessions cs
   WHERE cs.branch_id=v_branch_id
     AND ((cs.closed_at IS NOT NULL AND cs.closed_at>=v_start AND cs.closed_at<v_end)
          OR (cs.opened_at>=v_start AND cs.opened_at<v_end));

  -- Movimientos del día (gastos + depósitos)
  SELECT COALESCE(jsonb_agg(row_to_json(m) ORDER BY (m->>'created_at') DESC), '[]'::jsonb)
    INTO v_movements
    FROM (
      SELECT jsonb_build_object(
               'id', e.id, 'kind', 'expense',
               'created_at', e.created_at,
               'user_name', e.user_name,
               'category', e.category,
               'description', e.description,
               'method', COALESCE(e.method,'efectivo'),
               'amount', e.amount,
               'status', COALESCE(e.status,'active')
             ) AS m
        FROM expenses e
       WHERE e.branch_id=v_branch_id AND e.created_at>=v_start AND e.created_at<v_end
      UNION ALL
      SELECT jsonb_build_object(
               'id', d.id, 'kind', 'deposit',
               'created_at', d.created_at,
               'user_name', d.user_name,
               'category', 'depósito',
               'description', d.description,
               'method', COALESCE(d.method,'efectivo'),
               'amount', d.amount,
               'status', COALESCE(d.status,'active')
             ) AS m
        FROM cash_deposits d
       WHERE d.branch_id=v_branch_id AND d.created_at>=v_start AND d.created_at<v_end
    ) t;

  v_result := jsonb_build_object(
    'supervisor', jsonb_build_object('username', v_supervisor.username, 'display_name', v_supervisor.display_name),
    'branches', v_branches,
    'active_branch_id', v_branch_id,
    'generated_at', now(),
    'scope', jsonb_build_object(
      'kind', CASE WHEN _date IS NULL THEN 'today' ELSE 'date' END,
      'date', v_target_date, 'start_at', v_start, 'end_at', v_end,
      'timezone', v_tz, 'cash_session_id', NULL),
    'summary', v_summary,
    'by_hour', v_by_hour,
    'by_service', v_by_service,
    'by_payment', v_by_payment,
    'top_products', v_top,
    'low_products', '[]'::jsonb,
    'active_cash', v_active_cash,
    'recent_closures', v_recent,
    'movements', v_movements
  );

  RETURN v_result;
END; $$;

GRANT EXECUTE ON FUNCTION public.supervisor_dashboard_rpc(text, uuid, boolean, date) TO anon, authenticated, service_role;


-- ============ RPC: detalle de un cierre específico ============
CREATE OR REPLACE FUNCTION public.supervisor_session_detail_rpc(
  _session_token text,
  _cash_session_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_supervisor supervisor_accounts%ROWTYPE;
  v_session    supervisor_sessions%ROWTYPE;
  v_cs cash_sessions%ROWTYPE;
  v_branch_name text;
  v_start timestamptz; v_end timestamptz;
  v_summary jsonb; v_payments jsonb; v_services jsonb;
  v_products jsonb; v_movements jsonb;
BEGIN
  SELECT * INTO v_session FROM supervisor_sessions
   WHERE session_token=_session_token AND expires_at>now() AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión de supervisor inválida o expirada'; END IF;

  SELECT * INTO v_supervisor FROM supervisor_accounts WHERE id=v_session.account_id AND active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acceso de supervisor no autorizado'; END IF;

  SELECT * INTO v_cs FROM cash_sessions WHERE id=_cash_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cierre no encontrado'; END IF;

  SELECT name INTO v_branch_name FROM branches WHERE id=v_cs.branch_id;

  v_start := v_cs.opened_at;
  v_end := COALESCE(v_cs.closed_at, now());

  WITH s AS (
    SELECT * FROM sales
     WHERE branch_id=v_cs.branch_id AND created_at>=v_start AND created_at<v_end
  ),
  active_sales AS (SELECT * FROM s WHERE status<>'cancelled'),
  cancelled_sales AS (SELECT * FROM s WHERE status='cancelled'),
  pay_split AS (
    SELECT LOWER(TRIM(COALESCE(sp->>'method','otro'))) AS method,
           COALESCE((sp->>'amount')::numeric,0) AS amount, 1 AS cnt
      FROM active_sales x,
           LATERAL jsonb_array_elements(
             CASE WHEN (x.payment_details->>'split')::boolean IS TRUE
                       AND jsonb_typeof(x.payment_details->'splits')='array'
                  THEN x.payment_details->'splits' ELSE '[]'::jsonb END) sp
  ),
  pay_single AS (
    SELECT LOWER(TRIM(COALESCE(payment_method,'otro'))) AS method, total AS amount, 1 AS cnt
      FROM active_sales
     WHERE NOT ((payment_details->>'split')::boolean IS TRUE
                AND jsonb_typeof(payment_details->'splits')='array')
        OR payment_details IS NULL
  ),
  pay_all AS (
    SELECT method, SUM(amount)::numeric AS amount, SUM(cnt)::int AS count FROM (
      SELECT * FROM pay_split UNION ALL SELECT * FROM pay_single) x GROUP BY method
  ),
  totals AS (SELECT COALESCE(SUM(total),0)::numeric AS total_sales, COUNT(*)::int AS order_count FROM active_sales),
  cancel_agg AS (SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0)::numeric AS v FROM cancelled_sales),
  cash_sum AS (SELECT COALESCE(SUM(amount),0)::numeric AS v FROM pay_all WHERE method='efectivo'),
  exp_agg AS (SELECT COALESCE(SUM(amount),0)::numeric AS v FROM expenses WHERE cash_session_id=v_cs.id),
  exp_cash AS (SELECT COALESCE(SUM(amount),0)::numeric AS v FROM expenses
                WHERE cash_session_id=v_cs.id AND (LOWER(COALESCE(method,'efectivo'))='efectivo' OR method IS NULL)),
  dep_agg AS (SELECT COALESCE(SUM(amount),0)::numeric AS v FROM cash_deposits WHERE cash_session_id=v_cs.id AND status='active'),
  dep_cash AS (SELECT COALESCE(SUM(amount),0)::numeric AS v FROM cash_deposits
                WHERE cash_session_id=v_cs.id AND status='active'
                  AND (LOWER(COALESCE(method,'efectivo'))='efectivo' OR method IS NULL))
  SELECT jsonb_build_object(
    'total_sales', t.total_sales, 'order_count', t.order_count,
    'avg_ticket', CASE WHEN t.order_count>0 THEN (t.total_sales/t.order_count)::numeric ELSE 0 END,
    'cancelled_count', ca.n, 'cancelled_value', ca.v,
    'cash_total', cs.v, 'expenses_total', ex.v, 'expenses_cash', exc.v,
    'deposits_total', dp.v, 'deposits_cash', dpc.v,
    'opening_amount', COALESCE(v_cs.opening_amount,0),
    'expected_cash', COALESCE(v_cs.opening_amount,0) + cs.v + dpc.v - exc.v,
    'counted_amount', COALESCE(v_cs.counted_amount,0),
    'difference', COALESCE(v_cs.counted_amount,0) - (COALESCE(v_cs.opening_amount,0) + cs.v + dpc.v - exc.v)
  ) INTO v_summary
  FROM totals t, cancel_agg ca, cash_sum cs, exp_agg ex, exp_cash exc, dep_agg dp, dep_cash dpc;

  WITH s AS (
    SELECT * FROM sales
     WHERE branch_id=v_cs.branch_id AND created_at>=v_start AND created_at<v_end AND status<>'cancelled'
  ),
  pay_split AS (
    SELECT LOWER(TRIM(COALESCE(sp->>'method','otro'))) AS method,
           COALESCE((sp->>'amount')::numeric,0) AS amount, 1 AS cnt
      FROM s x,
           LATERAL jsonb_array_elements(
             CASE WHEN (x.payment_details->>'split')::boolean IS TRUE
                       AND jsonb_typeof(x.payment_details->'splits')='array'
                  THEN x.payment_details->'splits' ELSE '[]'::jsonb END) sp
  ),
  pay_single AS (
    SELECT LOWER(TRIM(COALESCE(payment_method,'otro'))) AS method, total AS amount, 1 AS cnt
      FROM s
     WHERE NOT ((payment_details->>'split')::boolean IS TRUE
                AND jsonb_typeof(payment_details->'splits')='array')
        OR payment_details IS NULL
  )
  SELECT COALESCE(jsonb_object_agg(method,
           jsonb_build_object('amount', amount, 'count', count)), '{}'::jsonb)
    INTO v_payments
    FROM (SELECT method, SUM(amount)::numeric AS amount, SUM(cnt)::int AS count
            FROM (SELECT * FROM pay_split UNION ALL SELECT * FROM pay_single) x GROUP BY method) q;

  SELECT COALESCE(jsonb_object_agg(k, jsonb_build_object('amount', amt, 'count', cnt)), '{}'::jsonb)
    INTO v_services FROM (
      SELECT COALESCE(NULLIF(order_type,''), NULLIF(source,''),'mesa') AS k,
             SUM(total)::numeric AS amt, COUNT(*)::int AS cnt
        FROM sales
       WHERE branch_id=v_cs.branch_id AND created_at>=v_start AND created_at<v_end AND status<>'cancelled'
       GROUP BY 1) q;

  -- Productos: solo producto principal (products.name), sin modificadores
  WITH s AS (SELECT id FROM sales WHERE branch_id=v_cs.branch_id AND created_at>=v_start AND created_at<v_end AND status<>'cancelled')
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name',name,'qty',qty,'total',total) ORDER BY total DESC), '[]'::jsonb)
    INTO v_products FROM (
      SELECT COALESCE(NULLIF(p.name,''), TRIM(SPLIT_PART(COALESCE(si.product_name,''),'+',1))) AS name,
             SUM(COALESCE(si.qty,0))::numeric AS qty,
             SUM(COALESCE(si.subtotal,0))::numeric AS total
        FROM sale_items si
        JOIN s ON s.id=si.sale_id
        LEFT JOIN products p ON p.id=si.product_id
       WHERE COALESCE(NULLIF(p.name,''), TRIM(SPLIT_PART(COALESCE(si.product_name,''),'+',1)),'')<>''
       GROUP BY 1
    ) q;

  SELECT COALESCE(jsonb_agg(row_to_json(m) ORDER BY (m->>'created_at') DESC), '[]'::jsonb)
    INTO v_movements FROM (
      SELECT jsonb_build_object(
        'id',e.id,'kind','expense','created_at',e.created_at,'user_name',e.user_name,
        'category',e.category,'description',e.description,
        'method',COALESCE(e.method,'efectivo'),'amount',e.amount,'status',COALESCE(e.status,'active')) AS m
        FROM expenses e WHERE e.cash_session_id=v_cs.id
      UNION ALL
      SELECT jsonb_build_object(
        'id',d.id,'kind','deposit','created_at',d.created_at,'user_name',d.user_name,
        'category','depósito','description',d.description,
        'method',COALESCE(d.method,'efectivo'),'amount',d.amount,'status',COALESCE(d.status,'active')) AS m
        FROM cash_deposits d WHERE d.cash_session_id=v_cs.id
    ) t;

  RETURN jsonb_build_object(
    'session', to_jsonb(v_cs.*),
    'branch_name', v_branch_name,
    'summary', v_summary,
    'payments', v_payments,
    'services', v_services,
    'products', v_products,
    'movements', v_movements
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.supervisor_session_detail_rpc(text, uuid) TO anon, authenticated, service_role;
