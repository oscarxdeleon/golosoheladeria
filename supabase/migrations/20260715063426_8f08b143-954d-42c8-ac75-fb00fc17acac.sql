
-- ============================================================
-- FASE 1: Rework del Supervisor. Única fuente de verdad.
-- ============================================================

-- 1) Simplificar cuenta Supervisor (login = display_name + pin)
ALTER TABLE public.supervisor_accounts ALTER COLUMN username DROP NOT NULL;
ALTER TABLE public.supervisor_accounts ALTER COLUMN access_token DROP NOT NULL;

-- Nombres únicos, case-insensitive
CREATE UNIQUE INDEX IF NOT EXISTS supervisor_accounts_display_name_lower_key
  ON public.supervisor_accounts (LOWER(display_name)) WHERE active = true;

-- Añadir columnas de auditoría de sesión
ALTER TABLE public.supervisor_sessions
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS current_branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

ALTER TABLE public.supervisor_audit_log
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

-- ============================================================
-- 2) Utilidad: normalizar método de pago (igual al cliente)
-- ============================================================
CREATE OR REPLACE FUNCTION public._normalize_payment_method(_m text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _m IS NULL OR btrim(_m) = '' THEN 'otros'
    WHEN lower(_m) LIKE '%efectivo%' OR lower(_m) = 'cash' THEN 'efectivo'
    WHEN lower(_m) LIKE '%nequi%' THEN 'nequi'
    WHEN lower(_m) LIKE '%bancolom%' THEN 'bancolombia'
    WHEN lower(_m) LIKE '%tarjeta%' OR lower(_m) LIKE '%card%' THEN 'tarjeta'
    WHEN lower(_m) LIKE '%transfer%' THEN 'transferencia'
    WHEN lower(_m) IN ('mixto','split','splits') OR lower(_m) LIKE '%dividido%' OR lower(_m) LIKE '%combinado%' THEN 'mixto'
    ELSE lower(btrim(_m))
  END
$$;

-- ============================================================
-- 3) Función compartida: detalle de un cierre de caja
--    Replica reportes.cajas_.$id.tsx + reports.ts
-- ============================================================
CREATE OR REPLACE FUNCTION public._shared_cash_session_detail(_cash_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.cash_sessions%ROWTYPE;
  v_result jsonb;
  v_payments jsonb; v_services jsonb; v_products jsonb;
  v_entradas jsonb; v_salidas jsonb; v_devoluciones jsonb; v_deposits jsonb;
  v_summary jsonb;
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
  SELECT * INTO s FROM cash_sessions WHERE id = _cash_session_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT name INTO v_branch_name FROM branches WHERE id = s.branch_id;

  -- Ventas del cierre: linked (cash_session_id) UNION scoped por rango
  CREATE TEMP TABLE _sess_sales ON COMMIT DROP AS
  SELECT DISTINCT ON (id) *
  FROM (
    SELECT * FROM sales WHERE cash_session_id = s.id
    UNION ALL
    SELECT * FROM sales
      WHERE branch_id = s.branch_id
        AND created_at >= s.opened_at
        AND (s.closed_at IS NULL OR created_at <= s.closed_at)
  ) x
  ORDER BY id, created_at DESC;

  -- Totales generales
  SELECT
    COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE status <> 'cancelled'),
    COUNT(*) FILTER (WHERE status = 'cancelled'),
    COALESCE(SUM(CASE WHEN status = 'cancelled' THEN total ELSE 0 END), 0)
  INTO v_sales_total, v_tx_count, v_cancelled, v_cancelled_value
  FROM _sess_sales;

  -- Payment breakdown (soporta splits en payment_details.splits[])
  WITH exploded AS (
    SELECT
      s.id,
      CASE
        WHEN s.payment_details ? 'split' AND (s.payment_details->>'split')::boolean = true
             AND jsonb_typeof(s.payment_details->'splits') = 'array'
          THEN _normalize_payment_method(split_elem->>'method')
        ELSE _normalize_payment_method(s.payment_method)
      END AS method_key,
      CASE
        WHEN s.payment_details ? 'split' AND (s.payment_details->>'split')::boolean = true
             AND jsonb_typeof(s.payment_details->'splits') = 'array'
          THEN COALESCE((split_elem->>'amount')::numeric, 0)
        ELSE COALESCE(s.total, 0)
      END AS amount,
      ROW_NUMBER() OVER (PARTITION BY s.id) AS rn
    FROM _sess_sales s
    LEFT JOIN LATERAL jsonb_array_elements(
      CASE WHEN s.payment_details ? 'split' AND (s.payment_details->>'split')::boolean = true
                AND jsonb_typeof(s.payment_details->'splits') = 'array'
           THEN s.payment_details->'splits' ELSE '[null]'::jsonb END
    ) split_elem ON true
    WHERE s.status <> 'cancelled'
  )
  SELECT COALESCE(jsonb_object_agg(method_key, jsonb_build_object('amount', amount_sum, 'count', cnt)), '{}'::jsonb)
  INTO v_payments
  FROM (
    SELECT method_key,
           SUM(amount) AS amount_sum,
           SUM(CASE WHEN rn = 1 THEN 1 ELSE 0 END) AS cnt
    FROM exploded GROUP BY method_key
  ) t;

  -- Cash sales para balance efectivo
  v_cash_sales := COALESCE((v_payments->'efectivo'->>'amount')::numeric, 0);

  -- Services breakdown
  SELECT COALESCE(jsonb_object_agg(k, jsonb_build_object('amount', amt, 'count', cnt)), '{}'::jsonb)
  INTO v_services
  FROM (
    SELECT COALESCE(NULLIF(order_type,''), NULLIF(source,''), 'mesa') AS k,
           SUM(total) AS amt, COUNT(*) AS cnt
    FROM _sess_sales
    WHERE status <> 'cancelled'
    GROUP BY 1
  ) t;

  -- Productos (nombre base desde products, descontando modificadores)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'total', total)
                            ORDER BY qty DESC, name ASC), '[]'::jsonb)
  INTO v_products
  FROM (
    SELECT
      COALESCE(p.name,
        TRIM(split_part(REGEXP_REPLACE(si.product_name, '\s*[(].*$', ''), '+', 1))
      ) AS name,
      SUM(si.qty)::numeric AS qty,
      SUM(si.subtotal)::numeric AS total
    FROM sale_items si
    JOIN _sess_sales ss ON ss.id = si.sale_id AND ss.status <> 'cancelled'
    LEFT JOIN products p ON p.id = si.product_id
    WHERE COALESCE(si.product_name,'') !~ '^\s*[+→\-·•]'
      AND NOT EXISTS (
        SELECT 1 FROM modifiers m
        WHERE LOWER(TRIM(m.name)) = LOWER(TRIM(si.product_name))
      )
    GROUP BY 1
  ) agg;

  -- Gastos categorizados
  WITH cats AS (
    SELECT id, LOWER(COALESCE(category,'')) AS c, amount, payment_method, description, category, user_name, created_at
    FROM expenses WHERE cash_session_id = s.id AND branch_id = s.branch_id
  )
  SELECT
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id',id,'kind','entrada','amount',amount,'category',category,'description',description,
        'method',payment_method,'user_name',user_name,'created_at',created_at) ORDER BY created_at), '[]'::jsonb)
     FROM cats WHERE c IN ('ingreso','entrada','propina')),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id',id,'kind','salida','amount',amount,'category',category,'description',description,
        'method',payment_method,'user_name',user_name,'created_at',created_at) ORDER BY created_at), '[]'::jsonb)
     FROM cats WHERE c IN ('retiro','salida') OR c NOT IN ('ingreso','entrada','propina','devolucion','devolución','reembolso')),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id',id,'kind','devolucion','amount',amount,'category',category,'description',description,
        'method',payment_method,'user_name',user_name,'created_at',created_at) ORDER BY created_at), '[]'::jsonb)
     FROM cats WHERE c IN ('devolucion','devolución','reembolso'))
  INTO v_entradas, v_salidas, v_devoluciones;

  -- Depósitos activos
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',id,'kind','deposit','amount',amount,'description',description,'method',method,
    'user_name',user_name,'status',status,'created_at',created_at) ORDER BY created_at), '[]'::jsonb)
  INTO v_deposits
  FROM cash_deposits
  WHERE cash_session_id = s.id AND branch_id = s.branch_id AND status = 'active';

  -- Sumas de efectivo para balance
  SELECT COALESCE(SUM(amount),0) INTO v_entries_cash
  FROM cash_deposits
  WHERE cash_session_id = s.id AND branch_id = s.branch_id AND status = 'active'
    AND _normalize_payment_method(COALESCE(method,'efectivo')) = 'efectivo';

  SELECT COALESCE(SUM(amount),0) INTO v_cash_expense_out
  FROM expenses
  WHERE cash_session_id = s.id AND branch_id = s.branch_id
    AND _normalize_payment_method(COALESCE(payment_method,'efectivo')) = 'efectivo';

  SELECT COALESCE(SUM(total),0) INTO v_cash_purchases_out
  FROM purchases
  WHERE cash_session_id = s.id AND branch_id = s.branch_id
    AND _normalize_payment_method(COALESCE(payment_method,'efectivo')) = 'efectivo';

  v_expected := COALESCE(s.expected_amount,
                  COALESCE(s.opening_amount,0) + v_cash_sales + v_entries_cash - (v_cash_expense_out + v_cash_purchases_out));
  v_declared := COALESCE(s.counted_amount, 0);
  v_diff     := v_declared - v_expected;

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
    'opening_amount', COALESCE(s.opening_amount,0),
    'expected_cash', v_expected,
    'counted_amount', v_declared,
    'difference', v_diff,
    'nequi_counted', COALESCE(s.nequi_counted,0),
    'bancolombia_counted', COALESCE(s.bancolombia_counted,0)
  );

  v_result := jsonb_build_object(
    'session', jsonb_build_object(
      'id', s.id, 'branch_id', s.branch_id, 'branch_name', v_branch_name,
      'opened_at', s.opened_at, 'closed_at', s.closed_at,
      'opening_amount', s.opening_amount, 'counted_amount', s.counted_amount,
      'expected_amount', s.expected_amount, 'difference', s.difference,
      'user_name', s.user_name, 'status', s.status,
      'opening_notes', s.opening_notes, 'closing_notes', s.closing_notes
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

-- ============================================================
-- 4) Función compartida: dashboard del día (rango libre)
--    Replica dashboard.tsx exactamente
-- ============================================================
CREATE OR REPLACE FUNCTION public._shared_dashboard_payload(
  _branch_id uuid, _start timestamptz, _end timestamptz,
  _origen text DEFAULT 'all', _pago text DEFAULT 'all'
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total numeric := 0; v_txs integer := 0; v_gastos numeric := 0; v_qty numeric := 0;
  v_methods jsonb; v_top jsonb; v_hourly jsonb; v_best jsonb; v_real_cash jsonb;
  v_active_cash jsonb; v_pending jsonb;
BEGIN
  CREATE TEMP TABLE _d_sales ON COMMIT DROP AS
  SELECT * FROM sales
  WHERE branch_id = _branch_id
    AND created_at >= _start AND created_at < _end
    AND COALESCE(status,'paid') <> 'cancelled'
    AND (_origen = 'all' OR LOWER(COALESCE(source,'')) = LOWER(_origen))
    AND (_pago   = 'all' OR LOWER(COALESCE(payment_method,'')) = LOWER(_pago));

  SELECT COALESCE(SUM(total),0), COUNT(*) INTO v_total, v_txs FROM _d_sales;

  -- Gastos+compras del período
  SELECT COALESCE((SELECT SUM(amount) FROM expenses
                    WHERE branch_id=_branch_id AND created_at>=_start AND created_at<_end),0)
       + COALESCE((SELECT SUM(total) FROM purchases
                    WHERE branch_id=_branch_id AND created_at>=_start AND created_at<_end),0)
  INTO v_gastos;

  -- Métodos (ingresos con splits, egresos gastos+compras)
  WITH ingresos AS (
    SELECT _normalize_payment_method(
             CASE WHEN s.payment_details ? 'split' AND (s.payment_details->>'split')::boolean = true
                       AND jsonb_typeof(s.payment_details->'splits')='array'
                  THEN sp->>'method' ELSE s.payment_method END) AS m,
           CASE WHEN s.payment_details ? 'split' AND (s.payment_details->>'split')::boolean = true
                     AND jsonb_typeof(s.payment_details->'splits')='array'
                THEN COALESCE((sp->>'amount')::numeric,0) ELSE COALESCE(s.total,0) END AS a
    FROM _d_sales s
    LEFT JOIN LATERAL jsonb_array_elements(
      CASE WHEN s.payment_details ? 'split' AND (s.payment_details->>'split')::boolean = true
                AND jsonb_typeof(s.payment_details->'splits')='array'
           THEN s.payment_details->'splits' ELSE '[null]'::jsonb END) sp ON true
  ),
  egresos AS (
    SELECT _normalize_payment_method(payment_method) AS m, SUM(amount) AS a
    FROM expenses WHERE branch_id=_branch_id AND created_at>=_start AND created_at<_end
    GROUP BY 1
    UNION ALL
    SELECT _normalize_payment_method(payment_method) AS m, SUM(total)
    FROM purchases WHERE branch_id=_branch_id AND created_at>=_start AND created_at<_end
    GROUP BY 1
  ),
  all_keys AS (
    SELECT m, SUM(a) AS ingresos FROM ingresos GROUP BY m
    UNION
    SELECT m, 0 FROM egresos GROUP BY m
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', k.m,
    'ingresos', COALESCE(i.ingresos,0),
    'egresos', COALESCE(e.egresos,0),
    'neto', COALESCE(i.ingresos,0) - COALESCE(e.egresos,0),
    'total', COALESCE(i.ingresos,0)
  ) ORDER BY COALESCE(i.ingresos,0) DESC), '[]'::jsonb)
  INTO v_methods
  FROM (SELECT DISTINCT m FROM all_keys) k
  LEFT JOIN (SELECT m, SUM(ingresos) AS ingresos FROM all_keys GROUP BY m) i ON i.m=k.m
  LEFT JOIN (SELECT m, SUM(a) AS egresos FROM egresos GROUP BY m) e ON e.m=k.m;

  -- Top 5 productos (nombre base)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name',name,'qty',qty,'total',total) ORDER BY total DESC), '[]'::jsonb),
         COALESCE(SUM(qty),0)
  INTO v_top, v_qty
  FROM (
    SELECT COALESCE(p.name, TRIM(split_part(REGEXP_REPLACE(si.product_name,'\s*[(].*$',''),'+',1))) AS name,
           SUM(si.qty)::numeric AS qty, SUM(si.subtotal)::numeric AS total
    FROM sale_items si
    JOIN _d_sales s ON s.id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id
    WHERE COALESCE(si.product_name,'') !~ '^\s*[+→\-·•]'
    GROUP BY 1
    ORDER BY total DESC
    LIMIT 5
  ) t;

  -- Hourly 0..23
  SELECT jsonb_agg(jsonb_build_object('hour', h, 'total', COALESCE(v,0)) ORDER BY h)
  INTO v_hourly
  FROM generate_series(0,23) h
  LEFT JOIN (
    SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Bogota')::int AS hh, SUM(total) AS v
    FROM _d_sales GROUP BY 1
  ) x ON x.hh = h;

  -- Best days
  SELECT COALESCE(jsonb_agg(jsonb_build_object('dow',dow,'total',total) ORDER BY total DESC), '[]'::jsonb)
  INTO v_best FROM (
    SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'America/Bogota')::int AS dow, SUM(total) AS total
    FROM _d_sales GROUP BY 1 ORDER BY total DESC LIMIT 3
  ) t;

  -- Efectivo real (arqueo cerradas en período)
  SELECT jsonb_build_object(
    'efectivo', COALESCE(SUM(cash_counted),0),
    'nequi', COALESCE(SUM(nequi_counted),0),
    'bancolombia', COALESCE(SUM(bancolombia_counted),0),
    'efectivoEsperado', COALESCE(SUM(cash_expected),0),
    'nequiEsperado', COALESCE(SUM(nequi_expected),0),
    'bancolombiaEsperado', COALESCE(SUM(bancolombia_expected),0),
    'diferenciaEfectivo', COALESCE(SUM(cash_difference),0),
    'diferenciaNequi', COALESCE(SUM(nequi_difference),0),
    'diferenciaBanco', COALESCE(SUM(bancolombia_difference),0),
    'cajasCerradas', COUNT(*)
  ) INTO v_real_cash
  FROM cash_sessions
  WHERE branch_id=_branch_id AND status='closed'
    AND closed_at>=_start AND closed_at<_end;

  -- Caja activa (turno actual)
  SELECT to_jsonb(cs) INTO v_active_cash
  FROM cash_sessions cs
  WHERE cs.branch_id=_branch_id AND cs.status='open'
  ORDER BY cs.opened_at DESC LIMIT 1;

  -- Pedidos pendientes rápidos
  SELECT jsonb_build_object(
    'tables_occupied', (SELECT COUNT(*) FROM restaurant_tables WHERE branch_id=_branch_id AND status='occupied'),
    'pending_llevar', (SELECT COUNT(*) FROM sales WHERE branch_id=_branch_id AND order_type='llevar' AND status IN ('pending','preparing')),
    'pending_domicilio', (SELECT COUNT(*) FROM sales WHERE branch_id=_branch_id AND order_type='domicilio' AND status IN ('pending','preparing','on_the_way')),
    'preparing', (SELECT COUNT(*) FROM sales WHERE branch_id=_branch_id AND status='preparing')
  ) INTO v_pending;

  RETURN jsonb_build_object(
    'range', jsonb_build_object('start', _start, 'end', _end),
    'total', v_total,
    'txs', v_txs,
    'avg', CASE WHEN v_txs>0 THEN v_total/v_txs ELSE 0 END,
    'gastos', v_gastos,
    'utilidad', v_total - v_gastos,
    'qty_vendida', v_qty,
    'methods', v_methods,
    'top', v_top,
    'hourly', v_hourly,
    'best_days', v_best,
    'real_cash', v_real_cash,
    'active_cash', v_active_cash,
    'pending', v_pending
  );
END;
$$;

-- ============================================================
-- 5) Función compartida: lista de cierres
-- ============================================================
CREATE OR REPLACE FUNCTION public._shared_cash_session_list(
  _branch_id uuid, _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _status text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', cs.id,
    'branch_id', cs.branch_id,
    'branch_name', b.name,
    'opened_at', cs.opened_at,
    'closed_at', cs.closed_at,
    'opening_amount', cs.opening_amount,
    'counted_amount', cs.counted_amount,
    'expected_amount', cs.expected_amount,
    'difference', cs.difference,
    'status', cs.status,
    'user_name', cs.user_name,
    'sales_total', COALESCE((
      SELECT SUM(total) FROM sales s
      WHERE s.cash_session_id = cs.id AND s.status <> 'cancelled'
    ), 0)
  ) ORDER BY cs.opened_at DESC), '[]'::jsonb)
  FROM cash_sessions cs
  LEFT JOIN branches b ON b.id = cs.branch_id
  WHERE (_branch_id IS NULL OR cs.branch_id = _branch_id)
    AND (_from IS NULL OR cs.opened_at >= _from)
    AND (_to IS NULL OR cs.opened_at <= _to)
    AND (_status IS NULL OR cs.status = _status);
$$;

-- ============================================================
-- 6) Login por Nombre + PIN
-- ============================================================
CREATE OR REPLACE FUNCTION public.supervisor_login_by_name_rpc(
  _display_name text, _pin text, _user_agent text DEFAULT NULL, _ip text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_acc supervisor_accounts%ROWTYPE;
  v_token text;
BEGIN
  IF _display_name IS NULL OR btrim(_display_name)='' OR _pin IS NULL OR _pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'Nombre y PIN de 4 dígitos son obligatorios' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_acc FROM supervisor_accounts
    WHERE LOWER(display_name) = LOWER(btrim(_display_name)) AND active = true
    LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO failed_login_attempts(email, reason, user_agent, ip_address)
      VALUES (LOWER(btrim(_display_name)), 'supervisor_not_found', _user_agent, _ip);
    RAISE EXCEPTION 'Nombre o PIN incorrecto' USING ERRCODE = '28000';
  END IF;

  IF v_acc.locked_until IS NOT NULL AND v_acc.locked_until > now() THEN
    RAISE EXCEPTION 'Cuenta bloqueada temporalmente. Intenta más tarde.' USING ERRCODE = '28000';
  END IF;

  IF v_acc.pin_hash <> crypt(_pin, v_acc.pin_hash) THEN
    UPDATE supervisor_accounts
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
     WHERE id = v_acc.id;
    INSERT INTO failed_login_attempts(email, reason, user_agent, ip_address)
      VALUES (LOWER(btrim(_display_name)), 'bad_pin', _user_agent, _ip);
    RAISE EXCEPTION 'Nombre o PIN incorrecto' USING ERRCODE = '28000';
  END IF;

  UPDATE supervisor_accounts
     SET failed_attempts=0, locked_until=NULL, last_login_at=now()
   WHERE id=v_acc.id;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO supervisor_sessions(account_id, session_token, expires_at, user_agent, ip_address)
    VALUES (v_acc.id, v_token, now()+interval '12 hours', _user_agent, _ip);

  INSERT INTO supervisor_audit_log(account_id, username, event, detail, ip_address, user_agent)
    VALUES (v_acc.id, v_acc.display_name, 'login',
            jsonb_build_object('display_name', v_acc.display_name), _ip, _user_agent);

  RETURN jsonb_build_object(
    'session_token', v_token,
    'expires_at', now()+interval '12 hours',
    'display_name', v_acc.display_name,
    'supervisor_id', v_acc.id
  );
END;
$$;

-- ============================================================
-- 7) Validar sesión y devolver contexto (sedes, sede por defecto)
-- ============================================================
CREATE OR REPLACE FUNCTION public.supervisor_validate_session_rpc(_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sess supervisor_sessions%ROWTYPE; v_acc supervisor_accounts%ROWTYPE; v_branches jsonb;
BEGIN
  SELECT * INTO v_sess FROM supervisor_sessions
    WHERE session_token=_session_token AND expires_at>now() AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión inválida o expirada' USING ERRCODE='28000'; END IF;
  SELECT * INTO v_acc FROM supervisor_accounts WHERE id=v_sess.account_id AND active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta desactivada' USING ERRCODE='28000'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'is_main',COALESCE(is_main,false))
                            ORDER BY is_main DESC NULLS LAST, name), '[]'::jsonb)
    INTO v_branches FROM branches;

  RETURN jsonb_build_object(
    'supervisor', jsonb_build_object('id', v_acc.id, 'display_name', v_acc.display_name),
    'branches', v_branches,
    'default_branch_id', COALESCE(v_sess.current_branch_id,
       (SELECT id FROM branches ORDER BY is_main DESC NULLS LAST, name LIMIT 1)),
    'session_expires_at', v_sess.expires_at
  );
END;
$$;

-- ============================================================
-- 8) Wrappers Supervisor → funciones compartidas
-- ============================================================
CREATE OR REPLACE FUNCTION public.supervisor_dashboard_v2_rpc(
  _session_token text, _branch_id uuid, _range text DEFAULT 'hoy',
  _origen text DEFAULT 'all', _pago text DEFAULT 'all'
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sess supervisor_sessions%ROWTYPE; v_acc supervisor_accounts%ROWTYPE;
        v_start timestamptz; v_end timestamptz; v_now_bo timestamptz; v_today date;
BEGIN
  SELECT * INTO v_sess FROM supervisor_sessions WHERE session_token=_session_token AND expires_at>now() AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión inválida' USING ERRCODE='28000'; END IF;
  SELECT * INTO v_acc FROM supervisor_accounts WHERE id=v_sess.account_id AND active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta desactivada' USING ERRCODE='28000'; END IF;

  IF _branch_id IS NOT NULL AND (v_sess.current_branch_id IS DISTINCT FROM _branch_id) THEN
    UPDATE supervisor_sessions SET current_branch_id = _branch_id WHERE id = v_sess.id;
    INSERT INTO supervisor_audit_log(account_id, username, event, detail, branch_id)
      VALUES (v_acc.id, v_acc.display_name, 'switch_branch',
              jsonb_build_object('branch_id', _branch_id), _branch_id);
  END IF;

  v_now_bo := now() AT TIME ZONE 'America/Bogota';
  v_today  := v_now_bo::date;

  CASE _range
    WHEN 'hoy'    THEN v_start := (v_today)::timestamp AT TIME ZONE 'America/Bogota';
                       v_end   := ((v_today + 1))::timestamp AT TIME ZONE 'America/Bogota';
    WHEN 'ayer'  THEN v_start := ((v_today - 1))::timestamp AT TIME ZONE 'America/Bogota';
                       v_end   := (v_today)::timestamp AT TIME ZONE 'America/Bogota';
    WHEN 'semana' THEN v_start := ((v_today - 6))::timestamp AT TIME ZONE 'America/Bogota';
                        v_end   := ((v_today + 1))::timestamp AT TIME ZONE 'America/Bogota';
    ELSE               v_start := ((v_today - 29))::timestamp AT TIME ZONE 'America/Bogota';
                        v_end   := ((v_today + 1))::timestamp AT TIME ZONE 'America/Bogota';
  END CASE;

  RETURN _shared_dashboard_payload(_branch_id, v_start, v_end, _origen, _pago);
END;
$$;

CREATE OR REPLACE FUNCTION public.supervisor_cash_sessions_list_rpc(
  _session_token text, _branch_id uuid, _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sess supervisor_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_sess FROM supervisor_sessions WHERE session_token=_session_token AND expires_at>now() AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión inválida' USING ERRCODE='28000'; END IF;
  RETURN _shared_cash_session_list(_branch_id, _from, _to, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.supervisor_cash_session_detail_v2_rpc(
  _session_token text, _cash_session_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sess supervisor_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_sess FROM supervisor_sessions WHERE session_token=_session_token AND expires_at>now() AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión inválida' USING ERRCODE='28000'; END IF;
  RETURN _shared_cash_session_detail(_cash_session_id);
END;
$$;

-- ============================================================
-- 9) Admin CRUD (Nombre + PIN)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_supervisors_rpc()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Solo admin' USING ERRCODE='42501'; END IF;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',id,'display_name',display_name,'active',active,
    'last_login_at',last_login_at,'locked_until',locked_until,'created_at',created_at
  ) ORDER BY display_name), '[]'::jsonb) FROM supervisor_accounts);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_supervisor_rpc(_display_name text, _pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_name text; v_uname text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Solo admin' USING ERRCODE='42501'; END IF;
  IF _display_name IS NULL OR btrim(_display_name)='' OR _pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'Nombre y PIN de 4 dígitos son obligatorios' USING ERRCODE='22023';
  END IF;
  v_name := btrim(_display_name);
  v_uname := regexp_replace(lower(v_name),'[^a-z0-9]+','_','g') || '_' || substr(md5(random()::text),1,4);
  INSERT INTO supervisor_accounts(display_name, username, pin_hash, active)
    VALUES (v_name, v_uname, crypt(_pin, gen_salt('bf')), true)
    RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'display_name', v_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_supervisor_rpc(
  _id uuid, _display_name text DEFAULT NULL, _pin text DEFAULT NULL, _active boolean DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Solo admin' USING ERRCODE='42501'; END IF;
  IF _pin IS NOT NULL AND _pin !~ '^\d{4}$' THEN RAISE EXCEPTION 'PIN inválido' USING ERRCODE='22023'; END IF;

  UPDATE supervisor_accounts SET
    display_name = COALESCE(NULLIF(btrim(_display_name),''), display_name),
    pin_hash     = CASE WHEN _pin IS NOT NULL THEN crypt(_pin, gen_salt('bf')) ELSE pin_hash END,
    active       = COALESCE(_active, active),
    failed_attempts = CASE WHEN _active = true THEN 0 ELSE failed_attempts END,
    locked_until    = CASE WHEN _active = true THEN NULL ELSE locked_until END,
    updated_at   = now()
  WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supervisor no encontrado' USING ERRCODE='02000'; END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_supervisor_rpc(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Solo admin' USING ERRCODE='42501'; END IF;
  DELETE FROM supervisor_sessions WHERE account_id = _id;
  DELETE FROM supervisor_accounts WHERE id = _id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ============================================================
-- 10) Grants
-- ============================================================
GRANT EXECUTE ON FUNCTION public.supervisor_login_by_name_rpc(text,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_validate_session_rpc(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_dashboard_v2_rpc(text,uuid,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_cash_sessions_list_rpc(text,uuid,timestamptz,timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_cash_session_detail_v2_rpc(text,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_supervisors_rpc() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_supervisor_rpc(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_supervisor_rpc(uuid,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_supervisor_rpc(uuid) TO authenticated;
