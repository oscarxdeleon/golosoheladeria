
-- Wrappers Admin sobre las funciones compartidas (única fuente de verdad Admin ↔ Supervisor)

CREATE OR REPLACE FUNCTION public.admin_dashboard_rpc(
  _branch_id uuid, _range text DEFAULT 'hoy',
  _origen text DEFAULT 'all', _pago text DEFAULT 'all'
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_start timestamptz; v_end timestamptz; v_today date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  v_today := (now() AT TIME ZONE 'America/Bogota')::date;
  CASE _range
    WHEN 'hoy'    THEN v_start := (v_today)::timestamp AT TIME ZONE 'America/Bogota';
                       v_end   := ((v_today + 1))::timestamp AT TIME ZONE 'America/Bogota';
    WHEN 'ayer'   THEN v_start := ((v_today - 1))::timestamp AT TIME ZONE 'America/Bogota';
                       v_end   := (v_today)::timestamp AT TIME ZONE 'America/Bogota';
    WHEN 'semana' THEN v_start := ((v_today - 6))::timestamp AT TIME ZONE 'America/Bogota';
                       v_end   := ((v_today + 1))::timestamp AT TIME ZONE 'America/Bogota';
    ELSE               v_start := ((v_today - 29))::timestamp AT TIME ZONE 'America/Bogota';
                       v_end   := ((v_today + 1))::timestamp AT TIME ZONE 'America/Bogota';
  END CASE;
  RETURN public._shared_dashboard_payload(_branch_id, v_start, v_end, _origen, _pago);
END $$;

CREATE OR REPLACE FUNCTION public.admin_cash_session_detail_rpc(_cash_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  RETURN public._shared_cash_session_detail(_cash_session_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_cash_sessions_list_rpc(
  _branch_id uuid, _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _status text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  RETURN public._shared_cash_session_list(_branch_id, _from, _to, _status);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_dashboard_rpc(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cash_session_detail_rpc(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cash_sessions_list_rpc(uuid,timestamptz,timestamptz,text) TO authenticated;
