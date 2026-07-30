-- 1) Unificar los enlaces guardados en los mensajes de bienvenida de cada sede
UPDATE public.whatsapp_bot_config c
SET welcome_messages = (
  SELECT array_agg(
    regexp_replace(
      m,
      'https?://[^\s]*golosoheladeria[^\s]*',
      'https://golosoheladeria.vercel.app/s/' || b.slug || '/menu',
      'g'
    )
    ORDER BY ord
  )
  FROM unnest(c.welcome_messages) WITH ORDINALITY AS t(m, ord)
)
FROM public.branches b
WHERE b.id = c.branch_id
  AND c.welcome_messages IS NOT NULL
  AND array_length(c.welcome_messages, 1) > 0;

-- 2) No duplicar el enlace del menú en la bienvenida
CREATE OR REPLACE FUNCTION public.whatsapp_bot_append_menu_link(_reply text, _menu_link text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _reply IS NULL OR btrim(_reply) = '' THEN _reply
    WHEN _reply ~* 'https?://' THEN _reply
    ELSE _reply || E'\n\n👉 ' || _menu_link
  END;
$$;