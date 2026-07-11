
-- ===== 1. AUDIT LOG TABLE =====
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  user_id uuid,
  user_name text,
  branch_id uuid,
  before jsonb,
  after jsonb,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.audit_log TO authenticated;
GRANT INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit read admin" ON public.audit_log;
CREATE POLICY "audit read admin" ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "audit write authenticated" ON public.audit_log;
CREATE POLICY "audit write authenticated" ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log (entity, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_branch_idx ON public.audit_log (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON public.audit_log (user_id, created_at DESC);

-- ===== 2. TRIGGER: SYNC MODIFIER PHOTO BY NAME WITHIN BRANCH =====
CREATE OR REPLACE FUNCTION public.sync_modifier_photo_by_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
  _affected_ids uuid[];
BEGIN
  -- avoid recursion when this trigger updates siblings
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- only when image_url actually changed
  IF COALESCE(NEW.image_url, '') = COALESCE(OLD.image_url, '') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(full_name, 'Sistema') INTO _uname
  FROM public.profiles WHERE id = _uid;

  -- update siblings in the SAME branch with the SAME name, excluding NEW itself
  WITH updated AS (
    UPDATE public.modifiers m
       SET image_url = NEW.image_url
     WHERE m.branch_id = NEW.branch_id
       AND m.name = NEW.name
       AND m.id <> NEW.id
       AND COALESCE(m.image_url, '') <> COALESCE(NEW.image_url, '')
     RETURNING m.id
  )
  SELECT array_agg(id) INTO _affected_ids FROM updated;

  IF _affected_ids IS NOT NULL AND array_length(_affected_ids, 1) > 0 THEN
    INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
    VALUES (
      'modifier',
      NEW.id,
      'photo_synced',
      _uid,
      _uname,
      NEW.branch_id,
      jsonb_build_object('image_url', OLD.image_url),
      jsonb_build_object('image_url', NEW.image_url),
      jsonb_build_object(
        'name', NEW.name,
        'affected_modifier_ids', to_jsonb(_affected_ids),
        'affected_count', array_length(_affected_ids, 1)
      )
    );
  END IF;

  -- Always log the direct photo change too (for #10 auditoría)
  INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
  VALUES (
    'modifier',
    NEW.id,
    'photo_updated',
    _uid,
    _uname,
    NEW.branch_id,
    jsonb_build_object('image_url', OLD.image_url),
    jsonb_build_object('image_url', NEW.image_url),
    jsonb_build_object('name', NEW.name)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_modifier_photo_by_name ON public.modifiers;
CREATE TRIGGER trg_sync_modifier_photo_by_name
AFTER UPDATE OF image_url ON public.modifiers
FOR EACH ROW
EXECUTE FUNCTION public.sync_modifier_photo_by_name();
