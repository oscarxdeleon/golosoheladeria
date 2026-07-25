ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_transaction_last4 text;
ALTER TABLE public.sales ADD CONSTRAINT sales_payment_transaction_last4_format CHECK (payment_transaction_last4 IS NULL OR payment_transaction_last4 ~ '^[0-9]{4}$');
CREATE INDEX IF NOT EXISTS sales_payment_transaction_last4_idx ON public.sales(payment_transaction_last4) WHERE payment_transaction_last4 IS NOT NULL;