
ALTER TABLE public.restaurant_tables DROP CONSTRAINT IF EXISTS restaurant_tables_number_key;
DROP INDEX IF EXISTS public.restaurant_tables_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_tables_branch_room_number_uidx
  ON public.restaurant_tables (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
                                COALESCE(room_id, '00000000-0000-0000-0000-000000000000'::uuid),
                                number)
  WHERE active = true;
