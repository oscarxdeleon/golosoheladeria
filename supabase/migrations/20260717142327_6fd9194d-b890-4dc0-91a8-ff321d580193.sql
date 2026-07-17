ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS branch_id uuid;

UPDATE public.sale_items si
SET branch_id = s.branch_id
FROM public.sales s
WHERE si.sale_id = s.id
  AND si.branch_id IS DISTINCT FROM s.branch_id;

CREATE OR REPLACE FUNCTION public.set_sale_item_branch_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT s.branch_id INTO NEW.branch_id
  FROM public.sales s
  WHERE s.id = NEW.sale_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_sale_item_branch_id ON public.sale_items;
CREATE TRIGGER trg_set_sale_item_branch_id
BEFORE INSERT OR UPDATE OF sale_id ON public.sale_items
FOR EACH ROW
EXECUTE FUNCTION public.set_sale_item_branch_id();

CREATE INDEX IF NOT EXISTS idx_sale_items_branch_id ON public.sale_items(branch_id);

ALTER TABLE public.sale_items REPLICA IDENTITY FULL;