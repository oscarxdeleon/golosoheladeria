CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS customers_name_trgm_idx ON public.customers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_phone_trgm_idx ON public.customers USING gin (phone gin_trgm_ops);