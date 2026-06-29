
-- Extend customers with channel + aggregates and ensure phone-based upsert key
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS last_order_at timestamptz;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS total_orders integer NOT NULL DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS frequent_channel text;

CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_uniq
  ON public.customers (phone)
  WHERE phone IS NOT NULL AND phone <> '';

-- New unified trigger: captures customer from any sales channel
CREATE OR REPLACE FUNCTION public.sync_customer_from_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _phone text;
  _name text;
  _cust_id uuid;
  _is_complete boolean;
  _was_complete boolean;
BEGIN
  _is_complete := COALESCE(NEW.status,'completed') NOT IN ('pending','cancelled');
  _was_complete := TG_OP = 'UPDATE' AND COALESCE(OLD.status,'completed') NOT IN ('pending','cancelled');
  IF NOT _is_complete OR _was_complete THEN RETURN NEW; END IF;

  _phone := NULLIF(regexp_replace(COALESCE(NEW.customer_phone,''),'[^0-9]','','g'),'');
  _name  := NULLIF(trim(COALESCE(NEW.customer_name,'')),'');

  IF _phone IS NULL AND NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  _cust_id := NEW.customer_id;

  IF _cust_id IS NULL AND _phone IS NOT NULL THEN
    SELECT id INTO _cust_id
      FROM public.customers
     WHERE regexp_replace(COALESCE(phone,''),'[^0-9]','','g') = _phone
     LIMIT 1;

    IF _cust_id IS NULL THEN
      INSERT INTO public.customers(name, phone, address, neighborhood)
      VALUES (
        COALESCE(_name,'Cliente'),
        _phone,
        NULLIF(NEW.delivery_address,''),
        NULLIF(NEW.delivery_neighborhood,'')
      )
      RETURNING id INTO _cust_id;
    END IF;

    UPDATE public.sales SET customer_id = _cust_id WHERE id = NEW.id;
  END IF;

  UPDATE public.customers SET
    name             = CASE WHEN _name IS NOT NULL THEN _name ELSE name END,
    address          = COALESCE(NULLIF(NEW.delivery_address,''), address),
    neighborhood     = COALESCE(NULLIF(NEW.delivery_neighborhood,''), neighborhood),
    total_spent      = COALESCE(total_spent,0) + COALESCE(NEW.total,0),
    total_orders     = COALESCE(total_orders,0) + 1,
    visits           = COALESCE(visits,0) + 1,
    points           = COALESCE(points,0) + floor(COALESCE(NEW.total,0)/1000)::int,
    last_order_at    = COALESCE(NEW.created_at, now()),
    frequent_channel = (
      SELECT COALESCE(source, order_type, 'pos')
        FROM public.sales
       WHERE customer_id = _cust_id
         AND COALESCE(status,'completed') <> 'cancelled'
       GROUP BY COALESCE(source, order_type, 'pos')
       ORDER BY COUNT(*) DESC
       LIMIT 1
    ),
    updated_at       = now()
  WHERE id = _cust_id;

  RETURN NEW;
END;
$$;

-- Replace older loyalty trigger so we don't double-count
DROP TRIGGER IF EXISTS sales_loyalty_insert ON public.sales;
DROP TRIGGER IF EXISTS sales_loyalty_update ON public.sales;
DROP TRIGGER IF EXISTS sales_sync_customer ON public.sales;

CREATE TRIGGER sales_sync_customer
AFTER INSERT OR UPDATE OF status ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.sync_customer_from_sale();

-- Realtime for live CRM updates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'customers'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.customers';
  END IF;
END $$;

ALTER TABLE public.customers REPLICA IDENTITY FULL;
