
-- 1) Extender attendance_employees
ALTER TABLE public.attendance_employees
  ADD COLUMN IF NOT EXISTS weekly_schedule jsonb,
  ADD COLUMN IF NOT EXISTS pay_mode text NOT NULL DEFAULT 'weekly_fixed' CHECK (pay_mode IN ('weekly_fixed','per_shift')),
  ADD COLUMN IF NOT EXISTS weekly_salary numeric(12,2),
  ADD COLUMN IF NOT EXISTS shift_rates jsonb,
  ADD COLUMN IF NOT EXISTS hours_per_shift numeric(5,2) NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS grace_minutes integer NOT NULL DEFAULT 0;

-- Supervisores también pueden gestionar
DROP POLICY IF EXISTS "Supervisors manage attendance employees" ON public.attendance_employees;
CREATE POLICY "Supervisors manage attendance employees" ON public.attendance_employees
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor'));

-- 2) Festivos
CREATE TABLE IF NOT EXISTS public.company_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  name text NOT NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, branch_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_holidays TO authenticated;
GRANT ALL ON public.company_holidays TO service_role;
ALTER TABLE public.company_holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read holidays" ON public.company_holidays;
CREATE POLICY "Authenticated read holidays" ON public.company_holidays
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins supervisors manage holidays" ON public.company_holidays;
CREATE POLICY "Admins supervisors manage holidays" ON public.company_holidays
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor'));

-- 3) Historial de retrasos
CREATE TABLE IF NOT EXISTS public.attendance_late_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.attendance_employees(id) ON DELETE CASCADE,
  date date NOT NULL,
  scheduled_in time,
  actual_in timestamptz,
  late_minutes integer NOT NULL DEFAULT 0,
  deduction_amount numeric(12,2) NOT NULL DEFAULT 0,
  pay_mode text NOT NULL,
  is_holiday boolean NOT NULL DEFAULT false,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_late_records TO authenticated;
GRANT ALL ON public.attendance_late_records TO service_role;
ALTER TABLE public.attendance_late_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins supervisors read late" ON public.attendance_late_records;
CREATE POLICY "Admins supervisors read late" ON public.attendance_late_records
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor'));
DROP POLICY IF EXISTS "Admins supervisors manage late" ON public.attendance_late_records;
CREATE POLICY "Admins supervisors manage late" ON public.attendance_late_records
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor'));

-- 4) Helper: día de semana (lun..dom) a partir de fecha
CREATE OR REPLACE FUNCTION public._daykey_from_date(_d date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE EXTRACT(ISODOW FROM _d)::int
    WHEN 1 THEN 'lun' WHEN 2 THEN 'mar' WHEN 3 THEN 'mie'
    WHEN 4 THEN 'jue' WHEN 5 THEN 'vie' WHEN 6 THEN 'sab'
    WHEN 7 THEN 'dom' END;
$$;

-- 5) Cálculo del retraso de un empleado en un día
CREATE OR REPLACE FUNCTION public.compute_employee_late(_employee_id uuid, _date date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp record;
  daykey text;
  is_hol boolean;
  cfg jsonb;
  works boolean;
  sched_in time;
  actual timestamptz;
  actual_local timestamp;
  late_min int := 0;
  deduction numeric := 0;
  days_worked int;
  per_min numeric;
  rate numeric;
BEGIN
  SELECT * INTO emp FROM public.attendance_employees WHERE id = _employee_id;
  IF NOT FOUND OR NOT emp.active THEN RETURN; END IF;

  -- ¿Es festivo (global o de su sede)?
  SELECT EXISTS(
    SELECT 1 FROM public.company_holidays h
    WHERE h.date = _date AND (h.branch_id IS NULL OR h.branch_id = emp.branch_id)
  ) INTO is_hol;

  daykey := CASE WHEN is_hol THEN 'festivo' ELSE public._daykey_from_date(_date) END;

  cfg := COALESCE(emp.weekly_schedule, '{}'::jsonb) -> daykey;
  -- Si el día es festivo pero no hay config "festivo", cae al día real
  IF cfg IS NULL AND is_hol THEN
    cfg := COALESCE(emp.weekly_schedule, '{}'::jsonb) -> public._daykey_from_date(_date);
  END IF;

  works := COALESCE((cfg->>'works')::boolean, false);
  IF NOT works OR (cfg->>'in') IS NULL THEN
    DELETE FROM public.attendance_late_records WHERE employee_id = _employee_id AND date = _date;
    RETURN;
  END IF;

  sched_in := (cfg->>'in')::time;

  -- Primera entrada del día en zona Bogotá
  SELECT MIN(recorded_at) INTO actual
  FROM public.attendance_records
  WHERE employee_id = _employee_id
    AND record_type = 'entrada'
    AND (recorded_at AT TIME ZONE 'America/Bogota')::date = _date;

  IF actual IS NULL THEN
    -- Ausencia: no penaliza; solo deja registro con 0
    INSERT INTO public.attendance_late_records
      (employee_id, date, scheduled_in, actual_in, late_minutes, deduction_amount, pay_mode, is_holiday)
    VALUES (_employee_id, _date, sched_in, NULL, 0, 0, emp.pay_mode, is_hol)
    ON CONFLICT (employee_id, date) DO UPDATE
      SET scheduled_in = EXCLUDED.scheduled_in, actual_in = NULL,
          late_minutes = 0, deduction_amount = 0,
          pay_mode = EXCLUDED.pay_mode, is_holiday = EXCLUDED.is_holiday, computed_at = now();
    RETURN;
  END IF;

  actual_local := (actual AT TIME ZONE 'America/Bogota');
  late_min := GREATEST(0,
    EXTRACT(EPOCH FROM (actual_local::time - sched_in)) / 60 - COALESCE(emp.grace_minutes,0)
  )::int;

  IF late_min > 0 THEN
    IF emp.pay_mode = 'weekly_fixed' AND COALESCE(emp.weekly_salary,0) > 0 THEN
      SELECT count(*) INTO days_worked
        FROM jsonb_each(COALESCE(emp.weekly_schedule,'{}'::jsonb)) e
        WHERE e.key IN ('lun','mar','mie','jue','vie','sab','dom')
          AND COALESCE((e.value->>'works')::boolean,false);
      days_worked := GREATEST(days_worked,1);
      per_min := emp.weekly_salary / (days_worked * COALESCE(emp.hours_per_shift,8) * 60);
      deduction := ROUND(per_min * late_min, 2);
    ELSIF emp.pay_mode = 'per_shift' AND emp.shift_rates IS NOT NULL THEN
      rate := COALESCE(
        (emp.shift_rates->'per_day'->>daykey)::numeric,
        CASE WHEN is_hol OR daykey IN ('sab','dom')
          THEN (emp.shift_rates->>'weekend_holiday')::numeric
          ELSE (emp.shift_rates->>'weekday')::numeric END,
        0
      );
      IF rate > 0 THEN
        per_min := rate / (COALESCE(emp.hours_per_shift,8) * 60);
        deduction := ROUND(per_min * late_min, 2);
      END IF;
    END IF;
  END IF;

  INSERT INTO public.attendance_late_records
    (employee_id, date, scheduled_in, actual_in, late_minutes, deduction_amount, pay_mode, is_holiday)
  VALUES (_employee_id, _date, sched_in, actual, late_min, deduction, emp.pay_mode, is_hol)
  ON CONFLICT (employee_id, date) DO UPDATE
    SET scheduled_in = EXCLUDED.scheduled_in, actual_in = EXCLUDED.actual_in,
        late_minutes = EXCLUDED.late_minutes, deduction_amount = EXCLUDED.deduction_amount,
        pay_mode = EXCLUDED.pay_mode, is_holiday = EXCLUDED.is_holiday, computed_at = now();
END; $$;

GRANT EXECUTE ON FUNCTION public.compute_employee_late(uuid, date) TO authenticated;

-- 6) Recalcular todo un día (o rango)
CREATE OR REPLACE FUNCTION public.compute_daily_late(_from date, _to date DEFAULT NULL, _branch_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d date; e record; end_date date;
BEGIN
  end_date := COALESCE(_to, _from);
  d := _from;
  WHILE d <= end_date LOOP
    FOR e IN SELECT id FROM public.attendance_employees
      WHERE active AND (_branch_id IS NULL OR branch_id = _branch_id)
    LOOP
      PERFORM public.compute_employee_late(e.id, d);
    END LOOP;
    d := d + 1;
  END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.compute_daily_late(date, date, uuid) TO authenticated;

-- 7) Resumen de nómina por período
CREATE OR REPLACE FUNCTION public.payroll_period_summary(
  _from date, _to date, _employee_id uuid DEFAULT NULL, _branch_id uuid DEFAULT NULL
) RETURNS TABLE (
  employee_id uuid,
  full_name text,
  branch_id uuid,
  pay_mode text,
  days_worked int,
  days_scheduled int,
  late_minutes int,
  deductions numeric,
  gross_pay numeric,
  net_pay numeric
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Asegurar cálculos frescos del período
  PERFORM public.compute_daily_late(_from, _to, _branch_id);

  RETURN QUERY
  WITH emps AS (
    SELECT * FROM public.attendance_employees
    WHERE active
      AND (_employee_id IS NULL OR id = _employee_id)
      AND (_branch_id IS NULL OR branch_id = _branch_id)
  ),
  days AS (
    SELECT generate_series(_from, _to, interval '1 day')::date AS d
  ),
  scheduled AS (
    SELECT e.id AS eid, d.d,
      (COALESCE(e.weekly_schedule,'{}'::jsonb) -> (
        CASE WHEN EXISTS (SELECT 1 FROM public.company_holidays h
                          WHERE h.date=d.d AND (h.branch_id IS NULL OR h.branch_id=e.branch_id))
             THEN 'festivo' ELSE public._daykey_from_date(d.d) END
      )) AS cfg
    FROM emps e CROSS JOIN days d
  ),
  scheduled_flags AS (
    SELECT eid, d,
      COALESCE((cfg->>'works')::boolean,false) AS works,
      COALESCE(
        (CASE WHEN COALESCE((cfg->>'works')::boolean,false) THEN
          CASE
            WHEN (SELECT pay_mode FROM emps WHERE id=eid)='weekly_fixed'
              THEN NULL
            ELSE COALESCE(
              ((SELECT shift_rates FROM emps WHERE id=eid)->'per_day'->>(
                CASE WHEN EXISTS(SELECT 1 FROM public.company_holidays h
                   WHERE h.date=d AND (h.branch_id IS NULL OR h.branch_id=(SELECT branch_id FROM emps WHERE id=eid)))
                   THEN 'festivo' ELSE public._daykey_from_date(d) END))::numeric,
              CASE WHEN EXISTS(SELECT 1 FROM public.company_holidays h WHERE h.date=d
                     AND (h.branch_id IS NULL OR h.branch_id=(SELECT branch_id FROM emps WHERE id=eid)))
                     OR public._daykey_from_date(d) IN ('sab','dom')
                   THEN ((SELECT shift_rates FROM emps WHERE id=eid)->>'weekend_holiday')::numeric
                   ELSE ((SELECT shift_rates FROM emps WHERE id=eid)->>'weekday')::numeric END,
              0)
          END
        END), 0
      ) AS shift_rate
    FROM scheduled
  ),
  agg AS (
    SELECT
      e.id AS employee_id,
      e.full_name,
      e.branch_id,
      e.pay_mode,
      COUNT(DISTINCT CASE WHEN lr.actual_in IS NOT NULL THEN lr.date END)::int AS days_worked,
      COUNT(DISTINCT CASE WHEN sf.works THEN sf.d END)::int AS days_scheduled,
      COALESCE(SUM(lr.late_minutes),0)::int AS late_minutes,
      COALESCE(SUM(lr.deduction_amount),0)::numeric AS deductions,
      CASE
        WHEN e.pay_mode='weekly_fixed' THEN
          ROUND(
            COALESCE(e.weekly_salary,0) *
            (LEAST(_to,_from + interval '6 day')::date - _from + 1) / 7.0
          , 2)
        ELSE COALESCE(SUM(CASE WHEN lr.actual_in IS NOT NULL THEN sf.shift_rate ELSE 0 END),0)
      END AS gross_pay
    FROM emps e
    LEFT JOIN scheduled_flags sf ON sf.eid = e.id
    LEFT JOIN public.attendance_late_records lr ON lr.employee_id = e.id AND lr.date = sf.d
    GROUP BY e.id, e.full_name, e.branch_id, e.pay_mode, e.weekly_salary
  )
  SELECT employee_id, full_name, branch_id, pay_mode,
         days_worked, days_scheduled, late_minutes, deductions,
         gross_pay, (gross_pay - deductions) AS net_pay
  FROM agg
  ORDER BY full_name;
END; $$;
GRANT EXECUTE ON FUNCTION public.payroll_period_summary(date, date, uuid, uuid) TO authenticated;

-- 8) Trigger: recalcular al registrar una "entrada"
CREATE OR REPLACE FUNCTION public._trg_recompute_late_on_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.record_type = 'entrada' THEN
    PERFORM public.compute_employee_late(
      NEW.employee_id,
      (NEW.recorded_at AT TIME ZONE 'America/Bogota')::date
    );
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_recompute_late_on_entry ON public.attendance_records;
CREATE TRIGGER trg_recompute_late_on_entry
AFTER INSERT ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public._trg_recompute_late_on_entry();

-- 9) Backfill weekly_schedule desde schedule antiguo si aplica
UPDATE public.attendance_employees
SET weekly_schedule = schedule
WHERE weekly_schedule IS NULL AND schedule IS NOT NULL;
