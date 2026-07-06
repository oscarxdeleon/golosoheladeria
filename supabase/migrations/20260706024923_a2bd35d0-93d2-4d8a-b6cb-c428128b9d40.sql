
CREATE OR REPLACE FUNCTION public.close_cash_session_blind(_cash_counted numeric, _nequi_counted numeric, _bancolombia_counted numeric, _closing_notes text DEFAULT NULL::text, _branch_id uuid DEFAULT NULL::uuid)
 RETURNS cash_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid := auth.uid();
  _target_branch_id uuid := _branch_id;
  _session public.cash_sessions;
  _cash_sales numeric := 0;
  _nequi_sales numeric := 0;
  _banco_sales numeric := 0;
  _cash_out numeric := 0;
  _cash_expected numeric := 0;
  _updated public.cash_sessions;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para cerrar caja';
  END IF;

  IF _cash_counted IS NULL OR _cash_counted < 0
     OR _nequi_counted IS NULL OR _nequi_counted < 0
     OR _bancolombia_counted IS NULL OR _bancolombia_counted < 0 THEN
    RAISE EXCEPTION 'Todos los valores deben ser mayores o iguales a cero';
  END IF;

  IF _target_branch_id IS NULL THEN
    SELECT branch_id INTO _target_branch_id FROM public.profiles WHERE id = _user_id;
  END IF;

  IF _target_branch_id IS NULL THEN
    RAISE EXCEPTION 'Debes seleccionar la sede antes de cerrar caja';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('cash_close_branch:' || _target_branch_id::text));

  SELECT * INTO _session
  FROM public.cash_sessions
  WHERE branch_id = _target_branch_id AND status = 'open'
  ORDER BY opened_at DESC LIMIT 1 FOR UPDATE;

  IF _session.id IS NULL THEN
    RAISE EXCEPTION 'No hay caja abierta para cerrar en esta sede';
  END IF;

  IF _session.user_id <> _user_id AND NOT public.has_role(_user_id, 'admin') THEN
    RAISE EXCEPTION 'No tienes permisos para cerrar la caja de otro cajero';
  END IF;

  -- Suma por método considerando pagos divididos (payment_details.splits[])
  WITH scope AS (
    SELECT s.id, s.total, s.payment_method, s.payment_details
      FROM public.sales s
     WHERE s.cash_session_id = _session.id
        OR (
          s.branch_id = _target_branch_id
          AND COALESCE(s.status,'completed') <> 'cancelled'
          AND s.created_at >= _session.opened_at
        )
  ),
  breakdown AS (
    SELECT
      CASE
        WHEN sp.method IS NOT NULL THEN sp.method
        ELSE scope.payment_method
      END AS method,
      CASE
        WHEN sp.amount IS NOT NULL THEN sp.amount
        ELSE scope.total
      END AS amount
    FROM scope
    LEFT JOIN LATERAL (
      SELECT (e->>'method') AS method,
             COALESCE((e->>'amount')::numeric, 0) AS amount
        FROM jsonb_array_elements(COALESCE(scope.payment_details->'splits','[]'::jsonb)) e
       WHERE COALESCE(scope.payment_details->>'split','false') = 'true'
    ) sp ON true
  )
  SELECT
    COALESCE(SUM(CASE WHEN lower(method) = 'efectivo' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN lower(method) = 'nequi' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN lower(method) = 'bancolombia' THEN amount ELSE 0 END), 0)
  INTO _cash_sales, _nequi_sales, _banco_sales
  FROM breakdown;

  SELECT COALESCE((SELECT SUM(total) FROM public.purchases
                    WHERE cash_session_id = _session.id AND lower(payment_method)='efectivo'),0)
       + COALESCE((SELECT SUM(amount) FROM public.expenses
                    WHERE cash_session_id = _session.id AND lower(payment_method)='efectivo'),0)
    INTO _cash_out;

  _cash_expected := COALESCE(_session.opening_amount, 0) + _cash_sales - _cash_out;

  UPDATE public.cash_sessions SET
    status = 'closed',
    closed_at = now(),
    counted_amount = round(_cash_counted::numeric, 2),
    expected_amount = round(_cash_expected::numeric, 2),
    difference = round((_cash_counted - _cash_expected)::numeric, 2),
    cash_counted = round(_cash_counted::numeric, 2),
    nequi_counted = round(_nequi_counted::numeric, 2),
    bancolombia_counted = round(_bancolombia_counted::numeric, 2),
    cash_expected = round(_cash_expected::numeric, 2),
    nequi_expected = round(_nequi_sales::numeric, 2),
    bancolombia_expected = round(_banco_sales::numeric, 2),
    cash_difference = round((_cash_counted - _cash_expected)::numeric, 2),
    nequi_difference = round((_nequi_counted - _nequi_sales)::numeric, 2),
    bancolombia_difference = round((_bancolombia_counted - _banco_sales)::numeric, 2),
    closing_notes = _closing_notes
  WHERE id = _session.id
  RETURNING * INTO _updated;

  RETURN _updated;
END;
$function$;
