UPDATE public.whatsapp_bot_config
SET chatbot_mode = 'full',
    enabled = true,
    ai_enabled = true,
    ai_ordering_enabled = true,
    updated_at = now()
WHERE branch_id IN (
  'caac3046-d27e-4a5a-9bc4-254e78b77495'::uuid,
  '595a3492-bc2c-4124-86b3-c41365b7a3e7'::uuid
);