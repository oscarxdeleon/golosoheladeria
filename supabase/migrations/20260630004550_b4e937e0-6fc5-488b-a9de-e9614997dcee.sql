
CREATE TABLE public.table_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('release','move','cancel')),
  table_id uuid REFERENCES public.restaurant_tables(id) ON DELETE SET NULL,
  table_number integer,
  target_table_id uuid REFERENCES public.restaurant_tables(id) ON DELETE SET NULL,
  target_table_number integer,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name text,
  reason text,
  previous_status text,
  new_status text,
  sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.table_events TO authenticated;
GRANT ALL ON public.table_events TO service_role;

ALTER TABLE public.table_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view events"
  ON public.table_events FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert events"
  ON public.table_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE INDEX idx_table_events_table ON public.table_events(table_id, created_at DESC);
CREATE INDEX idx_table_events_branch ON public.table_events(branch_id, created_at DESC);

-- RPC: move table preserving active pending sale
CREATE OR REPLACE FUNCTION public.move_table(
  _from_table_id uuid,
  _to_table_id uuid,
  _reason text DEFAULT NULL,
  _force boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user_id uuid := auth.uid();
  _from public.restaurant_tables;
  _to public.restaurant_tables;
  _sale_id uuid;
  _user_name text;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT * INTO _from FROM public.restaurant_tables WHERE id = _from_table_id FOR UPDATE;
  SELECT * INTO _to FROM public.restaurant_tables WHERE id = _to_table_id FOR UPDATE;
  IF _from.id IS NULL OR _to.id IS NULL THEN RAISE EXCEPTION 'Mesa no encontrada'; END IF;
  IF _from.id = _to.id THEN RAISE EXCEPTION 'La mesa destino es la misma que la origen'; END IF;
  IF _from.branch_id <> _to.branch_id THEN RAISE EXCEPTION 'Las mesas deben pertenecer a la misma sede'; END IF;
  IF _to.status = 'occupied' AND NOT _force THEN
    RAISE EXCEPTION 'destination_occupied';
  END IF;

  -- Move active pending sale (if any)
  UPDATE public.sales SET table_id = _to.id
   WHERE table_id = _from.id AND COALESCE(status,'pending') = 'pending'
   RETURNING id INTO _sale_id;

  UPDATE public.restaurant_tables SET
    status = 'occupied',
    current_guests = COALESCE(_to.current_guests, _from.current_guests),
    occupied_at = COALESCE(_to.occupied_at, _from.occupied_at, now())
  WHERE id = _to.id;

  UPDATE public.restaurant_tables SET
    status = 'free', current_guests = NULL, occupied_at = NULL
  WHERE id = _from.id;

  SELECT COALESCE(full_name, 'Usuario') INTO _user_name FROM public.profiles WHERE id = _user_id;

  INSERT INTO public.table_events(event_type, table_id, table_number, target_table_id, target_table_number,
    branch_id, user_id, user_name, reason, previous_status, new_status, sale_id)
  VALUES ('move', _from.id, _from.number, _to.id, _to.number, _from.branch_id, _user_id, _user_name,
    _reason, _from.status, 'free', _sale_id);

  RETURN jsonb_build_object('ok', true, 'sale_id', _sale_id);
END; $$;

CREATE OR REPLACE FUNCTION public.release_table(
  _table_id uuid,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user_id uuid := auth.uid();
  _t public.restaurant_tables;
  _user_name text;
  _prev_status text;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'Debes ingresar un motivo';
  END IF;
  SELECT * INTO _t FROM public.restaurant_tables WHERE id = _table_id FOR UPDATE;
  IF _t.id IS NULL THEN RAISE EXCEPTION 'Mesa no encontrada'; END IF;
  _prev_status := _t.status;

  -- Cancel pending sale on the table
  UPDATE public.sales SET status = 'cancelled'
   WHERE table_id = _t.id AND COALESCE(status,'pending') = 'pending';

  UPDATE public.restaurant_tables SET
    status = 'free', current_guests = NULL, occupied_at = NULL
  WHERE id = _t.id;

  SELECT COALESCE(full_name,'Usuario') INTO _user_name FROM public.profiles WHERE id = _user_id;

  INSERT INTO public.table_events(event_type, table_id, table_number, branch_id, user_id, user_name,
    reason, previous_status, new_status)
  VALUES ('release', _t.id, _t.number, _t.branch_id, _user_id, _user_name, trim(_reason), _prev_status, 'free');

  RETURN jsonb_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.move_table(uuid, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_table(uuid, text) TO authenticated;
