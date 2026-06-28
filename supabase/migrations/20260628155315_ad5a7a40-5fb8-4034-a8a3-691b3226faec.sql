-- Permitir que usuarios autenticados ejecuten el flujo de caja desde el POS.
REVOKE EXECUTE ON FUNCTION public.open_cash_session(numeric, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_active_cash_session() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.close_cash_session(numeric, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.open_cash_session(numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_cash_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_session(numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_session(numeric, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_active_cash_session() TO service_role;
GRANT EXECUTE ON FUNCTION public.close_cash_session(numeric, text) TO service_role;

CREATE OR REPLACE FUNCTION public.close_cash_session(_counted_amount numeric, _closing_notes text DEFAULT NULL::text)
RETURNS public.cash_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid := auth.uid();
  _session public.cash_sessions;
  _cash_sales numeric := 0;
  _expected numeric := 0;
  _updated public.cash_sessions;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para cerrar caja';
  END IF;

  IF _counted_amount IS NULL OR _counted_amount < 0 THEN
    RAISE EXCEPTION 'El monto contado debe ser mayor o igual a cero';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_user_id::text));

  SELECT * INTO _session
  FROM public.cash_sessions
  WHERE user_id = _user_id
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1
  FOR UPDATE;

  IF _session.id IS NULL THEN
    RAISE EXCEPTION 'No hay caja abierta para cerrar';
  END IF;

  SELECT COALESCE(SUM(total), 0) INTO _cash_sales
  FROM public.sales
  WHERE user_id = _user_id
    AND payment_method = 'Efectivo'
    AND COALESCE(status, 'completed') <> 'cancelled'
    AND created_at >= _session.opened_at;

  _expected := COALESCE(_session.opening_amount, 0) + COALESCE(_cash_sales, 0);

  UPDATE public.cash_sessions
     SET status          = 'closed',
         closed_at       = now(),
         counted_amount  = round(_counted_amount::numeric, 2),
         expected_amount = round(_expected::numeric, 2),
         difference      = round((_counted_amount - _expected)::numeric, 2),
         closing_notes   = NULLIF(trim(COALESCE(_closing_notes, '')), '')
   WHERE id = _session.id
     AND user_id = _user_id
     AND status = 'open'
  RETURNING * INTO _updated;

  IF _updated.id IS NULL THEN
    RAISE EXCEPTION 'No se pudo cerrar la caja: el registro ya no está abierto';
  END IF;

  RETURN _updated;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.close_cash_session(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_cash_session(numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_session(numeric, text) TO service_role;