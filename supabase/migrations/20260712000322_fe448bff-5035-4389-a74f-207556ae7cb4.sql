
-- ============================================================
-- Auto-liberación y reconciliación de mesas
-- ============================================================

-- Estados de venta que mantienen ocupada una mesa.
-- (pending, confirmed, ready) => activa
-- (paid, completed, cancelled, merged, refunded) => cerrada

-- --- Helper: liberar una mesa si ya no tiene ventas activas -----------
CREATE OR REPLACE FUNCTION public.release_table_if_no_active_sales(
  _table_id uuid,
  _reason text DEFAULT 'auto_release',
  _sale_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _t public.restaurant_tables;
  _active int;
BEGIN
  IF _table_id IS NULL THEN RETURN false; END IF;

  SELECT * INTO _t FROM public.restaurant_tables WHERE id = _table_id FOR UPDATE;
  IF _t.id IS NULL THEN RETURN false; END IF;

  -- Nunca tocar mesas fusionadas o reservadas: su estado se maneja aparte.
  IF _t.status IN ('merged','reserved') THEN RETURN false; END IF;
  IF _t.merged_into_id IS NOT NULL THEN RETURN false; END IF;
  IF _t.status <> 'occupied' THEN RETURN false; END IF;

  SELECT COUNT(*) INTO _active
    FROM public.sales
   WHERE table_id = _table_id
     AND COALESCE(status,'pending') IN ('pending','confirmed','ready');

  IF _active > 0 THEN RETURN false; END IF;

  UPDATE public.restaurant_tables
     SET status = 'free',
         current_guests = NULL,
         occupied_at = NULL
   WHERE id = _table_id;

  INSERT INTO public.table_events(
    event_type, table_id, table_number, branch_id,
    user_id, user_name, reason, previous_status, new_status, sale_id
  ) VALUES (
    'auto_release', _t.id, _t.number, _t.branch_id,
    auth.uid(), 'Sistema', _reason, 'occupied', 'free', _sale_id
  );

  RETURN true;
END;
$$;

-- --- Trigger: al cambiar status de una venta ligada a mesa -----------
CREATE OR REPLACE FUNCTION public.tg_sales_release_table_on_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _old_active boolean := COALESCE(OLD.status,'pending') IN ('pending','confirmed','ready');
  _new_active boolean := COALESCE(NEW.status,'pending') IN ('pending','confirmed','ready');
BEGIN
  IF NEW.table_id IS NULL THEN RETURN NEW; END IF;
  -- Sólo cuando la venta pasa de activa a inactiva
  IF _old_active AND NOT _new_active THEN
    PERFORM public.release_table_if_no_active_sales(
      NEW.table_id,
      'sale_status_' || COALESCE(NEW.status,'unknown'),
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_release_table_on_status ON public.sales;
CREATE TRIGGER trg_sales_release_table_on_status
AFTER UPDATE OF status ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.tg_sales_release_table_on_status();

-- --- Trigger: al eliminar una venta ligada a mesa --------------------
CREATE OR REPLACE FUNCTION public.tg_sales_release_table_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.table_id IS NOT NULL THEN
    PERFORM public.release_table_if_no_active_sales(
      OLD.table_id, 'sale_deleted', OLD.id
    );
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_release_table_on_delete ON public.sales;
CREATE TRIGGER trg_sales_release_table_on_delete
AFTER DELETE ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.tg_sales_release_table_on_delete();

-- --- Trigger: si se borran ítems y la venta queda vacía --------------
CREATE OR REPLACE FUNCTION public.tg_sale_items_release_table_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _sale public.sales;
  _remaining int;
BEGIN
  SELECT * INTO _sale FROM public.sales WHERE id = OLD.sale_id;
  IF _sale.id IS NULL OR _sale.table_id IS NULL THEN RETURN OLD; END IF;
  IF COALESCE(_sale.status,'pending') NOT IN ('pending','confirmed','ready') THEN
    RETURN OLD;
  END IF;

  SELECT COUNT(*) INTO _remaining FROM public.sale_items WHERE sale_id = _sale.id;
  IF _remaining > 0 THEN RETURN OLD; END IF;

  -- Venta pendiente sin ítems: cancelarla y liberar mesa si aplica.
  UPDATE public.sales
     SET status = 'cancelled',
         cancelled_at = now(),
         cancellation_reason = COALESCE(cancellation_reason,'Pedido vacío (sin ítems)')
   WHERE id = _sale.id;

  PERFORM public.release_table_if_no_active_sales(
    _sale.table_id, 'empty_sale_auto_cancelled', _sale.id
  );

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_items_release_table_on_delete ON public.sale_items;
CREATE TRIGGER trg_sale_items_release_table_on_delete
AFTER DELETE ON public.sale_items
FOR EACH ROW
EXECUTE FUNCTION public.tg_sale_items_release_table_on_delete();

-- --- Reconciliación global (auto-corrección) -------------------------
-- Detecta mesas 'occupied' sin ninguna venta activa asociada y las libera.
-- Devuelve JSON con detalle de las mesas corregidas.
CREATE OR REPLACE FUNCTION public.reconcile_restaurant_tables(_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
  _fixed jsonb := '[]'::jsonb;
  _rec record;
BEGIN
  SELECT COALESCE(full_name,'Sistema') INTO _uname FROM public.profiles WHERE id = _uid;

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
       SET status = 'free',
           current_guests = NULL,
           occupied_at = NULL
     WHERE id = _rec.id
       AND status = 'occupied'
       AND merged_into_id IS NULL;

    INSERT INTO public.table_events(
      event_type, table_id, table_number, branch_id,
      user_id, user_name, reason, previous_status, new_status
    ) VALUES (
      'reconcile', _rec.id, _rec.number, _rec.branch_id,
      _uid, COALESCE(_uname,'Sistema'),
      'Mesa marcada como ocupada sin pedido activo',
      _rec.previous_status, 'free'
    );

    INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
    VALUES (
      'restaurant_table', _rec.id, 'auto_reconcile',
      _uid, COALESCE(_uname,'Sistema'), _rec.branch_id,
      jsonb_build_object('status', _rec.previous_status),
      jsonb_build_object('status', 'free'),
      jsonb_build_object('table_number', _rec.number, 'reason', 'no_active_sale', 'at', now())
    );

    _fixed := _fixed || jsonb_build_object(
      'table_id', _rec.id,
      'table_number', _rec.number,
      'branch_id', _rec.branch_id,
      'previous_status', _rec.previous_status,
      'new_status', 'free'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'fixed_count', jsonb_array_length(_fixed),
    'fixed', _fixed,
    'at', now()
  );
END;
$$;

-- Permisos
GRANT EXECUTE ON FUNCTION public.release_table_if_no_active_sales(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_restaurant_tables(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_table_if_no_active_sales(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_restaurant_tables(uuid) TO service_role;
