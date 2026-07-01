
CREATE TABLE public.waiter_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  table_id uuid REFERENCES public.restaurant_tables(id) ON DELETE CASCADE,
  table_number integer,
  table_label text,
  status text NOT NULL DEFAULT 'pending',
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  attended_at timestamptz,
  attended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  attended_by_name text
);

CREATE INDEX idx_waiter_calls_branch_status ON public.waiter_calls(branch_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.waiter_calls TO authenticated;
GRANT SELECT ON public.waiter_calls TO anon;
GRANT ALL ON public.waiter_calls TO service_role;

ALTER TABLE public.waiter_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read waiter calls" ON public.waiter_calls FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth update waiter calls" ON public.waiter_calls FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth insert waiter calls" ON public.waiter_calls FOR INSERT TO authenticated WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.waiter_calls;
ALTER TABLE public.waiter_calls REPLICA IDENTITY FULL;

-- Public RPC: create a waiter call from table QR (no auth)
CREATE OR REPLACE FUNCTION public.create_waiter_call(_table_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _t public.restaurant_tables;
  _existing uuid;
  _id uuid;
BEGIN
  IF _table_id IS NULL THEN
    RAISE EXCEPTION 'Mesa requerida';
  END IF;
  SELECT * INTO _t FROM public.restaurant_tables WHERE id = _table_id AND active = true;
  IF _t.id IS NULL THEN
    RAISE EXCEPTION 'Mesa no encontrada';
  END IF;

  -- Evitar múltiples llamadas activas de la misma mesa en 30s
  SELECT id INTO _existing
    FROM public.waiter_calls
   WHERE table_id = _t.id AND status = 'pending'
     AND created_at > now() - interval '30 seconds'
   LIMIT 1;
  IF _existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', _existing, 'duplicate', true);
  END IF;

  INSERT INTO public.waiter_calls(branch_id, table_id, table_number, table_label, reason, status)
  VALUES (_t.branch_id, _t.id, _t.number, _t.label, NULLIF(trim(COALESCE(_reason,'')),''), 'pending')
  RETURNING id INTO _id;

  RETURN jsonb_build_object('ok', true, 'id', _id);
END $$;

GRANT EXECUTE ON FUNCTION public.create_waiter_call(uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.attend_waiter_call(_call_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _user_name text;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT COALESCE(full_name,'Usuario') INTO _user_name FROM public.profiles WHERE id = _user_id;
  UPDATE public.waiter_calls
     SET status = 'attended',
         attended_at = now(),
         attended_by = _user_id,
         attended_by_name = _user_name
   WHERE id = _call_id AND status = 'pending';
  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.attend_waiter_call(uuid) TO authenticated;
