
CREATE OR REPLACE FUNCTION public.clone_main_products_to_branch(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _main_id uuid;
  _created int := 0;
  _skipped int := 0;
  _p record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede clonar productos entre sedes';
  END IF;

  SELECT id INTO _main_id FROM public.branches WHERE is_main = true ORDER BY created_at LIMIT 1;
  IF _main_id IS NULL THEN
    RAISE EXCEPTION 'No hay sede principal configurada';
  END IF;
  IF _branch_id = _main_id THEN
    RAISE EXCEPTION 'La sede destino no puede ser la sede principal';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = _branch_id) THEN
    RAISE EXCEPTION 'La sede destino no existe';
  END IF;

  FOR _p IN
    SELECT * FROM public.products
     WHERE source_product_id IS NULL
       AND (available_branch_ids IS NULL
            OR array_length(available_branch_ids,1) IS NULL
            OR _main_id = ANY(available_branch_ids))
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.products
       WHERE source_product_id = _p.id
         AND _branch_id = ANY(available_branch_ids)
    ) THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.products (
      category_id, name, price, sku, image_url, active, stock, min_stock,
      track_stock, allow_negative_stock, sold_by_weight, show_in_online, is_favorite,
      available_branch_ids, modifier_group_ids, recipe,
      source_product_id, is_linked
    ) VALUES (
      _p.category_id, _p.name, _p.price, NULL, _p.image_url, _p.active, 0, _p.min_stock,
      _p.track_stock, _p.allow_negative_stock, _p.sold_by_weight, _p.show_in_online, _p.is_favorite,
      ARRAY[_branch_id], _p.modifier_group_ids, _p.recipe,
      _p.id, true
    );
    _created := _created + 1;
  END LOOP;

  RETURN jsonb_build_object('created', _created, 'skipped', _skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.clone_main_products_to_branch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clone_main_products_to_branch(uuid) TO authenticated;
