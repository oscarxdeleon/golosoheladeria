
CREATE TABLE IF NOT EXISTS public.gemini_quota_daily (
  usage_date date PRIMARY KEY DEFAULT CURRENT_DATE,
  call_count integer NOT NULL DEFAULT 0,
  alert_80_sent boolean NOT NULL DEFAULT false,
  alert_95_sent boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.gemini_quota_daily TO authenticated;
GRANT ALL ON public.gemini_quota_daily TO service_role;

ALTER TABLE public.gemini_quota_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gemini_quota_admin_read"
  ON public.gemini_quota_daily
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS gemini_daily_limit integer NOT NULL DEFAULT 1500,
  ADD COLUMN IF NOT EXISTS gemini_alert_emails text[] NOT NULL DEFAULT '{}'::text[];

CREATE OR REPLACE FUNCTION public.track_gemini_call(_source text DEFAULT NULL)
RETURNS TABLE(call_count integer, daily_limit integer, alert_level text, alert_emails text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_limit integer;
  v_emails text[];
  v_row public.gemini_quota_daily;
  v_prev_count integer;
  v_alert text := NULL;
  v_threshold_80 integer;
  v_threshold_95 integer;
BEGIN
  SELECT COALESCE(gemini_daily_limit, 1500), COALESCE(gemini_alert_emails, '{}'::text[])
    INTO v_limit, v_emails
    FROM public.settings WHERE id = 1;

  IF v_limit IS NULL OR v_limit <= 0 THEN v_limit := 1500; END IF;
  v_threshold_80 := (v_limit * 80) / 100;
  v_threshold_95 := (v_limit * 95) / 100;

  INSERT INTO public.gemini_quota_daily (usage_date, call_count)
  VALUES (v_today, 0)
  ON CONFLICT (usage_date) DO NOTHING;

  SELECT * INTO v_row FROM public.gemini_quota_daily WHERE usage_date = v_today FOR UPDATE;
  v_prev_count := v_row.call_count;

  UPDATE public.gemini_quota_daily
     SET call_count = v_prev_count + 1,
         updated_at = now()
   WHERE usage_date = v_today;

  IF (v_prev_count + 1) >= v_threshold_95 AND NOT v_row.alert_95_sent THEN
    UPDATE public.gemini_quota_daily SET alert_95_sent = true WHERE usage_date = v_today;
    v_alert := '95';
  ELSIF (v_prev_count + 1) >= v_threshold_80 AND NOT v_row.alert_80_sent THEN
    UPDATE public.gemini_quota_daily SET alert_80_sent = true WHERE usage_date = v_today;
    v_alert := '80';
  END IF;

  RETURN QUERY SELECT v_prev_count + 1, v_limit, v_alert, v_emails;
END;
$$;

GRANT EXECUTE ON FUNCTION public.track_gemini_call(text) TO anon, authenticated, service_role;
