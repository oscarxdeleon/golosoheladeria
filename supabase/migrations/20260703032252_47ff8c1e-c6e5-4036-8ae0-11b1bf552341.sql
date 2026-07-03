
-- 1. Columnas nuevas
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS source_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_linked boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_products_source ON public.products(source_product_id) WHERE source_product_id IS NOT NULL;

-- 2. Backfill: para cada producto sin source, si es visible en la sede principal y también en la sucursal,
-- se separa: la fila original queda para la principal y se crea una copia vinculada para la sucursal.
DO $$
DECLARE
  _main_id uuid;
  _sub_id uuid;
  _p RECORD;
  _new_id uuid;
  _visible_main boolean;
  _visible_sub boolean;
BEGIN
  SELECT id INTO _main_id FROM public.branches WHERE is_main = true ORDER BY created_at LIMIT 1;
  IF _main_id IS NULL THEN RETURN; END IF;

  FOR _p IN
    SELECT * FROM public.products WHERE source_product_id IS NULL
  LOOP
    _visible_main := (_p.available_branch_ids IS NULL OR array_length(_p.available_branch_ids,1) IS NULL OR _main_id = ANY(_p.available_branch_ids));

    -- Para cada sucursal (no principal)
    FOR _sub_id IN
      SELECT b.id FROM public.branches b WHERE b.is_main = false
    LOOP
      _visible_sub := (_p.available_branch_ids IS NULL OR array_length(_p.available_branch_ids,1) IS NULL OR _sub_id = ANY(_p.available_branch_ids));

      IF _visible_main AND _visible_sub THEN
        -- Verificar que no exista ya un hijo para esta sucursal
        IF NOT EXISTS (
          SELECT 1 FROM public.products
           WHERE source_product_id = _p.id AND available_branch_ids = ARRAY[_sub_id]
        ) THEN
          INSERT INTO public.products (
            category_id, name, price, sku, image_url, active, stock, min_stock,
            track_stock, allow_negative_stock, sold_by_weight, show_in_online, is_favorite,
            available_branch_ids, modifier_group_ids, recipe,
            source_product_id, is_linked
          ) VALUES (
            _p.category_id, _p.name, _p.price, NULL, _p.image_url, _p.active, 0, _p.min_stock,
            _p.track_stock, _p.allow_negative_stock, _p.sold_by_weight, _p.show_in_online, _p.is_favorite,
            ARRAY[_sub_id], _p.modifier_group_ids, _p.recipe,
            _p.id, true
          )
          RETURNING id INTO _new_id;
        END IF;
      END IF;
    END LOOP;

    -- Ajustar la fila original: si es visible en principal, restringirla solo a principal
    IF _visible_main THEN
      UPDATE public.products
         SET available_branch_ids = ARRAY[_main_id]
       WHERE id = _p.id;
    END IF;
  END LOOP;
END $$;

-- 3. Trigger de propagación a hijos vinculados
CREATE OR REPLACE FUNCTION public.propagate_product_to_linked_children()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo propagar cuando el UPDATE viene de un usuario (no de otra propagación)
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  -- Solo productos "padre" propagan (los hijos no propagan a nietos)
  IF NEW.source_product_id IS NOT NULL THEN RETURN NEW; END IF;

  UPDATE public.products SET
    name = NEW.name,
    price = NEW.price,
    category_id = NEW.category_id,
    image_url = NEW.image_url,
    active = NEW.active,
    allow_negative_stock = NEW.allow_negative_stock,
    sold_by_weight = NEW.sold_by_weight,
    show_in_online = NEW.show_in_online,
    is_favorite = NEW.is_favorite,
    modifier_group_ids = NEW.modifier_group_ids,
    recipe = NEW.recipe,
    min_stock = NEW.min_stock,
    track_stock = NEW.track_stock
  WHERE source_product_id = NEW.id
    AND is_linked = true;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_product_to_linked ON public.products;
CREATE TRIGGER trg_propagate_product_to_linked
AFTER UPDATE ON public.products
FOR EACH ROW
WHEN (
  OLD.name IS DISTINCT FROM NEW.name
  OR OLD.price IS DISTINCT FROM NEW.price
  OR OLD.category_id IS DISTINCT FROM NEW.category_id
  OR OLD.image_url IS DISTINCT FROM NEW.image_url
  OR OLD.active IS DISTINCT FROM NEW.active
  OR OLD.allow_negative_stock IS DISTINCT FROM NEW.allow_negative_stock
  OR OLD.sold_by_weight IS DISTINCT FROM NEW.sold_by_weight
  OR OLD.show_in_online IS DISTINCT FROM NEW.show_in_online
  OR OLD.is_favorite IS DISTINCT FROM NEW.is_favorite
  OR OLD.modifier_group_ids IS DISTINCT FROM NEW.modifier_group_ids
  OR OLD.recipe IS DISTINCT FROM NEW.recipe
  OR OLD.min_stock IS DISTINCT FROM NEW.min_stock
  OR OLD.track_stock IS DISTINCT FROM NEW.track_stock
)
EXECUTE FUNCTION public.propagate_product_to_linked_children();

-- 4. Trigger de auto-creación de hijos al insertar un producto principal
CREATE OR REPLACE FUNCTION public.auto_create_linked_children()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _main_id uuid;
  _sub_id uuid;
  _visible_main boolean;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.source_product_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT id INTO _main_id FROM public.branches WHERE is_main = true ORDER BY created_at LIMIT 1;
  IF _main_id IS NULL THEN RETURN NEW; END IF;

  _visible_main := (NEW.available_branch_ids IS NULL OR array_length(NEW.available_branch_ids,1) IS NULL OR _main_id = ANY(NEW.available_branch_ids));
  IF NOT _visible_main THEN RETURN NEW; END IF;

  -- Si la fila cubre múltiples sedes, restringirla a la principal
  IF NEW.available_branch_ids IS NULL OR array_length(NEW.available_branch_ids,1) IS NULL OR array_length(NEW.available_branch_ids,1) > 1 THEN
    UPDATE public.products SET available_branch_ids = ARRAY[_main_id] WHERE id = NEW.id;
  END IF;

  FOR _sub_id IN SELECT id FROM public.branches WHERE is_main = false LOOP
    INSERT INTO public.products (
      category_id, name, price, sku, image_url, active, stock, min_stock,
      track_stock, allow_negative_stock, sold_by_weight, show_in_online, is_favorite,
      available_branch_ids, modifier_group_ids, recipe,
      source_product_id, is_linked
    ) VALUES (
      NEW.category_id, NEW.name, NEW.price, NULL, NEW.image_url, NEW.active, 0, NEW.min_stock,
      NEW.track_stock, NEW.allow_negative_stock, NEW.sold_by_weight, NEW.show_in_online, NEW.is_favorite,
      ARRAY[_sub_id], NEW.modifier_group_ids, NEW.recipe,
      NEW.id, true
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_linked_children ON public.products;
CREATE TRIGGER trg_auto_create_linked_children
AFTER INSERT ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.auto_create_linked_children();

-- 5. Función para resincronizar un hijo desde su padre
CREATE OR REPLACE FUNCTION public.resync_product_from_parent(_child_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _parent public.products;
BEGIN
  SELECT p.* INTO _parent
    FROM public.products c
    JOIN public.products p ON p.id = c.source_product_id
   WHERE c.id = _child_id;
  IF _parent.id IS NULL THEN
    RAISE EXCEPTION 'Este producto no tiene una sede principal vinculada';
  END IF;

  UPDATE public.products SET
    name = _parent.name,
    price = _parent.price,
    category_id = _parent.category_id,
    image_url = _parent.image_url,
    active = _parent.active,
    allow_negative_stock = _parent.allow_negative_stock,
    sold_by_weight = _parent.sold_by_weight,
    show_in_online = _parent.show_in_online,
    is_favorite = _parent.is_favorite,
    modifier_group_ids = _parent.modifier_group_ids,
    recipe = _parent.recipe,
    min_stock = _parent.min_stock,
    track_stock = _parent.track_stock,
    is_linked = true
  WHERE id = _child_id;
END;
$$;
