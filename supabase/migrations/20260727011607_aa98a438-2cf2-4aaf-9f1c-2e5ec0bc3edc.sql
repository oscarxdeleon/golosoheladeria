
CREATE OR REPLACE FUNCTION public.admin_change_sale_payment_method(
  _sale_id uuid,
  _new_method text,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_sale public.sales%ROWTYPE;
  v_session_status text;
  v_normalized text;
  v_old_method text;
  v_old_details jsonb;
  v_user_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT public.has_role(v_uid, 'admin'::app_role) INTO v_is_admin;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Solo un administrador puede modificar el medio de pago' USING ERRCODE = '42501';
  END IF;

  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN
    RAISE EXCEPTION 'Debes indicar un motivo (mínimo 5 caracteres)' USING ERRCODE = '22023';
  END IF;

  v_normalized := CASE lower(btrim(coalesce(_new_method,'')))
    WHEN 'efectivo' THEN 'Efectivo'
    WHEN 'nequi' THEN 'Nequi'
    WHEN 'bancolombia' THEN 'Bancolombia'
    ELSE NULL
  END;
  IF v_normalized IS NULL THEN
    RAISE EXCEPTION 'Medio de pago inválido. Use Efectivo, Nequi o Bancolombia' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_sale.status = 'cancelled' THEN
    RAISE EXCEPTION 'No se puede modificar una venta anulada' USING ERRCODE = '22023';
  END IF;

  IF v_sale.payment_details IS NOT NULL
     AND v_sale.payment_details ? 'split'
     AND (v_sale.payment_details->>'split')::boolean IS TRUE THEN
    RAISE EXCEPTION 'Esta venta tiene pago dividido y no puede modificarse por este medio' USING ERRCODE = '22023';
  END IF;

  IF v_sale.cash_session_id IS NOT NULL THEN
    SELECT status INTO v_session_status FROM public.cash_sessions WHERE id = v_sale.cash_session_id;
    IF v_session_status IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'La caja asociada a esta venta ya está cerrada. Reabra la caja o corrija dentro de la próxima apertura.' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_old_method := v_sale.payment_method;
  v_old_details := v_sale.payment_details;

  IF v_old_method = v_normalized THEN
    RAISE EXCEPTION 'La venta ya está registrada con ese medio de pago' USING ERRCODE = '22023';
  END IF;

  -- Limpia payment_details para evitar residuos incompatibles (nequi_number al cambiar a Efectivo, cash_received al cambiar a Nequi, etc.)
  UPDATE public.sales
    SET payment_method = v_normalized,
        payment_details = NULL
  WHERE id = _sale_id;

  SELECT COALESCE(full_name, '') INTO v_user_name FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
  VALUES (
    'sales',
    _sale_id,
    'payment_method_change',
    v_uid,
    v_user_name,
    v_sale.branch_id,
    jsonb_build_object('payment_method', v_old_method, 'payment_details', v_old_details),
    jsonb_build_object('payment_method', v_normalized, 'payment_details', NULL::jsonb),
    jsonb_build_object(
      'ticket_number', v_sale.ticket_number,
      'total', v_sale.total,
      'reason', btrim(_reason)
    )
  );

  INSERT INTO public.sale_modifications(sale_id, branch_id, user_id, user_name, kind, added_items, notes)
  VALUES (
    _sale_id,
    v_sale.branch_id,
    v_uid,
    v_user_name,
    'payment_method_change',
    jsonb_build_object('from', v_old_method, 'to', v_normalized, 'total', v_sale.total),
    btrim(_reason)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'sale_id', _sale_id,
    'ticket_number', v_sale.ticket_number,
    'from', v_old_method,
    'to', v_normalized
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_change_sale_payment_method(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_change_sale_payment_method(uuid, text, text) TO authenticated;
