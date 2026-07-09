
-- 1. Add columns
ALTER TABLE public.modifier_groups
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS origin_group_id uuid;

ALTER TABLE public.modifiers
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE;

-- 2. Migrate existing data: clone every existing group into every branch
DO $$
DECLARE
  b record;
  g record;
  m record;
  new_gid uuid;
  main_id uuid;
  is_disabled boolean;
BEGIN
  SELECT id INTO main_id FROM public.branches WHERE is_main = true ORDER BY created_at LIMIT 1;

  -- Seed origin on legacy rows
  UPDATE public.modifier_groups SET origin_group_id = id WHERE origin_group_id IS NULL AND branch_id IS NULL;

  FOR g IN SELECT * FROM public.modifier_groups WHERE branch_id IS NULL LOOP
    FOR b IN SELECT id FROM public.branches LOOP
      INSERT INTO public.modifier_groups (name, min_select, max_select, required, branch_id, origin_group_id)
      VALUES (g.name, g.min_select, g.max_select, g.required, b.id, g.origin_group_id)
      RETURNING id INTO new_gid;

      FOR m IN SELECT * FROM public.modifiers WHERE group_id = g.id LOOP
        is_disabled := b.id = ANY(COALESCE(m.disabled_branch_ids, '{}'::uuid[]));
        INSERT INTO public.modifiers (group_id, name, price, active, image_url, branch_id, disabled_branch_ids)
        VALUES (new_gid, m.name, m.price, m.active AND NOT is_disabled, m.image_url, b.id, '{}'::uuid[]);
      END LOOP;
    END LOOP;
  END LOOP;

  -- Remap product.modifier_group_ids for every product to its branch-local copy
  UPDATE public.products p
  SET modifier_group_ids = (
    SELECT ARRAY(
      SELECT COALESCE(
        (SELECT ng.id FROM public.modifier_groups ng
          WHERE ng.origin_group_id = old_id
            AND ng.branch_id = CASE
              WHEN p.available_branch_ids IS NOT NULL AND array_length(p.available_branch_ids, 1) > 0
                THEN p.available_branch_ids[1]
              ELSE main_id
            END
          LIMIT 1),
        old_id
      )
      FROM unnest(p.modifier_group_ids) AS old_id
    )
  )
  WHERE array_length(p.modifier_group_ids, 1) > 0;

  -- Drop legacy global rows now that everything points to branch-scoped copies
  DELETE FROM public.modifiers WHERE branch_id IS NULL;
  DELETE FROM public.modifier_groups WHERE branch_id IS NULL;
END $$;

-- 3. Enforce NOT NULL going forward
ALTER TABLE public.modifier_groups ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE public.modifiers ALTER COLUMN branch_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS modifier_groups_branch_idx ON public.modifier_groups(branch_id);
CREATE INDEX IF NOT EXISTS modifier_groups_origin_idx ON public.modifier_groups(origin_group_id);
CREATE INDEX IF NOT EXISTS modifiers_branch_idx ON public.modifiers(branch_id);
CREATE INDEX IF NOT EXISTS modifiers_group_idx ON public.modifiers(group_id);

-- 4. Update child-product trigger: remap modifier_group_ids to the sub-branch's copies
CREATE OR REPLACE FUNCTION public.auto_create_linked_children()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _main_id uuid;
  _sub_id uuid;
  _visible_main boolean;
  _child_mod_group_ids uuid[];
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.source_product_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT id INTO _main_id FROM public.branches WHERE is_main = true ORDER BY created_at LIMIT 1;
  IF _main_id IS NULL THEN RETURN NEW; END IF;

  _visible_main := (NEW.available_branch_ids IS NULL OR array_length(NEW.available_branch_ids,1) IS NULL OR _main_id = ANY(NEW.available_branch_ids));
  IF NOT _visible_main THEN RETURN NEW; END IF;

  IF NEW.available_branch_ids IS NULL OR array_length(NEW.available_branch_ids,1) IS NULL OR array_length(NEW.available_branch_ids,1) > 1 THEN
    UPDATE public.products SET available_branch_ids = ARRAY[_main_id] WHERE id = NEW.id;
  END IF;

  FOR _sub_id IN SELECT id FROM public.branches WHERE is_main = false LOOP
    -- Map parent's (main-branch) modifier group ids to sub-branch equivalents via origin_group_id
    SELECT ARRAY(
      SELECT COALESCE(
        (SELECT ng.id FROM public.modifier_groups ng
          WHERE ng.branch_id = _sub_id
            AND ng.origin_group_id = (SELECT origin_group_id FROM public.modifier_groups WHERE id = old_id)
          LIMIT 1),
        NULL
      )
      FROM unnest(COALESCE(NEW.modifier_group_ids, '{}'::uuid[])) AS old_id
    ) INTO _child_mod_group_ids;

    -- Strip NULLs (groups without a sibling in this sub-branch)
    _child_mod_group_ids := ARRAY(SELECT x FROM unnest(_child_mod_group_ids) x WHERE x IS NOT NULL);

    INSERT INTO public.products (
      category_id, name, price, sku, image_url, active, stock, min_stock,
      track_stock, allow_negative_stock, sold_by_weight, show_in_online, is_favorite,
      available_branch_ids, modifier_group_ids, recipe,
      source_product_id, is_linked
    ) VALUES (
      NEW.category_id, NEW.name, NEW.price, NULL, NEW.image_url, NEW.active, 0, NEW.min_stock,
      NEW.track_stock, NEW.allow_negative_stock, NEW.sold_by_weight, NEW.show_in_online, NEW.is_favorite,
      ARRAY[_sub_id], _child_mod_group_ids, NEW.recipe,
      NEW.id, true
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

-- 5. Update propagation trigger: do NOT overwrite modifier_group_ids on children
CREATE OR REPLACE FUNCTION public.propagate_product_to_linked_children()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
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
    -- modifier_group_ids intentionally NOT propagated: each branch owns its own set
    recipe = NEW.recipe,
    min_stock = NEW.min_stock,
    track_stock = NEW.track_stock
  WHERE source_product_id = NEW.id
    AND is_linked = true;

  RETURN NEW;
END;
$function$;
