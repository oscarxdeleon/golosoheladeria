
-- Track merge state on tables and items
ALTER TABLE public.restaurant_tables
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES public.restaurant_tables(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS origin_table_id uuid REFERENCES public.restaurant_tables(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_tables_merged_into ON public.restaurant_tables(merged_into_id) WHERE merged_into_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sale_items_origin_table ON public.sale_items(origin_table_id) WHERE origin_table_id IS NOT NULL;

-- Merge one or more source tables into a principal table.
CREATE OR REPLACE FUNCTION public.merge_tables(_principal_id uuid, _source_ids uuid[], _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
  _principal public.restaurant_tables;
  _src public.restaurant_tables;
  _principal_sale_id uuid;
  _src_sale_id uuid;
  _src_id uuid;
  _moved int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF _principal_id IS NULL OR _source_ids IS NULL OR array_length(_source_ids,1) IS NULL THEN
    RAISE EXCEPTION 'Debes indicar la mesa principal y al menos una mesa a fusionar';
  END IF;

  SELECT * INTO _principal FROM public.restaurant_tables WHERE id = _principal_id FOR UPDATE;
  IF _principal.id IS NULL THEN RAISE EXCEPTION 'Mesa principal no encontrada'; END IF;
  IF _principal.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'La mesa principal ya está fusionada en otra mesa';
  END IF;

  SELECT COALESCE(full_name,'Usuario') INTO _uname FROM public.profiles WHERE id = _uid;

  -- Get or create pending sale on principal
  SELECT id INTO _principal_sale_id FROM public.sales
   WHERE table_id = _principal.id AND COALESCE(status,'pending') = 'pending'
   ORDER BY created_at ASC LIMIT 1;

  IF _principal_sale_id IS NULL THEN
    INSERT INTO public.sales(user_id, user_name, source, status, order_type, table_id, branch_id, subtotal, total, payment_method)
    VALUES (_uid, _uname, 'pos', 'pending', 'mesa', _principal.id, _principal.branch_id, 0, 0, 'Pendiente')
    RETURNING id INTO _principal_sale_id;
  END IF;

  FOREACH _src_id IN ARRAY _source_ids LOOP
    IF _src_id = _principal_id THEN CONTINUE; END IF;
    SELECT * INTO _src FROM public.restaurant_tables WHERE id = _src_id FOR UPDATE;
    IF _src.id IS NULL THEN CONTINUE; END IF;
    IF _src.branch_id <> _principal.branch_id THEN
      RAISE EXCEPTION 'Solo se pueden fusionar mesas de la misma sede';
    END IF;
    IF _src.merged_into_id IS NOT NULL THEN
      RAISE EXCEPTION 'La Mesa % ya está fusionada', _src.number;
    END IF;

    -- Move all items from every pending sale of this source
    FOR _src_sale_id IN
      SELECT id FROM public.sales
       WHERE table_id = _src.id AND COALESCE(status,'pending') = 'pending'
    LOOP
      WITH moved AS (
        UPDATE public.sale_items
           SET sale_id = _principal_sale_id,
               origin_table_id = COALESCE(origin_table_id, _src.id)
         WHERE sale_id = _src_sale_id
         RETURNING id
      )
      SELECT _moved + COUNT(*) INTO _moved FROM moved;

      UPDATE public.sales SET status = 'merged' WHERE id = _src_sale_id;
    END LOOP;

    UPDATE public.restaurant_tables SET
      status = 'merged',
      merged_into_id = _principal.id,
      merged_at = now(),
      current_guests = NULL,
      occupied_at = NULL
    WHERE id = _src.id;

    INSERT INTO public.table_events(event_type, table_id, table_number, target_table_id, target_table_number,
      branch_id, user_id, user_name, reason, previous_status, new_status, sale_id, meta)
    VALUES ('merge', _src.id, _src.number, _principal.id, _principal.number,
      _src.branch_id, _uid, _uname, _reason, _src.status, 'merged', _principal_sale_id,
      jsonb_build_object('principal_id', _principal.id, 'principal_number', _principal.number));
  END LOOP;

  -- Recompute principal sale totals
  UPDATE public.sales s
     SET subtotal = COALESCE(t.sum_sub,0),
         total    = COALESCE(t.sum_sub,0) + COALESCE(s.delivery_fee,0) - COALESCE(s.discount,0)
    FROM (SELECT COALESCE(SUM(subtotal),0) AS sum_sub FROM public.sale_items WHERE sale_id = _principal_sale_id) t
   WHERE s.id = _principal_sale_id;

  UPDATE public.restaurant_tables SET
    status = 'occupied',
    occupied_at = COALESCE(occupied_at, now())
  WHERE id = _principal.id;

  INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, meta)
  VALUES ('restaurant_table', _principal.id, 'tables_merged', _uid, _uname, _principal.branch_id,
    jsonb_build_object('principal_id', _principal.id, 'principal_number', _principal.number,
                       'source_ids', to_jsonb(_source_ids), 'items_moved', _moved,
                       'reason', _reason, 'sale_id', _principal_sale_id));

  RETURN jsonb_build_object('ok', true, 'sale_id', _principal_sale_id, 'items_moved', _moved);
END;
$$;

-- Split a merged principal back into its original tables (restoring items to origin_table_id).
CREATE OR REPLACE FUNCTION public.split_merged_tables(_principal_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
  _principal public.restaurant_tables;
  _principal_sale_id uuid;
  _src public.restaurant_tables;
  _new_sale_id uuid;
  _restored int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT * INTO _principal FROM public.restaurant_tables WHERE id = _principal_id FOR UPDATE;
  IF _principal.id IS NULL THEN RAISE EXCEPTION 'Mesa principal no encontrada'; END IF;

  SELECT COALESCE(full_name,'Usuario') INTO _uname FROM public.profiles WHERE id = _uid;

  SELECT id INTO _principal_sale_id FROM public.sales
   WHERE table_id = _principal.id AND COALESCE(status,'pending') = 'pending'
   ORDER BY created_at ASC LIMIT 1;

  -- For each merged source table, restore its items
  FOR _src IN
    SELECT * FROM public.restaurant_tables
     WHERE merged_into_id = _principal.id
     ORDER BY number
     FOR UPDATE
  LOOP
    IF _principal_sale_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.sale_items WHERE sale_id = _principal_sale_id AND origin_table_id = _src.id
    ) THEN
      INSERT INTO public.sales(user_id, user_name, source, status, order_type, table_id, branch_id, subtotal, total, payment_method)
      VALUES (_uid, _uname, 'pos', 'pending', 'mesa', _src.id, _src.branch_id, 0, 0, 'Pendiente')
      RETURNING id INTO _new_sale_id;

      WITH moved AS (
        UPDATE public.sale_items
           SET sale_id = _new_sale_id,
               origin_table_id = NULL
         WHERE sale_id = _principal_sale_id AND origin_table_id = _src.id
         RETURNING id
      )
      SELECT _restored + COUNT(*) INTO _restored FROM moved;

      UPDATE public.sales s
         SET subtotal = COALESCE(t.sum_sub,0),
             total    = COALESCE(t.sum_sub,0)
        FROM (SELECT COALESCE(SUM(subtotal),0) AS sum_sub FROM public.sale_items WHERE sale_id = _new_sale_id) t
       WHERE s.id = _new_sale_id;

      UPDATE public.restaurant_tables SET
        status = 'occupied',
        merged_into_id = NULL,
        merged_at = NULL,
        occupied_at = now()
      WHERE id = _src.id;
    ELSE
      UPDATE public.restaurant_tables SET
        status = 'free',
        merged_into_id = NULL,
        merged_at = NULL,
        current_guests = NULL,
        occupied_at = NULL
      WHERE id = _src.id;
    END IF;

    INSERT INTO public.table_events(event_type, table_id, table_number, target_table_id, target_table_number,
      branch_id, user_id, user_name, reason, previous_status, new_status, sale_id, meta)
    VALUES ('split', _src.id, _src.number, _principal.id, _principal.number,
      _src.branch_id, _uid, _uname, _reason, 'merged', 'free', _new_sale_id,
      jsonb_build_object('principal_id', _principal.id));
  END LOOP;

  -- Recompute or free principal
  IF _principal_sale_id IS NOT NULL THEN
    UPDATE public.sales s
       SET subtotal = COALESCE(t.sum_sub,0),
           total    = COALESCE(t.sum_sub,0) + COALESCE(s.delivery_fee,0) - COALESCE(s.discount,0)
      FROM (SELECT COALESCE(SUM(subtotal),0) AS sum_sub FROM public.sale_items WHERE sale_id = _principal_sale_id) t
     WHERE s.id = _principal_sale_id;

    IF NOT EXISTS (SELECT 1 FROM public.sale_items WHERE sale_id = _principal_sale_id) THEN
      UPDATE public.sales SET status = 'cancelled' WHERE id = _principal_sale_id;
      UPDATE public.restaurant_tables SET status='free', current_guests=NULL, occupied_at=NULL WHERE id=_principal.id;
    END IF;
  END IF;

  INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, meta)
  VALUES ('restaurant_table', _principal.id, 'tables_split', _uid, _uname, _principal.branch_id,
    jsonb_build_object('principal_id', _principal.id, 'items_restored', _restored, 'reason', _reason));

  RETURN jsonb_build_object('ok', true, 'items_restored', _restored);
END;
$$;
