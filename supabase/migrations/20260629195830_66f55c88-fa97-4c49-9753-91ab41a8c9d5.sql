DROP FUNCTION IF EXISTS public.terminal_list_employees(text);
CREATE OR REPLACE FUNCTION public.terminal_list_employees(_slug text)
 RETURNS TABLE(id uuid, full_name text, job_position text, photo_url text, face_descriptor jsonb, document_id text, branch_id uuid, terminal_id uuid, terminal_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _term public.attendance_terminals;
BEGIN
  SELECT * INTO _term FROM public.attendance_terminals WHERE slug = _slug AND active = true;
  IF _term.id IS NULL THEN RAISE EXCEPTION 'Terminal no encontrada'; END IF;
  RETURN QUERY
    SELECT e.id, e.full_name, e.job_position, e.photo_url, e.face_descriptor, e.document_id, e.branch_id, _term.id, _term.name
    FROM public.attendance_employees e
    WHERE e.active = true AND (_term.branch_id IS NULL OR e.branch_id = _term.branch_id OR e.branch_id IS NULL);
END; $function$;