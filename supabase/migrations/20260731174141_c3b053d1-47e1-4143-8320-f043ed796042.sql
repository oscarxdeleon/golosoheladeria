DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND (p.proconfig IS NULL OR NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) setting WHERE setting LIKE 'search_path=%'
      ))
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', fn);
  END LOOP;
END $$;