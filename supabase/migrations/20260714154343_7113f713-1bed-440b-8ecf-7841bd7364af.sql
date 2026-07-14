
-- 1. Table
CREATE TABLE IF NOT EXISTS public.expense_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE, -- NULL = global
  deleted_at TIMESTAMPTZ,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique name (case-insensitive) per branch scope (NULL branch = global)
CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_name_global_uidx
  ON public.expense_categories (lower(name))
  WHERE branch_id IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_name_branch_uidx
  ON public.expense_categories (branch_id, lower(name))
  WHERE branch_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS expense_categories_active_idx
  ON public.expense_categories (active, sort_order, name)
  WHERE deleted_at IS NULL;

-- 2. Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_categories TO authenticated;
GRANT ALL ON public.expense_categories TO service_role;

-- 3. RLS
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense_categories read all authenticated" ON public.expense_categories;
CREATE POLICY "expense_categories read all authenticated"
  ON public.expense_categories FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "expense_categories admin insert" ON public.expense_categories;
CREATE POLICY "expense_categories admin insert"
  ON public.expense_categories FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "expense_categories admin update" ON public.expense_categories;
CREATE POLICY "expense_categories admin update"
  ON public.expense_categories FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "expense_categories admin delete" ON public.expense_categories;
CREATE POLICY "expense_categories admin delete"
  ON public.expense_categories FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 4. Update timestamp trigger (reuse pattern)
CREATE OR REPLACE FUNCTION public.set_updated_at_expense_categories()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_categories_updated_at ON public.expense_categories;
CREATE TRIGGER trg_expense_categories_updated_at
  BEFORE UPDATE ON public.expense_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_expense_categories();

-- 5. Audit trigger writing to audit_log
CREATE OR REPLACE FUNCTION public.audit_expense_categories()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_uname TEXT;
BEGIN
  SELECT COALESCE(full_name, email) INTO v_uname FROM public.profiles WHERE id = v_uid;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (entity, entity_id, action, user_id, user_name, branch_id, before, after)
    VALUES ('expense_category', NEW.id, 'create', v_uid, v_uname, NEW.branch_id, NULL, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log (entity, entity_id, action, user_id, user_name, branch_id, before, after)
    VALUES ('expense_category', NEW.id,
      CASE
        WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'soft_delete'
        WHEN OLD.active IS DISTINCT FROM NEW.active THEN (CASE WHEN NEW.active THEN 'activate' ELSE 'deactivate' END)
        ELSE 'update'
      END,
      v_uid, v_uname, NEW.branch_id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log (entity, entity_id, action, user_id, user_name, branch_id, before, after)
    VALUES ('expense_category', OLD.id, 'delete', v_uid, v_uname, OLD.branch_id, to_jsonb(OLD), NULL);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_categories_audit ON public.expense_categories;
CREATE TRIGGER trg_expense_categories_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.expense_categories
  FOR EACH ROW EXECUTE FUNCTION public.audit_expense_categories();

-- 6. Seed default categories (global) — idempotent
INSERT INTO public.expense_categories (name, sort_order, active, branch_id)
SELECT name, ord, true, NULL
FROM (VALUES
  ('Insumos', 10),
  ('Papelería', 20),
  ('Transporte', 30),
  ('Servicios Públicos', 40),
  ('Mantenimiento', 50),
  ('Aseo', 60),
  ('Nómina', 70),
  ('Compra Menor', 80),
  ('Reembolso', 90),
  ('Caja Menor', 100),
  ('Arriendo', 110),
  ('Publicidad', 120),
  ('Otros', 999)
) AS v(name, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.expense_categories ec
  WHERE ec.branch_id IS NULL AND lower(ec.name) = lower(v.name)
);
