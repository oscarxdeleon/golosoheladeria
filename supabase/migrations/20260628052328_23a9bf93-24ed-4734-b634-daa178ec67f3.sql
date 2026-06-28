
-- Add stock fields to products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_stock numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT false;

-- Inventory movements (entrada / salida / ajuste) for products or supplies
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type text NOT NULL CHECK (item_type IN ('product','supply')),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  supply_id uuid REFERENCES public.supplies(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('entrada','salida','ajuste')),
  quantity numeric NOT NULL,
  reason text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (item_type = 'product' AND product_id IS NOT NULL AND supply_id IS NULL) OR
    (item_type = 'supply'  AND supply_id  IS NOT NULL AND product_id IS NULL)
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_movements TO authenticated;
GRANT ALL ON public.inventory_movements TO service_role;

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inv read" ON public.inventory_movements
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'cajero'));

CREATE POLICY "inv write admin" ON public.inventory_movements
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'))
  WITH CHECK (has_role(auth.uid(),'admin'));

-- Trigger: apply movement to stock
CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  delta numeric;
BEGIN
  IF NEW.movement_type = 'entrada' THEN delta := NEW.quantity;
  ELSIF NEW.movement_type = 'salida' THEN delta := -NEW.quantity;
  ELSE delta := NEW.quantity; -- ajuste: set absolute
  END IF;

  IF NEW.item_type = 'product' THEN
    IF NEW.movement_type = 'ajuste' THEN
      UPDATE public.products SET stock = NEW.quantity WHERE id = NEW.product_id;
    ELSE
      UPDATE public.products SET stock = stock + delta WHERE id = NEW.product_id;
    END IF;
  ELSE
    IF NEW.movement_type = 'ajuste' THEN
      UPDATE public.supplies SET stock = NEW.quantity WHERE id = NEW.supply_id;
    ELSE
      UPDATE public.supplies SET stock = stock + delta WHERE id = NEW.supply_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_apply_inv_mov ON public.inventory_movements;
CREATE TRIGGER trg_apply_inv_mov
  AFTER INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.apply_inventory_movement();
