
-- Add per-item ready timestamp for KDS
ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS ready_at timestamptz;

-- Auto-mark whole sale as ready when all items are ready
CREATE OR REPLACE FUNCTION public.auto_mark_sale_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pending int;
  _current text;
BEGIN
  IF NEW.ready_at IS NULL THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO _pending
  FROM public.sale_items
  WHERE sale_id = NEW.sale_id AND ready_at IS NULL;

  IF _pending = 0 THEN
    SELECT status INTO _current FROM public.sales WHERE id = NEW.sale_id;
    IF _current = 'pending' THEN
      UPDATE public.sales
        SET status = 'ready',
            kds_ack_at = COALESCE(kds_ack_at, now())
        WHERE id = NEW.sale_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_mark_sale_ready ON public.sale_items;
CREATE TRIGGER trg_auto_mark_sale_ready
AFTER UPDATE OF ready_at ON public.sale_items
FOR EACH ROW
WHEN (NEW.ready_at IS NOT NULL AND OLD.ready_at IS NULL)
EXECUTE FUNCTION public.auto_mark_sale_ready();

-- Ensure realtime delivers full payloads
ALTER TABLE public.sale_items REPLICA IDENTITY FULL;
ALTER TABLE public.sales REPLICA IDENTITY FULL;
