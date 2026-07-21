
CREATE OR REPLACE FUNCTION public._shared_cash_session_list(_branch_id uuid, _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', cs.id,
    'branch_id', cs.branch_id,
    'branch_name', b.name,
    'user_id', cs.user_id,
    'opened_at', cs.opened_at,
    'closed_at', cs.closed_at,
    'opening_amount', cs.opening_amount,
    'counted_amount', cs.counted_amount,
    'expected_amount', CASE WHEN public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor') THEN cs.expected_amount ELSE NULL END,
    'difference',      CASE WHEN public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor') THEN cs.difference      ELSE NULL END,
    'cash_expected',        CASE WHEN public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor') THEN cs.cash_expected        ELSE NULL END,
    'nequi_expected',       CASE WHEN public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor') THEN cs.nequi_expected       ELSE NULL END,
    'bancolombia_expected', CASE WHEN public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor') THEN cs.bancolombia_expected ELSE NULL END,
    'cash_difference',        CASE WHEN public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor') THEN cs.cash_difference        ELSE NULL END,
    'nequi_difference',       CASE WHEN public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor') THEN cs.nequi_difference       ELSE NULL END,
    'bancolombia_difference', CASE WHEN public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor') THEN cs.bancolombia_difference ELSE NULL END,
    'cash_counted',        cs.cash_counted,
    'nequi_counted',       cs.nequi_counted,
    'bancolombia_counted', cs.bancolombia_counted,
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_cash_session_detail_rpc(_cash_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501';
  END IF;
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor')) THEN
    RAISE EXCEPTION 'No autorizado: cierre ciego para cajeros' USING ERRCODE='42501';
  END IF;
  -- Delegate to previous implementation stored under a preserved name if exists,
  -- otherwise inline call. We keep behavior by calling the underlying function.
  SELECT public._admin_cash_session_detail_impl(_cash_session_id) INTO _result;
  RETURN _result;
END $function$;
