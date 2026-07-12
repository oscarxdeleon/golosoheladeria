CREATE OR REPLACE FUNCTION public.audit_cash_session_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uname text;
BEGIN
  SELECT COALESCE(full_name,'Sistema') INTO _uname FROM public.profiles WHERE id = auth.uid();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, after, meta)
    VALUES ('cash_session', NEW.id, 'cash_opened', auth.uid(), _uname, NEW.branch_id,
      jsonb_build_object('opening_amount', NEW.opening_amount, 'opened_at', NEW.opened_at),
      jsonb_build_object('opening_notes', NEW.opening_notes));
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'open' AND NEW.status = 'closed' THEN
    INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
    VALUES ('cash_session', NEW.id, 'cash_closed', auth.uid(), _uname, NEW.branch_id,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object(
        'status', NEW.status,
        'counted_amount', NEW.counted_amount,
        'expected_amount', NEW.expected_amount,
        'difference', NEW.difference,
        'cash_counted', NEW.cash_counted,
        'nequi_counted', NEW.nequi_counted,
        'bancolombia_counted', NEW.bancolombia_counted,
        'cash_expected', NEW.cash_expected,
        'nequi_expected', NEW.nequi_expected,
        'bancolombia_expected', NEW.bancolombia_expected,
        'cash_difference', NEW.cash_difference,
        'nequi_difference', NEW.nequi_difference,
        'bancolombia_difference', NEW.bancolombia_difference,
        'closed_at', NEW.closed_at
      ),
      jsonb_build_object('closing_notes', NEW.closing_notes));
  END IF;
  RETURN NEW;
END; $function$;