CREATE OR REPLACE FUNCTION public.resync_product_from_parent(_child_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _parent public.products;
  _child public.products;
  _target_branch_id uuid;
  _mapped_group_ids uuid[];
BEGIN
  SELECT c.* INTO _child
    FROM public.products c
   WHERE c.id = _child_id;

  IF _child.id IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  SELECT p.* INTO _parent
    FROM public.products p
   WHERE p.id = _child.source_product_id;

  IF _parent.id IS NULL THEN
    RAISE EXCEPTION 'Este producto no tiene una sede principal vinculada';
  END IF;

  SELECT bid INTO _target_branch_id
  FROM unnest(COALESCE(_child.available_branch_ids, '{}'::uuid[])) AS bid
  LIMIT 1;

  SELECT ARRAY(
    SELECT COALESCE(
      (
        SELECT target_group.id
        FROM public.modifier_groups source_group
        JOIN public.modifier_groups target_group
          ON target_group.origin_group_id = source_group.origin_group_id
         AND target_group.branch_id = _target_branch_id
        WHERE source_group.id = source_group_id
        LIMIT 1
      ),
      source_group_id
    )
    FROM unnest(COALESCE(_parent.modifier_group_ids, '{}'::uuid[])) AS source_group_id
  ) INTO _mapped_group_ids;

  _mapped_group_ids := ARRAY(SELECT x FROM unnest(COALESCE(_mapped_group_ids, '{}'::uuid[])) x WHERE x IS NOT NULL);

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
    modifier_group_ids = _mapped_group_ids,
    recipe = _parent.recipe,
    min_stock = _parent.min_stock,
    track_stock = _parent.track_stock,
    is_linked = true
  WHERE id = _child_id;
END;
$function$;