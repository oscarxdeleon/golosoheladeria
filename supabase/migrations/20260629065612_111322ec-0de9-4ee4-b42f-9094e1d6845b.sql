
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS report_email text;

ALTER TABLE public.cash_sessions
  ADD COLUMN IF NOT EXISTS cash_counted numeric(12,2),
  ADD COLUMN IF NOT EXISTS nequi_counted numeric(12,2),
  ADD COLUMN IF NOT EXISTS bancolombia_counted numeric(12,2),
  ADD COLUMN IF NOT EXISTS cash_expected numeric(12,2),
  ADD COLUMN IF NOT EXISTS nequi_expected numeric(12,2),
  ADD COLUMN IF NOT EXISTS bancolombia_expected numeric(12,2),
  ADD COLUMN IF NOT EXISTS cash_difference numeric(12,2),
  ADD COLUMN IF NOT EXISTS nequi_difference numeric(12,2),
  ADD COLUMN IF NOT EXISTS bancolombia_difference numeric(12,2);

CREATE OR REPLACE FUNCTION public.close_cash_session_blind(
  _cash_counted numeric,
  _nequi_counted numeric,
  _bancolombia_counted numeric,
  _closing_notes text DEFAULT NULL
)
RETURNS public.cash_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _session public.cash_sessions;
  _cash_sales numeric := 0;
  _nequi_sales numeric := 0;
  _banco_sales numeric := 0;
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

  PERFORM pg_advisory_xact_lock(hashtext(_user_id::text));

  SELECT * INTO _session FROM public.cash_sessions
   WHERE user_id = _user_id AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1 FOR UPDATE;

  IF _session.id IS NULL THEN
    RAISE EXCEPTION 'No hay caja abierta para cerrar';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN lower(payment_method) = 'efectivo' THEN total ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN lower(payment_method) = 'nequi' THEN total ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN lower(payment_method) = 'bancolombia' THEN total ELSE 0 END), 0)
    INTO _cash_sales, _nequi_sales, _banco_sales
    FROM public.sales
   WHERE user_id = _user_id
     AND COALESCE(status,'completed') <> 'cancelled'
     AND created_at >= _session.opened_at
     AND (_session.branch_id IS NULL OR branch_id = _session.branch_id);

  _cash_expected := COALESCE(_session.opening_amount, 0) + _cash_sales;

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
    closing_notes = NULLIF(trim(COALESCE(_closing_notes, '')), '')
  WHERE id = _session.id AND user_id = _user_id AND status = 'open'
  RETURNING * INTO _updated;

  IF _updated.id IS NULL THEN
    RAISE EXCEPTION 'No se pudo cerrar la caja: el registro ya no está abierto';
  END IF;

  RETURN _updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_cash_session_blind(numeric, numeric, numeric, text) TO authenticated;
