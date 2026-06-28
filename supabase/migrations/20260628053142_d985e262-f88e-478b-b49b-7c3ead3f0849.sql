
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  address text,
  neighborhood text,
  email text,
  points integer NOT NULL DEFAULT 0,
  total_spent numeric NOT NULL DEFAULT 0,
  visits integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_phone_idx ON public.customers(phone);
CREATE INDEX customers_name_idx ON public.customers(name);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers auth read" ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "customers auth write" ON public.customers FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER customers_touch BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Vínculo opcional cliente <-> venta
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sales_customer_id_idx ON public.sales(customer_id);

-- Acumular fidelización automáticamente en ventas cobradas
CREATE OR REPLACE FUNCTION public.apply_customer_loyalty()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  pts integer;
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.status,'completed') = 'pending' THEN RETURN NEW; END IF;
  pts := floor(COALESCE(NEW.total,0) / 1000)::int;
  UPDATE public.customers
    SET points = points + pts,
        total_spent = total_spent + COALESCE(NEW.total,0),
        visits = visits + 1,
        updated_at = now()
    WHERE id = NEW.customer_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sales_loyalty_insert ON public.sales;
CREATE TRIGGER sales_loyalty_insert AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.apply_customer_loyalty();
