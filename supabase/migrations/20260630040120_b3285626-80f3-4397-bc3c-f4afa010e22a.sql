
CREATE OR REPLACE FUNCTION public.auto_occupy_table_on_sale_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _table_id uuid;
  _seats integer;
BEGIN
  SELECT s.table_id INTO _table_id FROM public.sales s WHERE s.id = NEW.sale_id;
  IF _table_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT seats INTO _seats FROM public.restaurant_tables WHERE id = _table_id;
  UPDATE public.restaurant_tables
     SET status = 'occupied',
         current_guests = COALESCE(current_guests, _seats),
         occupied_at = COALESCE(occupied_at, now())
   WHERE id = _table_id
     AND status = 'free';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_occupy_table_on_sale_item ON public.sale_items;
CREATE TRIGGER trg_auto_occupy_table_on_sale_item
AFTER INSERT ON public.sale_items
FOR EACH ROW EXECUTE FUNCTION public.auto_occupy_table_on_sale_item();

-- Liberar mesas marcadas como ocupadas que no tienen pedido pendiente con productos
UPDATE public.restaurant_tables t
   SET status = 'free', current_guests = NULL, occupied_at = NULL
 WHERE t.status = 'occupied'
   AND NOT EXISTS (
     SELECT 1 FROM public.sales s
      JOIN public.sale_items i ON i.sale_id = s.id
     WHERE s.table_id = t.id
       AND COALESCE(s.status,'pending') = 'pending'
   );
