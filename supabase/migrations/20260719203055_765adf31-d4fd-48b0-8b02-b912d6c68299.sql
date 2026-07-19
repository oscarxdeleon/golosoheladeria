
CREATE TABLE IF NOT EXISTS public.sale_modifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name TEXT,
  kind TEXT NOT NULL DEFAULT 'add_items',
  added_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_modifications_sale_id ON public.sale_modifications(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_modifications_created_at ON public.sale_modifications(created_at DESC);

GRANT SELECT, INSERT ON public.sale_modifications TO authenticated;
GRANT ALL ON public.sale_modifications TO service_role;

ALTER TABLE public.sale_modifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins/supervisors ven historial"
  ON public.sale_modifications FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'supervisor')
    OR user_id = auth.uid()
  );

CREATE POLICY "Usuarios autenticados registran sus modificaciones"
  ON public.sale_modifications FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.log_sale_modification(
  _sale_id UUID,
  _added_items JSONB,
  _kind TEXT DEFAULT 'add_items',
  _notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _uname TEXT;
  _bid UUID;
  _new_id UUID;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión para registrar modificaciones';
  END IF;

  SELECT branch_id INTO _bid FROM public.sales WHERE id = _sale_id;
  SELECT COALESCE(full_name, email) INTO _uname FROM public.profiles WHERE id = _uid;

  INSERT INTO public.sale_modifications (sale_id, branch_id, user_id, user_name, kind, added_items, notes)
  VALUES (_sale_id, _bid, _uid, _uname, COALESCE(_kind, 'add_items'), COALESCE(_added_items, '[]'::jsonb), _notes)
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_sale_modification(UUID, JSONB, TEXT, TEXT) TO authenticated;
