-- #9 Validaciones + #10 Auditoría automática para productos, categorías y modificadores

-- ============ #9 Validaciones ============

-- Nombres no vacíos en productos/categorías/modificadores/grupos
CREATE OR REPLACE FUNCTION public.validate_nonempty_name()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.name IS NULL OR btrim(NEW.name) = '' THEN
    RAISE EXCEPTION 'El nombre no puede estar vacío' USING ERRCODE = 'check_violation';
  END IF;
  NEW.name := btrim(NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_validate_name ON public.products;
CREATE TRIGGER trg_products_validate_name
BEFORE INSERT OR UPDATE OF name ON public.products
FOR EACH ROW EXECUTE FUNCTION public.validate_nonempty_name();

DROP TRIGGER IF EXISTS trg_categories_validate_name ON public.categories;
CREATE TRIGGER trg_categories_validate_name
BEFORE INSERT OR UPDATE OF name ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.validate_nonempty_name();

DROP TRIGGER IF EXISTS trg_modifiers_validate_name ON public.modifiers;
CREATE TRIGGER trg_modifiers_validate_name
BEFORE INSERT OR UPDATE OF name ON public.modifiers
FOR EACH ROW EXECUTE FUNCTION public.validate_nonempty_name();

DROP TRIGGER IF EXISTS trg_modifier_groups_validate_name ON public.modifier_groups;
CREATE TRIGGER trg_modifier_groups_validate_name
BEFORE INSERT OR UPDATE OF name ON public.modifier_groups
FOR EACH ROW EXECUTE FUNCTION public.validate_nonempty_name();

-- Impedir precios negativos en productos y modificadores
CREATE OR REPLACE FUNCTION public.validate_nonneg_price()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.price IS NOT NULL AND NEW.price < 0 THEN
    RAISE EXCEPTION 'El precio no puede ser negativo' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_validate_price ON public.products;
CREATE TRIGGER trg_products_validate_price
BEFORE INSERT OR UPDATE OF price ON public.products
FOR EACH ROW EXECUTE FUNCTION public.validate_nonneg_price();

DROP TRIGGER IF EXISTS trg_modifiers_validate_price ON public.modifiers;
CREATE TRIGGER trg_modifiers_validate_price
BEFORE INSERT OR UPDATE OF price ON public.modifiers
FOR EACH ROW EXECUTE FUNCTION public.validate_nonneg_price();

-- ============ #10 Auditoría automática ============

CREATE OR REPLACE FUNCTION public.audit_entity_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity text := TG_ARGV[0];
  v_action text;
  v_entity_id uuid;
  v_branch uuid;
  v_uid uuid;
  v_uname text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    SELECT full_name INTO v_uname FROM public.profiles WHERE id = v_uid;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_entity_id := NEW.id;
    BEGIN v_branch := NEW.branch_id; EXCEPTION WHEN OTHERS THEN v_branch := NULL; END;
    INSERT INTO public.audit_log (entity, entity_id, action, user_id, user_name, branch_id, after)
    VALUES (v_entity, v_entity_id, v_action, v_uid, v_uname, v_branch, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) = to_jsonb(OLD) THEN RETURN NEW; END IF;
    v_action := 'updated';
    v_entity_id := NEW.id;
    BEGIN v_branch := NEW.branch_id; EXCEPTION WHEN OTHERS THEN v_branch := NULL; END;
    INSERT INTO public.audit_log (entity, entity_id, action, user_id, user_name, branch_id, before, after)
    VALUES (v_entity, v_entity_id, v_action, v_uid, v_uname, v_branch, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'deleted';
    v_entity_id := OLD.id;
    BEGIN v_branch := OLD.branch_id; EXCEPTION WHEN OTHERS THEN v_branch := NULL; END;
    INSERT INTO public.audit_log (entity, entity_id, action, user_id, user_name, branch_id, before)
    VALUES (v_entity, v_entity_id, v_action, v_uid, v_uname, v_branch, to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_products ON public.products;
CREATE TRIGGER trg_audit_products
AFTER INSERT OR UPDATE OR DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.audit_entity_changes('product');

DROP TRIGGER IF EXISTS trg_audit_categories ON public.categories;
CREATE TRIGGER trg_audit_categories
AFTER INSERT OR UPDATE OR DELETE ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.audit_entity_changes('category');

DROP TRIGGER IF EXISTS trg_audit_modifiers ON public.modifiers;
CREATE TRIGGER trg_audit_modifiers
AFTER INSERT OR UPDATE OR DELETE ON public.modifiers
FOR EACH ROW EXECUTE FUNCTION public.audit_entity_changes('modifier');

DROP TRIGGER IF EXISTS trg_audit_modifier_groups ON public.modifier_groups;
CREATE TRIGGER trg_audit_modifier_groups
AFTER INSERT OR UPDATE OR DELETE ON public.modifier_groups
FOR EACH ROW EXECUTE FUNCTION public.audit_entity_changes('modifier_group');
