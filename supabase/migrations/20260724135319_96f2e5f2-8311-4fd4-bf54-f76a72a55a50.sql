
-- Purga completa de una sesión de caja de prueba (solo admin)
-- Elimina el cierre, todas las ventas, gastos, depósitos, compras, créditos
-- y registros asociados a esa sesión. Deja auditoría.
CREATE OR REPLACE FUNCTION public.admin_purge_cash_session(
  _cash_session_id uuid,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_session record;
  v_sale_ids uuid[];
  v_purchase_ids uuid[];
  v_credit_ids uuid[];
  v_supplier_credit_ids uuid[];
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
  v_user_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT public.has_role(v_uid, 'admin'::app_role) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Solo administradores pueden eliminar cierres de prueba';
  END IF;

  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'Debe indicar un motivo (mínimo 3 caracteres)';
  END IF;

  SELECT * INTO v_session FROM public.cash_sessions WHERE id = _cash_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cierre no encontrado';
  END IF;

  -- Recolectar IDs dependientes
  SELECT COALESCE(array_agg(id), '{}') INTO v_sale_ids
    FROM public.sales WHERE cash_session_id = _cash_session_id;

  SELECT COALESCE(array_agg(id), '{}') INTO v_purchase_ids
    FROM public.purchases WHERE cash_session_id = _cash_session_id;

  SELECT COALESCE(array_agg(id), '{}') INTO v_credit_ids
    FROM public.credits
    WHERE (sale_id = ANY(v_sale_ids)) OR (cash_session_id = _cash_session_id);

  SELECT COALESCE(array_agg(id), '{}') INTO v_supplier_credit_ids
    FROM public.supplier_credits
    WHERE purchase_id = ANY(v_purchase_ids);

  -- 1. Pagos y créditos de clientes ligados a estas ventas / sesión
  WITH d AS (DELETE FROM public.credit_payments
    WHERE cash_session_id = _cash_session_id OR credit_id = ANY(v_credit_ids)
    RETURNING 1) SELECT count(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('credit_payments', v_n);

  WITH d AS (DELETE FROM public.credits WHERE id = ANY(v_credit_ids)
    RETURNING 1) SELECT count(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('credits', v_n);

  -- 2. Pagos y créditos a proveedores ligados a estas compras / sesión
  WITH d AS (DELETE FROM public.supplier_credit_payments
    WHERE cash_session_id = _cash_session_id OR supplier_credit_id = ANY(v_supplier_credit_ids)
    RETURNING 1) SELECT count(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('supplier_credit_payments', v_n);

  WITH d AS (DELETE FROM public.supplier_credits WHERE id = ANY(v_supplier_credit_ids)
    RETURNING 1) SELECT count(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('supplier_credits', v_n);

  -- 3. Ventas: modificaciones, ítems, print jobs, table events, waiter calls
  WITH d AS (DELETE FROM public.sale_modifications WHERE sale_id = ANY(v_sale_ids)
    RETURNING 1) SELECT count(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('sale_modifications', v_n);

  WITH d AS (DELETE FROM public.print_jobs WHERE sale_id = ANY(v_sale_ids)
    RETURNING 1) SELECT count(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('print_jobs', v_n);

  WITH d AS (DELETE FROM public.table_events WHERE sale_id = ANY(v_sale_ids)
    RETURNING 1) SELECT count(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('table_events', v_n);

  WITH d AS (DELETE FROM public.sale_items WHERE sale_id = ANY(v_sale_ids)
    RETURNING 1) SELECT count(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('sale_items', v_n);

  WITH d AS (DELETE FROM public.sales WHERE id = ANY(v_sale_ids)
    RETURNING 1) SELECT count(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('sales', v_n);

  -- 4. Compras (items en cascada)
  WITH d AS (DELETE FROM public.purchase_items WHERE purchase_id = ANY(v_purchase_ids)
    RETURNING 1) SELECT count(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('purchase_items', v_n);

  WITH d AS (DELETE FROM public.purchases WHERE id = ANY(v_purchase_ids)
    RETURNING 1) SELECT count(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('purchases', v_n);

  -- 5. Movimientos financieros de la sesión
  WITH d AS (DELETE FROM public.expenses WHERE cash_session_id = _cash_session_id
    RETURNING 1) SELECT count(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('expenses', v_n);

  WITH d AS (DELETE FROM public.cash_deposits WHERE cash_session_id = _cash_session_id
    RETURNING 1) SELECT count(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('cash_deposits', v_n);

  -- 6. Log de correos del cierre
  WITH d AS (DELETE FROM public.cash_report_email_log WHERE session_id = _cash_session_id
    RETURNING 1) SELECT count(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('cash_report_email_log', v_n);

  -- 7. Finalmente la sesión
  DELETE FROM public.cash_sessions WHERE id = _cash_session_id;

  -- Auditoría (obtener nombre del usuario)
  SELECT COALESCE(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, meta)
  VALUES (
    'cash_session',
    _cash_session_id,
    'purge_test_session',
    v_uid,
    v_user_name,
    v_session.branch_id,
    to_jsonb(v_session),
    jsonb_build_object(
      'reason', _reason,
      'deleted_counts', v_counts,
      'sale_ids_count', array_length(v_sale_ids, 1),
      'purchase_ids_count', array_length(v_purchase_ids, 1)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', _cash_session_id,
    'branch_id', v_session.branch_id,
    'deleted_counts', v_counts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_purge_cash_session(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_purge_cash_session(uuid, text) TO authenticated;
