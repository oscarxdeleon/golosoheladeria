
CREATE OR REPLACE FUNCTION public.gemini_quota_status()
RETURNS TABLE(call_count integer, daily_limit integer, exhausted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_limit integer;
  v_count integer := 0;
BEGIN
  SELECT COALESCE(gemini_daily_limit, 1500) INTO v_limit
    FROM public.settings WHERE id = 1;
  IF v_limit IS NULL OR v_limit <= 0 THEN v_limit := 1500; END IF;

  SELECT COALESCE(gd.call_count, 0) INTO v_count
    FROM public.gemini_quota_daily gd
    WHERE gd.usage_date = v_today;

  RETURN QUERY SELECT COALESCE(v_count, 0), v_limit, COALESCE(v_count, 0) >= v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gemini_quota_status() TO anon, authenticated, service_role;
