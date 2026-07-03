WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at) AS rn
  FROM public.products
)
DELETE FROM public.products
WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
  AND id NOT IN (SELECT product_id FROM public.sale_items WHERE product_id IS NOT NULL);