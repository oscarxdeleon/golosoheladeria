CREATE OR REPLACE FUNCTION public.sale_involves_cash(_method text, _details jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(trim(coalesce(_method, ''))) LIKE 'cortes%' THEN false
    WHEN lower(trim(coalesce(_method, ''))) IN ('efectivo', 'cash') THEN true
    WHEN lower(trim(coalesce(_method, ''))) LIKE '%efectivo%' THEN true
    WHEN lower(trim(coalesce(_method, ''))) LIKE '%mixto%' THEN COALESCE(
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(_details -> 'splits', '[]'::jsonb)) AS split(part)
        WHERE lower(trim(coalesce(split.part ->> 'method', ''))) IN ('efectivo', 'cash')
           OR lower(trim(coalesce(split.part ->> 'method', ''))) LIKE '%efectivo%'
      ),
      false
    )
    ELSE COALESCE(
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(_details -> 'splits', '[]'::jsonb)) AS split(part)
        WHERE lower(trim(coalesce(split.part ->> 'method', ''))) IN ('efectivo', 'cash')
           OR lower(trim(coalesce(split.part ->> 'method', ''))) LIKE '%efectivo%'
      ),
      false
    )
  END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS print_jobs_one_cash_drawer_sale_per_sale_idx
ON public.print_jobs (sale_id)
WHERE kind = 'cash_drawer_sale';

CREATE OR REPLACE FUNCTION public.enqueue_cash_drawer_for_cash_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'paid'
     AND NEW.id IS NOT NULL
     AND public.sale_involves_cash(NEW.payment_method, NEW.payment_details)
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.payment_method IS DISTINCT FROM NEW.payment_method OR OLD.payment_details IS DISTINCT FROM NEW.payment_details)
  THEN
    INSERT INTO public.print_jobs (branch_id, sale_id, kind, payload, status)
    VALUES (
      NEW.branch_id,
      NEW.id,
      'cash_drawer_sale',
      jsonb_build_object(
        'type', 'drawer',
        'header', 'DRAWER',
        'items', jsonb_build_array(),
        'open_drawer', true
      ),
      'pending'
    )
    ON CONFLICT (sale_id) WHERE kind = 'cash_drawer_sale' DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_cash_drawer_for_cash_sale ON public.sales;
CREATE TRIGGER trg_enqueue_cash_drawer_for_cash_sale
AFTER INSERT OR UPDATE OF status, payment_method, payment_details
ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_cash_drawer_for_cash_sale();

INSERT INTO public.print_jobs (branch_id, sale_id, kind, payload, status)
SELECT
  s.branch_id,
  s.id,
  'cash_drawer_sale',
  jsonb_build_object(
    'type', 'drawer',
    'header', 'DRAWER',
    'items', jsonb_build_array(),
    'open_drawer', true
  ),
  'pending'
FROM public.sales s
WHERE s.status = 'paid'
  AND s.created_at >= now() - interval '30 minutes'
  AND public.sale_involves_cash(s.payment_method, s.payment_details)
ON CONFLICT (sale_id) WHERE kind = 'cash_drawer_sale' DO NOTHING;