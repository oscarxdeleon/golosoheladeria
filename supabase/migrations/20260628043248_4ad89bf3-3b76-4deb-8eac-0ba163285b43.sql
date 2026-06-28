
-- CASH SESSIONS (apertura/cierre de caja)
CREATE TABLE public.cash_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  opening_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  counted_amount NUMERIC(12,2),
  expected_amount NUMERIC(12,2),
  difference NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_notes TEXT,
  closing_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_sessions TO authenticated;
GRANT ALL ON public.cash_sessions TO service_role;

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cajeros ven sus propias sesiones, admin ve todas"
  ON public.cash_sessions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Empleado abre su propia sesión"
  ON public.cash_sessions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Empleado cierra su sesión, admin cualquier sesión"
  ON public.cash_sessions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin elimina sesiones"
  ON public.cash_sessions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_cash_sessions_open ON public.cash_sessions(status, user_id);

-- RESTAURANT TABLES (mesas)
CREATE TABLE public.restaurant_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL UNIQUE,
  label TEXT,
  seats INT NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','occupied','reserved')),
  pos_x INT NOT NULL DEFAULT 0,
  pos_y INT NOT NULL DEFAULT 0,
  current_guests INT,
  occupied_at TIMESTAMPTZ,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_tables TO authenticated;
GRANT ALL ON public.restaurant_tables TO service_role;

ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados ven mesas"
  ON public.restaurant_tables FOR SELECT TO authenticated USING (true);

CREATE POLICY "Autenticados actualizan estado de mesa"
  ON public.restaurant_tables FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Admin crea mesas"
  ON public.restaurant_tables FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin elimina mesas"
  ON public.restaurant_tables FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_restaurant_tables_updated
  BEFORE UPDATE ON public.restaurant_tables
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed: 8 mesas de ejemplo en una cuadrícula
INSERT INTO public.restaurant_tables (number, label, seats, pos_x, pos_y) VALUES
  (1, 'Mesa 1', 2, 0, 0),
  (2, 'Mesa 2', 4, 1, 0),
  (3, 'Mesa 3', 4, 2, 0),
  (4, 'Mesa 4', 6, 3, 0),
  (5, 'Mesa 5', 2, 0, 1),
  (6, 'Mesa 6', 4, 1, 1),
  (7, 'Mesa 7', 4, 2, 1),
  (8, 'Mesa 8', 6, 3, 1);
