
-- Mesas: sincronización estricta entre `restaurant_tables.status` y las ventas activas.
-- Elimina los "productos fantasma" cuando una mesa aparece Libre pero conserva
-- ventas en estado pending/confirmed/ready.

-- 1) Reconciliación bidireccional: libera mesas ocupadas sin ventas activas
--    y ocupa mesas libres que sí tienen ventas activas.
CREATE OR REPLACE FUNCTION public.reconcile_restaurant_tables(_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
  _fixed jsonb := '[]'::jsonb;
  _rec record;
BEGIN
  SELECT COALESCE(full_name,'Sistema') INTO _uname FROM public.profiles WHERE id = _uid;

  -- (a) Mesas ocupadas sin venta activa -> free
  FOR _rec IN
    SELECT t.id, t.number, t.branch_id, t.status AS previous_status
      FROM public.restaurant_tables t
     WHERE t.active = true
       AND t.status = 'occupied'
       AND t.merged_into_id IS NULL
       AND (_branch_id IS NULL OR t.branch_id = _branch_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.sales s
          WHERE s.table_id = t.id
            AND COALESCE(s.status,'pending') IN ('pending','confirmed','ready')
       )
  LOOP
    UPDATE public.restaurant_tables
       SET status = 'free', current_guests = NULL, occupied_at = NULL
     WHERE id = _rec.id AND status = 'occupied' AND merged_into_id IS NULL;

    INSERT INTO public.table_events(event_type, table_id, table_number, branch_id, user_id, user_name, reason, previous_status, new_status)
    VALUES ('reconcile', _rec.id, _rec.number, _rec.branch_id, _uid, COALESCE(_uname,'Sistema'),
            'Mesa marcada como ocupada sin pedido activo', _rec.previous_status, 'free');

    INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
    VALUES ('restaurant_table', _rec.id, 'auto_reconcile', _uid, COALESCE(_uname,'Sistema'), _rec.branch_id,
            jsonb_build_object('status', _rec.previous_status),
            jsonb_build_object('status', 'free'),
            jsonb_build_object('table_number', _rec.number, 'reason', 'no_active_sale', 'at', now()));

    _fixed := _fixed || jsonb_build_object('table_id', _rec.id, 'table_number', _rec.number, 'previous_status', _rec.previous_status, 'new_status', 'free');
  END LOOP;

  -- (b) Mesas libres con al menos una venta activa -> occupied
  FOR _rec IN
    SELECT t.id, t.number, t.branch_id, t.status AS previous_status, t.seats
      FROM public.restaurant_tables t
     WHERE t.active = true
       AND t.status = 'free'
       AND t.merged_into_id IS NULL
       AND (_branch_id IS NULL OR t.branch_id = _branch_id)
       AND EXISTS (
         SELECT 1 FROM public.sales s
          WHERE s.table_id = t.id
            AND COALESCE(s.status,'pending') IN ('pending','confirmed','ready')
       )
  LOOP
    UPDATE public.restaurant_tables
       SET status = 'occupied',
           current_guests = COALESCE(current_guests, _rec.seats),
           occupied_at = COALESCE(occupied_at, now())
     WHERE id = _rec.id AND status = 'free' AND merged_into_id IS NULL;

    INSERT INTO public.table_events(event_type, table_id, table_number, branch_id, user_id, user_name, reason, previous_status, new_status)
    VALUES ('reconcile', _rec.id, _rec.number, _rec.branch_id, _uid, COALESCE(_uname,'Sistema'),
            'Mesa libre con pedido activo', _rec.previous_status, 'occupied');

    INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
    VALUES ('restaurant_table', _rec.id, 'auto_reconcile', _uid, COALESCE(_uname,'Sistema'), _rec.branch_id,
            jsonb_build_object('status', _rec.previous_status),
            jsonb_build_object('status', 'occupied'),
            jsonb_build_object('table_number', _rec.number, 'reason', 'has_active_sale', 'at', now()));

    _fixed := _fixed || jsonb_build_object('table_id', _rec.id, 'table_number', _rec.number, 'previous_status', _rec.previous_status, 'new_status', 'occupied');
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'fixed_count', jsonb_array_length(_fixed), 'fixed', _fixed, 'at', now());
END;
$$;

-- 2) Trigger sobre sales que mantiene la mesa sincronizada en cada cambio.
CREATE OR REPLACE FUNCTION public.sync_table_status_from_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tid uuid;
  _seats integer;
  _has_active boolean;
BEGIN
  -- Mesa relevante en este evento (nueva y/o anterior)
  FOR _tid IN
    SELECT DISTINCT x FROM (VALUES
      (CASE WHEN TG_OP <> 'DELETE' THEN NEW.table_id END),
      (CASE WHEN TG_OP <> 'INSERT' THEN OLD.table_id END)
    ) v(x) WHERE x IS NOT NULL
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.sales s
       WHERE s.table_id = _tid
         AND COALESCE(s.status,'pending') IN ('pending','confirmed','ready')
    ) INTO _has_active;

    IF _has_active THEN
      SELECT seats INTO _seats FROM public.restaurant_tables WHERE id = _tid;
      UPDATE public.restaurant_tables
         SET status = 'occupied',
             current_guests = COALESCE(current_guests, _seats),
             occupied_at = COALESCE(occupied_at, now())
       WHERE id = _tid AND status = 'free' AND merged_into_id IS NULL;
    ELSE
      UPDATE public.restaurant_tables
         SET status = 'free', current_guests = NULL, occupied_at = NULL
       WHERE id = _tid AND status = 'occupied' AND merged_into_id IS NULL;
    END IF;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_table_status_from_sale ON public.sales;
CREATE TRIGGER trg_sync_table_status_from_sale
AFTER INSERT OR UPDATE OF status, table_id OR DELETE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.sync_table_status_from_sale();

-- 3) Reconciliar inmediatamente el estado actual de todas las mesas.
SELECT public.reconcile_restaurant_tables(NULL);
