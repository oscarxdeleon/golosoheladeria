
-- ============================================================
-- Nómina: reglas de tardanza por bracket, descuentos manuales,
-- pagos y liquidación semanal.
-- ============================================================

-- 1) Reglas de tardanza (editable por admin/supervisor)
CREATE TABLE IF NOT EXISTS public.payroll_late_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  brackets jsonb NOT NULL DEFAULT '[
    {"min":5,"max":15,"deduct_minutes":30},
    {"min":30,"max":45,"deduct_minutes":60},
    {"min":60,"max":null,"deduct_minutes":120}
  ]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_late_rules TO authenticated;
GRANT ALL ON public.payroll_late_rules TO service_role;
ALTER TABLE public.payroll_late_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins supervisors manage late rules" ON public.payroll_late_rules;
CREATE POLICY "Admins supervisors manage late rules" ON public.payroll_late_rules
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor'));
DROP POLICY IF EXISTS "Authenticated read late rules" ON public.payroll_late_rules;
CREATE POLICY "Authenticated read late rules" ON public.payroll_late_rules
  FOR SELECT TO authenticated USING (true);

-- Fila global por defecto
INSERT INTO public.payroll_late_rules (branch_id)
  SELECT NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.payroll_late_rules WHERE branch_id IS NULL);

-- 2) Descuentos manuales
CREATE TABLE IF NOT EXISTS public.payroll_manual_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.attendance_employees(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  concept text NOT NULL,
  notes text,
  deduction_date date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Bogota')::date,
  applied_to_payment_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_manual_ded_emp ON public.payroll_manual_deductions(employee_id, applied_to_payment_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_manual_deductions TO authenticated;
GRANT ALL ON public.payroll_manual_deductions TO service_role;
ALTER TABLE public.payroll_manual_deductions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins supervisors manage manual ded" ON public.payroll_manual_deductions;
CREATE POLICY "Admins supervisors manage manual ded" ON public.payroll_manual_deductions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor'));

-- 3) Pagos
CREATE TABLE IF NOT EXISTS public.payroll_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number bigserial UNIQUE,
  employee_id uuid NOT NULL REFERENCES public.attendance_employees(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  shifts_count int NOT NULL DEFAULT 0,
  gross_amount numeric(12,2) NOT NULL DEFAULT 0,
  late_deduction numeric(12,2) NOT NULL DEFAULT 0,
  manual_deduction numeric(12,2) NOT NULL DEFAULT 0,
  net_amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL,
  paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_by_name text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  UNIQUE (employee_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_payroll_payments_emp ON public.payroll_payments(employee_id, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_payments_branch ON public.payroll_payments(branch_id, paid_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_payments TO authenticated;
GRANT ALL ON public.payroll_payments TO service_role;
ALTER TABLE public.payroll_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins supervisors manage payments" ON public.payroll_payments;
CREATE POLICY "Admins supervisors manage payments" ON public.payroll_payments
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor'));

-- 4) Snapshot inmutable del detalle de pago
CREATE TABLE IF NOT EXISTS public.payroll_payment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payroll_payments(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  day_type text NOT NULL,
  shift_rate numeric(12,2) NOT NULL DEFAULT 0,
  late_minutes int NOT NULL DEFAULT 0,
  late_deduction numeric(12,2) NOT NULL DEFAULT 0,
  worked boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_payroll_items_pay ON public.payroll_payment_items(payment_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_payment_items TO authenticated;
GRANT ALL ON public.payroll_payment_items TO service_role;
ALTER TABLE public.payroll_payment_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins supervisors read pay items" ON public.payroll_payment_items;
CREATE POLICY "Admins supervisors read pay items" ON public.payroll_payment_items
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor'));

-- ============================================================
-- 5) Recomputar tardanzas con nueva escala por bracket
-- ============================================================
CREATE OR REPLACE FUNCTION public._resolve_bracket_deduct_minutes(_late_min int, _branch_id uuid)
RETURNS int LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rules jsonb;
  b jsonb;
  bmin int; bmax int;
  result int := 0;
BEGIN
  IF _late_min <= 0 THEN RETURN 0; END IF;
  SELECT brackets INTO rules FROM public.payroll_late_rules
    WHERE active AND branch_id = _branch_id LIMIT 1;
  IF rules IS NULL THEN
    SELECT brackets INTO rules FROM public.payroll_late_rules
      WHERE active AND branch_id IS NULL LIMIT 1;
  END IF;
  IF rules IS NULL THEN
    rules := '[{"min":5,"max":15,"deduct_minutes":30},{"min":30,"max":45,"deduct_minutes":60},{"min":60,"max":null,"deduct_minutes":120}]'::jsonb;
  END IF;
  FOR b IN SELECT * FROM jsonb_array_elements(rules) LOOP
    bmin := COALESCE((b->>'min')::int, 0);
    bmax := NULLIF(b->>'max','')::int;
    IF _late_min >= bmin AND (bmax IS NULL OR _late_min <= bmax) THEN
      result := COALESCE((b->>'deduct_minutes')::int, 0);
    END IF;
  END LOOP;
  RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION public._resolve_bracket_deduct_minutes(int, uuid) TO authenticated;

-- Reescribir compute_employee_late usando brackets
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
  deduct_min int := 0;
  deduction numeric := 0;
  days_worked int;
  per_min numeric;
  rate numeric;
BEGIN
  SELECT * INTO emp FROM public.attendance_employees WHERE id = _employee_id;
  IF NOT FOUND OR NOT emp.active THEN RETURN; END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.company_holidays h
    WHERE h.date = _date AND (h.branch_id IS NULL OR h.branch_id = emp.branch_id)
  ) INTO is_hol;

  daykey := CASE WHEN is_hol THEN 'festivo' ELSE public._daykey_from_date(_date) END;
  cfg := COALESCE(emp.weekly_schedule, '{}'::jsonb) -> daykey;
  IF cfg IS NULL AND is_hol THEN
    cfg := COALESCE(emp.weekly_schedule, '{}'::jsonb) -> public._daykey_from_date(_date);
  END IF;

  works := COALESCE((cfg->>'works')::boolean, false);
  IF NOT works OR (cfg->>'in') IS NULL THEN
    DELETE FROM public.attendance_late_records WHERE employee_id = _employee_id AND date = _date;
    RETURN;
  END IF;

  sched_in := (cfg->>'in')::time;

  SELECT MIN(recorded_at) INTO actual
  FROM public.attendance_records
  WHERE employee_id = _employee_id
    AND record_type = 'entrada'
    AND (recorded_at AT TIME ZONE 'America/Bogota')::date = _date;

  IF actual IS NULL THEN
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

  -- Nueva escala por bracket
  deduct_min := public._resolve_bracket_deduct_minutes(late_min, emp.branch_id);

  IF deduct_min > 0 THEN
    IF emp.pay_mode = 'weekly_fixed' AND COALESCE(emp.weekly_salary,0) > 0 THEN
      SELECT count(*) INTO days_worked
        FROM jsonb_each(COALESCE(emp.weekly_schedule,'{}'::jsonb)) e
        WHERE e.key IN ('lun','mar','mie','jue','vie','sab','dom')
          AND COALESCE((e.value->>'works')::boolean,false);
      days_worked := GREATEST(days_worked,1);
      per_min := emp.weekly_salary / (days_worked * COALESCE(emp.hours_per_shift,8) * 60);
      deduction := ROUND(per_min * deduct_min, 2);
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
        deduction := ROUND(per_min * deduct_min, 2);
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

-- ============================================================
-- 6) Liquidación semanal (solo lectura, con desglose)
-- ============================================================
CREATE OR REPLACE FUNCTION public.payroll_weekly_liquidation(
  _employee_id uuid, _period_start date, _period_end date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp record;
  d date;
  daykey text;
  is_hol boolean;
  cfg jsonb;
  works boolean;
  worked boolean;
  rate numeric;
  gross numeric := 0;
  late_ded numeric := 0;
  shifts int := 0;
  late_min int := 0;
  manual_ded numeric := 0;
  items jsonb := '[]'::jsonb;
  manuals jsonb := '[]'::jsonb;
  lr record;
BEGIN
  SELECT * INTO emp FROM public.attendance_employees WHERE id = _employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empleado no encontrado'; END IF;

  -- Refrescar cálculos del período
  PERFORM public.compute_daily_late(_period_start, _period_end, emp.branch_id);

  d := _period_start;
  WHILE d <= _period_end LOOP
    SELECT EXISTS(SELECT 1 FROM public.company_holidays h
      WHERE h.date = d AND (h.branch_id IS NULL OR h.branch_id = emp.branch_id))
      INTO is_hol;
    daykey := CASE WHEN is_hol THEN 'festivo' ELSE public._daykey_from_date(d) END;
    cfg := COALESCE(emp.weekly_schedule,'{}'::jsonb) -> daykey;
    IF cfg IS NULL AND is_hol THEN
      cfg := COALESCE(emp.weekly_schedule,'{}'::jsonb) -> public._daykey_from_date(d);
    END IF;
    works := COALESCE((cfg->>'works')::boolean,false);

    -- Tarifa del día
    IF emp.pay_mode = 'per_shift' AND emp.shift_rates IS NOT NULL THEN
      rate := COALESCE(
        (emp.shift_rates->'per_day'->>daykey)::numeric,
        CASE WHEN is_hol OR daykey IN ('sab','dom')
          THEN (emp.shift_rates->>'weekend_holiday')::numeric
          ELSE (emp.shift_rates->>'weekday')::numeric END,
        0);
    ELSE
      rate := 0;
    END IF;

    -- ¿Trabajó ese día? (hay entrada registrada)
    SELECT * INTO lr FROM public.attendance_late_records
      WHERE employee_id = _employee_id AND date = d LIMIT 1;
    worked := lr.actual_in IS NOT NULL;

    IF worked THEN
      shifts := shifts + 1;
      IF emp.pay_mode = 'per_shift' THEN
        gross := gross + rate;
      END IF;
      late_min := late_min + COALESCE(lr.late_minutes,0);
      late_ded := late_ded + COALESCE(lr.deduction_amount,0);
    END IF;

    items := items || jsonb_build_object(
      'date', d,
      'day_type', CASE WHEN is_hol THEN 'holiday' WHEN daykey IN ('sab','dom') THEN 'weekend' ELSE 'weekday' END,
      'scheduled', works,
      'worked', worked,
      'shift_rate', COALESCE(rate,0),
      'late_minutes', COALESCE(lr.late_minutes,0),
      'late_deduction', COALESCE(lr.deduction_amount,0)
    );

    d := d + 1;
  END LOOP;

  IF emp.pay_mode = 'weekly_fixed' THEN
    gross := COALESCE(emp.weekly_salary,0);
  END IF;

  -- Descuentos manuales pendientes
  SELECT COALESCE(SUM(amount),0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'amount', amount, 'concept', concept,
           'notes', notes, 'deduction_date', deduction_date
         )),'[]'::jsonb)
    INTO manual_ded, manuals
  FROM public.payroll_manual_deductions
  WHERE employee_id = _employee_id AND applied_to_payment_id IS NULL
    AND deduction_date <= _period_end;

  RETURN jsonb_build_object(
    'employee_id', emp.id,
    'employee_name', emp.full_name,
    'document_id', emp.document_id,
    'job_position', emp.job_position,
    'branch_id', emp.branch_id,
    'period_start', _period_start,
    'period_end', _period_end,
    'pay_mode', emp.pay_mode,
    'shifts_count', shifts,
    'late_minutes', late_min,
    'gross_amount', gross,
    'late_deduction', late_ded,
    'manual_deduction', manual_ded,
    'net_amount', GREATEST(0, gross - late_ded - manual_ded),
    'items', items,
    'manual_items', manuals
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.payroll_weekly_liquidation(uuid, date, date) TO authenticated;

-- ============================================================
-- 7) Registrar pago (crea payroll_payments + items + marca manuales)
-- ============================================================
CREATE OR REPLACE FUNCTION public.payroll_register_payment(
  _employee_id uuid, _period_start date, _period_end date,
  _payment_method text, _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  liq jsonb;
  pay_id uuid;
  receipt bigint;
  emp record;
  it jsonb;
  paid_by_name_v text;
BEGIN
  IF NOT (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor')) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT * INTO emp FROM public.attendance_employees WHERE id = _employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empleado no encontrado'; END IF;

  liq := public.payroll_weekly_liquidation(_employee_id, _period_start, _period_end);

  SELECT COALESCE(full_name, email) INTO paid_by_name_v
    FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.payroll_payments (
    employee_id, branch_id, period_start, period_end,
    shifts_count, gross_amount, late_deduction, manual_deduction, net_amount,
    payment_method, paid_by, paid_by_name, notes
  ) VALUES (
    _employee_id, emp.branch_id, _period_start, _period_end,
    (liq->>'shifts_count')::int,
    (liq->>'gross_amount')::numeric,
    (liq->>'late_deduction')::numeric,
    (liq->>'manual_deduction')::numeric,
    (liq->>'net_amount')::numeric,
    _payment_method, auth.uid(), paid_by_name_v, _notes
  ) RETURNING id, receipt_number INTO pay_id, receipt;

  FOR it IN SELECT * FROM jsonb_array_elements(liq->'items') LOOP
    INSERT INTO public.payroll_payment_items (
      payment_id, work_date, day_type, shift_rate, late_minutes, late_deduction, worked
    ) VALUES (
      pay_id,
      (it->>'date')::date,
      it->>'day_type',
      (it->>'shift_rate')::numeric,
      (it->>'late_minutes')::int,
      (it->>'late_deduction')::numeric,
      (it->>'worked')::boolean
    );
  END LOOP;

  UPDATE public.payroll_manual_deductions
    SET applied_to_payment_id = pay_id
    WHERE employee_id = _employee_id
      AND applied_to_payment_id IS NULL
      AND deduction_date <= _period_end;

  RETURN jsonb_build_object(
    'payment_id', pay_id,
    'receipt_number', receipt,
    'liquidation', liq
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.payroll_register_payment(uuid, date, date, text, text) TO authenticated;

-- Recalcular tardanzas históricas con la nueva escala
SELECT public.compute_daily_late(
  (CURRENT_DATE - INTERVAL '90 days')::date,
  CURRENT_DATE
);
