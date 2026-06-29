
-- 1. Add slug column to branches
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS slug text;

-- Backfill slug from name (lowercased, hyphenated, no diacritics — best effort using translate)
UPDATE public.branches
   SET slug = regexp_replace(
                lower(translate(name,
                  'ÁÉÍÓÚÜÑáéíóúüñ',
                  'AEIOUUNaeiouun')),
                '[^a-z0-9]+', '-', 'g')
 WHERE slug IS NULL OR slug = '';

UPDATE public.branches SET slug = trim(both '-' from slug);

-- Ensure uniqueness; if collision, append id suffix
UPDATE public.branches b
   SET slug = b.slug || '-' || substr(b.id::text, 1, 4)
 WHERE EXISTS (
   SELECT 1 FROM public.branches x WHERE x.slug = b.slug AND x.id <> b.id
 );

CREATE UNIQUE INDEX IF NOT EXISTS branches_slug_unique ON public.branches(slug) WHERE slug IS NOT NULL;

-- Allow anon read of branch id+slug+name for public menu/kiosk routing
DROP POLICY IF EXISTS "Branches public lookup" ON public.branches;
CREATE POLICY "Branches public lookup" ON public.branches FOR SELECT TO anon USING (true);
GRANT SELECT ON public.branches TO anon;

-- 2. Update create_public_order to accept and persist branch_id
CREATE OR REPLACE FUNCTION public.create_public_order(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _source text := COALESCE(_payload->>'source','online_menu');
  _items jsonb := COALESCE(_payload->'items','[]'::jsonb);
  _sale_id uuid;
  _ticket integer;
  _subtotal numeric(12,2) := 0;
  _delivery_fee numeric(12,2) := 0;
  _total numeric(12,2) := 0;
  _item jsonb;
  _qty numeric;
  _price numeric;
  _branch_id uuid;
  _branch_slug text;
  _table_id uuid;
BEGIN
  IF _source NOT IN ('online_menu','kiosk','table_qr') THEN
    RAISE EXCEPTION 'Origen de pedido no válido';
  END IF;

  IF jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'El pedido no contiene productos';
  END IF;

  -- Resolver branch_id: explícito > slug > tabla > principal
  _branch_id := NULLIF(_payload->>'branch_id','')::uuid;
  _branch_slug := NULLIF(_payload->>'branch_slug','');
  _table_id := NULLIF(_payload->>'table_id','')::uuid;

  IF _branch_id IS NULL AND _branch_slug IS NOT NULL THEN
    SELECT id INTO _branch_id FROM public.branches WHERE slug = _branch_slug LIMIT 1;
  END IF;

  IF _branch_id IS NULL AND _table_id IS NOT NULL THEN
    SELECT branch_id INTO _branch_id FROM public.restaurant_tables WHERE id = _table_id;
  END IF;

  IF _branch_id IS NULL THEN
    SELECT id INTO _branch_id FROM public.branches WHERE is_main = true ORDER BY created_at LIMIT 1;
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := COALESCE((_item->>'qty')::numeric, 0);
    SELECT price INTO _price FROM public.products WHERE id = (_item->>'product_id')::uuid AND active = true;
    IF _price IS NULL THEN
      RAISE EXCEPTION 'Producto no disponible';
    END IF;
    _subtotal := _subtotal + (_price * _qty);
  END LOOP;

  IF _source = 'online_menu' THEN
    SELECT COALESCE(delivery_fee, 0) INTO _delivery_fee FROM public.settings LIMIT 1;
    IF _delivery_fee IS NULL THEN _delivery_fee := 0; END IF;
  END IF;

  _total := _subtotal + _delivery_fee;

  INSERT INTO public.sales (
    user_id, user_name, source, status, order_type,
    table_id, branch_id, subtotal, total, delivery_fee, payment_method,
    customer_name, customer_phone, delivery_address, delivery_neighborhood,
    notes, payment_details
  ) VALUES (
    NULL,
    COALESCE(NULLIF(_payload->>'user_name',''),'Cliente'),
    _source,
    'pending',
    COALESCE(_payload->>'order_type','llevar'),
    _table_id,
    _branch_id,
    _subtotal,
    _total,
    _delivery_fee,
    COALESCE(NULLIF(_payload->>'payment_method',''),'Pendiente'),
    NULLIF(_payload->>'customer_name',''),
    NULLIF(_payload->>'customer_phone',''),
    NULLIF(_payload->>'delivery_address',''),
    NULLIF(_payload->>'delivery_neighborhood',''),
    NULLIF(_payload->>'notes',''),
    _payload->'payment_details'
  )
  RETURNING id, ticket_number INTO _sale_id, _ticket;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := COALESCE((_item->>'qty')::numeric, 0);
    SELECT price INTO _price FROM public.products WHERE id = (_item->>'product_id')::uuid;
    INSERT INTO public.sale_items (sale_id, product_id, product_name, unit_price, qty, subtotal)
    VALUES (
      _sale_id,
      (_item->>'product_id')::uuid,
      COALESCE(_item->>'name','Producto'),
      _price,
      _qty,
      _price * _qty
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', _sale_id,
    'ticket_number', _ticket,
    'branch_id', _branch_id,
    'subtotal', _subtotal,
    'delivery_fee', _delivery_fee,
    'total', _total
  );
END;
$function$;
