
CREATE TABLE IF NOT EXISTS public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text not null default 'Principal',
  address text not null,
  neighborhood text,
  reference text,
  phone text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_addresses TO authenticated;
GRANT ALL ON public.customer_addresses TO service_role;

ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read addresses" ON public.customer_addresses FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert addresses" ON public.customer_addresses FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update addresses" ON public.customer_addresses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete addresses" ON public.customer_addresses FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS customer_addresses_customer_idx ON public.customer_addresses(customer_id);

CREATE TRIGGER trg_customer_addresses_touch
  BEFORE UPDATE ON public.customer_addresses
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed: crear una dirección "Principal" por cada cliente existente que tenga dirección
INSERT INTO public.customer_addresses (customer_id, label, address, neighborhood, is_default)
SELECT id, 'Principal', address, neighborhood, true
FROM public.customers
WHERE COALESCE(trim(address),'') <> ''
  AND NOT EXISTS (SELECT 1 FROM public.customer_addresses a WHERE a.customer_id = customers.id);

-- Lookup por teléfono con lista de direcciones
CREATE OR REPLACE FUNCTION public.get_customer_by_phone(_phone text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _norm text;
  _cust public.customers;
  _addrs jsonb;
BEGIN
  _norm := NULLIF(regexp_replace(COALESCE(_phone,''),'[^0-9]','','g'),'');
  IF _norm IS NULL OR length(_norm) < 7 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO _cust
  FROM public.customers
  WHERE regexp_replace(COALESCE(phone,''),'[^0-9]','','g') = _norm
  LIMIT 1;

  IF _cust.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'label', a.label,
    'address', a.address,
    'neighborhood', a.neighborhood,
    'reference', a.reference,
    'phone', a.phone,
    'is_default', a.is_default
  ) ORDER BY a.is_default DESC, a.created_at ASC), '[]'::jsonb)
  INTO _addrs
  FROM public.customer_addresses a
  WHERE a.customer_id = _cust.id;

  RETURN jsonb_build_object(
    'found', true,
    'customer', jsonb_build_object(
      'id', _cust.id,
      'name', _cust.name,
      'phone', _cust.phone,
      'address', _cust.address,
      'neighborhood', _cust.neighborhood
    ),
    'addresses', _addrs
  );
END;
$$;
