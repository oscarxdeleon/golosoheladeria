ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS ticket_header text,
  ADD COLUMN IF NOT EXISTS ticket_footer text;

UPDATE public.settings
   SET ticket_footer = COALESCE(ticket_footer, '¡Gracias por Preferirnos!')
 WHERE id = 1;