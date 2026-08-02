-- 1) Log de correos: permitir insertar el resultado del envío
GRANT INSERT ON public.cash_report_email_log TO authenticated;
DROP POLICY IF EXISTS staff_insert_cash_report_email_log ON public.cash_report_email_log;
CREATE POLICY staff_insert_cash_report_email_log
  ON public.cash_report_email_log FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'supervisor') OR
    public.has_role(auth.uid(),'cajero')
  );

-- 2) Cola de WhatsApp: reclamar y cerrar mensajes desde el servidor
CREATE OR REPLACE FUNCTION public.whatsapp_queue_claim(_branch_id uuid, _limit integer DEFAULT 10)
RETURNS TABLE(id uuid, to_phone text, body text, purpose text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  UPDATE public.whatsapp_outbound_queue q
     SET status = 'sending',
         attempts = COALESCE(q.attempts,0) + 1,
         last_attempt_at = now()
   WHERE q.id IN (
     SELECT w.id FROM public.whatsapp_outbound_queue w
      WHERE w.branch_id = _branch_id
        AND w.status IN ('pending','sending')
        AND COALESCE(w.attempts,0) < 5
      ORDER BY w.created_at
      LIMIT GREATEST(1, LEAST(_limit, 25))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.id, q.to_phone, q.body, q.purpose;
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_queue_complete(_id uuid, _ok boolean, _error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  UPDATE public.whatsapp_outbound_queue
     SET status = CASE WHEN _ok THEN 'sent'
                       WHEN COALESCE(attempts,0) >= 5 THEN 'failed'
                       ELSE 'pending' END,
         sent_at = CASE WHEN _ok THEN now() ELSE sent_at END,
         last_error = CASE WHEN _ok THEN NULL ELSE _error END
   WHERE id = _id;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_queue_claim(uuid, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.whatsapp_queue_complete(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_queue_claim(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_queue_complete(uuid, boolean, text) TO authenticated, service_role;