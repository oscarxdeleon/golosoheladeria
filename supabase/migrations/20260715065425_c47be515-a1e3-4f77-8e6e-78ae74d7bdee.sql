CREATE OR REPLACE FUNCTION public._shared_cash_session_list(_branch_id uuid, _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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
$function$;