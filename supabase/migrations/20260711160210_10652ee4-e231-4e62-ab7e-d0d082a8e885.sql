
CREATE OR REPLACE FUNCTION public.enforce_modifier_branch_match()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE _group_branch uuid;
BEGIN
  SELECT branch_id INTO _group_branch
  FROM public.modifier_groups
  WHERE id = NEW.group_id;

  IF _group_branch IS NULL THEN
    RAISE EXCEPTION 'El grupo del modificador no existe';
  END IF;
  IF _group_branch <> NEW.branch_id THEN
    RAISE EXCEPTION 'El modificador debe pertenecer a la misma sede que su grupo';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'No se puede mover un modificador a otra sede';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_modifier_branch_match ON public.modifiers;
CREATE TRIGGER trg_enforce_modifier_branch_match
BEFORE INSERT OR UPDATE ON public.modifiers
FOR EACH ROW EXECUTE FUNCTION public.enforce_modifier_branch_match();

CREATE OR REPLACE FUNCTION public.enforce_modifier_group_branch_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'No se puede mover un grupo de modificadores a otra sede';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_modifier_group_branch_immutable ON public.modifier_groups;
CREATE TRIGGER trg_enforce_modifier_group_branch_immutable
BEFORE UPDATE ON public.modifier_groups
FOR EACH ROW EXECUTE FUNCTION public.enforce_modifier_group_branch_immutable();
