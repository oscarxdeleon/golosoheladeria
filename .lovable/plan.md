# Optimización de velocidad del Chatbot de WhatsApp

## Diagnóstico de la lentitud actual

Cada mensaje entrante recorre entre **8 y 12 llamadas RPC seriales** antes de que el modelo IA empiece a generar respuesta. Ese es el cuello de botella real, no el modelo.

Flujo actual por mensaje (medido en `whatsapp-bot.ts`):

```text
incoming  → handle_incoming (RPC)
ai_reply  → ai_context     (RPC, carga menú+FAQs+sabores)
          → ai_cart_get    (RPC)
          → ai_history     (RPC)
          → ai_ordering_config (RPC)
          → ai_cart_get    (RPC, otra vez en buildOperational)
          → ai_cart_upsert (RPC opcional)
          → save_message x2 (RPC)
          → record_reply   (RPC)
          → log_event x N  (RPC)
          → llamada IA (Gemini)
```

Con ~200ms por RPC contra Supabase = **2–3 s solo en round-trips** antes de la IA, más el modelo. La ventana total roza los 6–8 s que percibe el cliente.

## Cambios de alto impacto

### 1. Consolidar contexto en una sola RPC
Nueva RPC `whatsapp_bot_ai_bootstrap(_token, _phone, _limit)` que devuelve en una sola llamada: `context + cart + history + ordering_config + quota_status`. Reemplaza 5 RPCs seriales por 1. **Ahorro esperado: ~800–1200 ms**.

### 2. Cache in-memory por sede (TTL 60 s)
La parte pesada de `ai_context` (menú, sabores, FAQs, config sede) cambia rara vez. Cacheamos por `token` con TTL corto usando un `Map` en el módulo del worker. Solo el segmento por-cliente (`cart`, `history`, `usage_today`) se recarga siempre. **Ahorro: ~400–600 ms** en hits calientes (>90% de mensajes).

### 3. Escrituras y logs no bloqueantes
`save_message`, `record_reply` y `logBotEvent` se disparan con `ctx.waitUntil` / promesas sueltas (fire-and-forget) en lugar de `await`. Ninguno afecta el texto de respuesta. **Ahorro: ~400–700 ms** al final del turno.

### 4. Reducir tamaño del prompt de sistema
- Bajar `selectRelevantProducts` de 20 → 12.
- Bajar `selectRelevantFaqs` de 8 → 5.
- Consolidar el bloque `orderingPromptBlock` (hoy ~30 líneas) a versión compacta.
- Prompt más corto = respuesta del modelo más rápida (TTFB). **Ahorro: ~300–800 ms**.

### 5. Bajar timeout / reintentos agresivos
- `AI_CALL_TIMEOUT_MS`: primer intento más corto (6 s → 4 s) para failover más rápido a Gemini directo.
- Reducir `backoffs` de `[400, 900]` a `[200, 500]`.

### 6. Bot local: pipeline paralelo
En `whatsapp-bot/server.js`, los pasos `incoming → ai_reply → enqueue_reply` se hacen en serie. Fusionar `incoming` + `ai_reply` en una sola llamada cuando el servidor ya devuelve `use_ai=true` (evita un round-trip completo Bogotá↔Cloudflare). **Ahorro: ~300–500 ms por mensaje**.

### 7. Índices que faltan
Verificar y crear si hace falta:
```sql
CREATE INDEX IF NOT EXISTS idx_wa_messages_phone_created
  ON whatsapp_ai_messages (branch_id, phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_carts_phone_status
  ON whatsapp_ai_carts (branch_id, phone, status);
```

## Lo que NO se toca

- Lógica de guardas de pedido (nombre obligatorio, modificadores, confirmación explícita).
- Reglas antirriesgo del prompt.
- Contrato de tools (`search_products`, `add_to_cart`, `confirm_order`, etc.).
- Formato de respuestas al cliente.
- Watchdog, updater y versión del bot local salvo el pipeline paralelo.

## Validación

- Log de duración por etapa ya existe (`logBotEvent`); antes/después mediremos con `whatsapp_ai_diagnostics`.
- Prueba manual: 5 mensajes cortos + 1 flujo de pedido completo.
- Verificar que dos sedes en paralelo no comparten cache (clave = token).

## Detalles técnicos

- Nueva migración: `whatsapp_bot_ai_bootstrap` (SECURITY DEFINER) + índices.
- Edits: `src/routes/api/public/whatsapp-bot.ts` (cache por sede, bootstrap, fire-and-forget, prompt más corto), `whatsapp-bot/server.js` (pipeline paralelo, bump a v8.21.0).
- Sin cambios en tipos generados ni en el cliente Supabase.
