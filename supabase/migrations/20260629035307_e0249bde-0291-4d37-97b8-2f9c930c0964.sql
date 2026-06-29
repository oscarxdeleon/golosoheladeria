
CREATE TABLE public.attendance_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  document_id text,
  job_position text,
  email text,
  phone text,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  schedule jsonb DEFAULT '{}'::jsonb,
  photo_url text,
  face_descriptor jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_employees TO authenticated;
GRANT ALL ON public.attendance_employees TO service_role;
ALTER TABLE public.attendance_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth view attendance employees" ON public.attendance_employees FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage attendance employees" ON public.attendance_employees FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_attendance_employees_updated BEFORE UPDATE ON public.attendance_employees
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.attendance_terminals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  authorized_lat numeric,
  authorized_lng numeric,
  authorized_radius_m integer DEFAULT 200,
  address text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_terminals TO authenticated;
GRANT SELECT ON public.attendance_terminals TO anon;
GRANT ALL ON public.attendance_terminals TO service_role;
ALTER TABLE public.attendance_terminals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone view active terminals" ON public.attendance_terminals FOR SELECT USING (active = true);
CREATE POLICY "Admins manage terminals" ON public.attendance_terminals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_attendance_terminals_updated BEFORE UPDATE ON public.attendance_terminals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.attendance_employees(id) ON DELETE CASCADE,
  terminal_id uuid REFERENCES public.attendance_terminals(id) ON DELETE SET NULL,
  record_type text NOT NULL CHECK (record_type IN ('entrada','salida','pausa_inicio','pausa_fin')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  lat numeric,
  lng numeric,
  address text,
  photo_url text,
  face_match_score numeric,
  device_info jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_records TO authenticated;
GRANT ALL ON public.attendance_records TO service_role;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth view records" ON public.attendance_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage records" ON public.attendance_records FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_att_rec_emp_time ON public.attendance_records(employee_id, recorded_at DESC);
CREATE INDEX idx_att_rec_time ON public.attendance_records(recorded_at DESC);

CREATE OR REPLACE FUNCTION public.terminal_list_employees(_slug text)
RETURNS TABLE (id uuid, full_name text, job_position text, photo_url text, face_descriptor jsonb, branch_id uuid, terminal_id uuid, terminal_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _term public.attendance_terminals;
BEGIN
  SELECT * INTO _term FROM public.attendance_terminals WHERE slug = _slug AND active = true;
  IF _term.id IS NULL THEN RAISE EXCEPTION 'Terminal no encontrada'; END IF;
  RETURN QUERY
    SELECT e.id, e.full_name, e.job_position, e.photo_url, e.face_descriptor, e.branch_id, _term.id, _term.name
    FROM public.attendance_employees e
    WHERE e.active = true AND (_term.branch_id IS NULL OR e.branch_id = _term.branch_id OR e.branch_id IS NULL);
END; $$;
GRANT EXECUTE ON FUNCTION public.terminal_list_employees(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.terminal_record_attendance(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _term public.attendance_terminals; _emp public.attendance_employees;
  _type text := _payload->>'record_type'; _rec_id uuid;
BEGIN
  SELECT * INTO _term FROM public.attendance_terminals WHERE slug = _payload->>'terminal_slug' AND active = true;
  IF _term.id IS NULL THEN RAISE EXCEPTION 'Terminal no válida'; END IF;
  SELECT * INTO _emp FROM public.attendance_employees WHERE id = (_payload->>'employee_id')::uuid AND active = true;
  IF _emp.id IS NULL THEN RAISE EXCEPTION 'Empleado no válido'; END IF;
  IF _type NOT IN ('entrada','salida','pausa_inicio','pausa_fin') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  INSERT INTO public.attendance_records(employee_id, terminal_id, record_type, lat, lng, address, photo_url, face_match_score, device_info)
  VALUES (_emp.id, _term.id, _type,
    NULLIF(_payload->>'lat','')::numeric, NULLIF(_payload->>'lng','')::numeric,
    NULLIF(_payload->>'address',''), NULLIF(_payload->>'photo_url',''),
    NULLIF(_payload->>'face_match_score','')::numeric, _payload->'device_info')
  RETURNING id INTO _rec_id;
  RETURN jsonb_build_object('id', _rec_id, 'employee_name', _emp.full_name, 'record_type', _type, 'recorded_at', now());
END; $$;
GRANT EXECUTE ON FUNCTION public.terminal_record_attendance(jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_employee_current_state(_employee_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _last text;
BEGIN
  SELECT record_type INTO _last FROM public.attendance_records
   WHERE employee_id = _employee_id AND recorded_at::date = CURRENT_DATE
   ORDER BY recorded_at DESC LIMIT 1;
  RETURN COALESCE(_last,'ninguno');
END; $$;
GRANT EXECUTE ON FUNCTION public.get_employee_current_state(uuid) TO anon, authenticated;
