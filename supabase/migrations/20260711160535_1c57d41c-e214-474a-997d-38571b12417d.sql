
CREATE OR REPLACE FUNCTION public.sync_modifier_fields_by_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
  _affected_ids uuid[];
  _price_changed boolean := COALESCE(NEW.price,0) <> COALESCE(OLD.price,0);
  _active_changed boolean := COALESCE(NEW.active,true) <> COALESCE(OLD.active,true);
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NOT _price_changed AND NOT _active_changed THEN RETURN NEW; END IF;

  SELECT COALESCE(full_name,'Sistema') INTO _uname FROM public.profiles WHERE id = _uid;

  WITH updated AS (
    UPDATE public.modifiers m
       SET price  = CASE WHEN _price_changed  THEN NEW.price  ELSE m.price  END,
           active = CASE WHEN _active_changed THEN NEW.active ELSE m.active END
     WHERE m.branch_id = NEW.branch_id
       AND m.name = NEW.name
       AND m.id <> NEW.id
       AND (
         (_price_changed  AND COALESCE(m.price,0)      <> COALESCE(NEW.price,0)) OR
         (_active_changed AND COALESCE(m.active,true)  <> COALESCE(NEW.active,true))
       )
    RETURNING m.id
  )
  SELECT array_agg(id) INTO _affected_ids FROM updated;

  -- Direct change audit
  INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
  VALUES (
    'modifier', NEW.id, 'fields_updated', _uid, _uname, NEW.branch_id,
    jsonb_build_object('price', OLD.price, 'active', OLD.active),
    jsonb_build_object('price', NEW.price, 'active', NEW.active),
    jsonb_build_object('name', NEW.name,
                       'price_changed', _price_changed,
                       'active_changed', _active_changed)
  );

  IF _affected_ids IS NOT NULL AND array_length(_affected_ids,1) > 0 THEN
    INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
    VALUES (
      'modifier', NEW.id, 'fields_synced', _uid, _uname, NEW.branch_id,
      jsonb_build_object('price', OLD.price, 'active', OLD.active),
      jsonb_build_object('price', NEW.price, 'active', NEW.active),
      jsonb_build_object('name', NEW.name,
                         'affected_modifier_ids', to_jsonb(_affected_ids),
                         'affected_count', array_length(_affected_ids,1),
                         'price_changed', _price_changed,
                         'active_changed', _active_changed)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_modifier_fields_by_name ON public.modifiers;
CREATE TRIGGER trg_sync_modifier_fields_by_name
AFTER UPDATE OF price, active ON public.modifiers
FOR EACH ROW
EXECUTE FUNCTION public.sync_modifier_fields_by_name();
