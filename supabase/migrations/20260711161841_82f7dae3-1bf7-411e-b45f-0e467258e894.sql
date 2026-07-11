-- #8 Integración automática con Inventario: proteger integridad al eliminar/duplicar

CREATE OR REPLACE FUNCTION public.prevent_delete_product_in_use()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sale_items WHERE product_id = OLD.id LIMIT 1) THEN
    RAISE EXCEPTION 'No se puede eliminar el producto "%": tiene ventas registradas. Desactívalo en lugar de eliminarlo.', OLD.name
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_delete_product_in_use ON public.products;
CREATE TRIGGER trg_prevent_delete_product_in_use
BEFORE DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.prevent_delete_product_in_use();

CREATE OR REPLACE FUNCTION public.prevent_delete_category_in_use()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt FROM public.products WHERE category_id = OLD.id AND active = true;
  IF cnt > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar la categoría "%": tiene % productos activos. Muévelos o desactívalos primero.', OLD.name, cnt
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_delete_category_in_use ON public.categories;
CREATE TRIGGER trg_prevent_delete_category_in_use
BEFORE DELETE ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.prevent_delete_category_in_use();

-- Evitar modificadores duplicados dentro del mismo grupo por sede (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS uq_modifiers_group_name_ci
ON public.modifiers (branch_id, group_id, lower(name));
