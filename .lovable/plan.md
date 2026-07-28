# Rediseño integral del Chatbot WhatsApp Golosito

## Diagnóstico rápido

Revisando el estado actual (`src/routes/api/public/whatsapp-bot.ts` + `whatsapp-bot/server.js`), estos son los problemas reales:

1. **Bienvenida duplicada**: el `handle_incoming` marca cooldown pero el bot local reenvía el mismo mensaje al reintentar / al recibir el mismo webhook dos veces (Baileys entrega el mismo `messages.upsert` en algunas reconexiones).
2. **Bloqueo tras confirmar**: la ruta determinista de confirmación exige carrito "completo" (nombre + dirección + pago). Si falta uno, el "sí" del cliente cae al LLM que a veces responde vacío y el flujo se detiene sin volver a preguntar.
3. **Lentitud**: cada mensaje sigue haciendo 4-6 llamadas a Gemini + RPCs. La bienvenida no debería tocar IA nunca.
4. **Falta de botones**: hoy todo es texto. Baileys 6.7 permite `buttonsMessage` (legacy) e `interactiveMessage` (list). Muchos WhatsApp Business ya no renderizan botones, así que hay que **enviar botones cuando se pueda y degradar a texto numerado** que el bot interprete ("1", "2").
5. **Pide teléfono**: el extractor todavía tiene rama de "phone". Debe eliminarse — el teléfono ya es `from`.

## Arquitectura nueva (FSM explícita, IA opcional)

Estado guardado en `whatsapp_ai_carts.fsm_state`:

```text
NEW → CHANNEL_CHOICE → (ONLINE_MENU_SENT | WA_ORDERING)
WA_ORDERING → COLLECT_ITEMS → COLLECT_MODIFIERS → COLLECT_NAME
            → COLLECT_ADDRESS → COLLECT_NEIGHBORHOOD → COLLECT_PAYMENT
            → SUMMARY → CONFIRMED → SENT_TO_POS
```

**Regla clave**: los pasos de bienvenida, elección de canal, resumen y confirmación son 100% deterministas (sin IA). La IA sólo se usa para interpretar productos/modificadores en texto libre. Esto elimina la lentitud del saludo y el bloqueo tras confirmar.

## Cambios concretos

### A. Backend (`src/routes/api/public/whatsapp-bot.ts`)

1. **Bienvenida en dos pasos determinista** (sin IA):
   - Mensaje 1: saludo corto + pregunta de canal.
   - Estructura de "botones" en un nuevo campo de respuesta `{ text, buttons?: [{id,title}], list? }`. Si el cliente local no soporta botones, se degrada a "1) Menú en línea  2) Pedir por WhatsApp".
2. **Guarda anti-duplicado reforzada**:
   - Nueva tabla/columna: `whatsapp_ai_carts.last_inbound_msg_id` + `last_reply_at`. Si `msg_id` ya se procesó → 200 no-op. Si `last_reply_at < 3s` con mismo texto → no-op.
   - En el bot local, deduplicar por `key.id` en memoria (Set con TTL 5min) antes de POST.
3. **Ruta canal en línea**: si el usuario elige "Menú en línea", enviar link del menú (`/s/{slug}/menu`) y poner `fsm_state = ONLINE_MENU_SENT`. Cualquier mensaje siguiente en 30min → responder "Tu pedido llegará automáticamente cuando lo finalices en el menú 😊" (una sola vez cada 10min).
4. **Ruta WhatsApp**: pipeline FSM determinista pidiendo **solo** el próximo dato faltante en este orden: cantidad+producto → modificadores → nombre → dirección → barrio → pago. Nunca pedir teléfono. Extractor entity `phone` eliminado.
5. **Resumen + confirmación deterministas**:
   - `SUMMARY` envía resumen con botones "✅ Confirmar" / "✏️ Modificar".
   - Cualquier texto que matchee `/^(1|si|sí|confirmar|✅|ok|dale|listo)/i` cuando `fsm_state=SUMMARY` → ejecuta `confirm_order` sin IA, responde "¡Pedido confirmado! 🍦 Lo estamos preparando." y setea `SENT_TO_POS`. Esto elimina el bloqueo.
   - `/^(2|modificar|editar|✏️)/i` → vuelve a `COLLECT_ITEMS` conservando datos ya capturados.
6. **Modificadores por lista**: cuando `pending_product` tiene `modifier_groups`, enviar lista con opciones numeradas + botones si son ≤3.

### B. Velocidad

1. **Bienvenida sin IA**: ahorra ~3-4s (era el peor caso).
2. **Cache de menú por sede** ya existe → subir TTL a 120s.
3. **Un solo await bloqueante por turno**: `handle_incoming` + envío. `record_reply`, `save_message`, `log_event` en fire-and-forget con `ctx.waitUntil`.
4. **Reducir prompt IA** a solo el bloque del turno actual (producto + modificadores del producto pendiente). Menú completo sólo cuando `fsm_state ∈ {COLLECT_ITEMS}`.
5. **Bot local**: dedupe por `key.id`, un solo `fetch` en pipeline (`incoming+ai_reply` fusionado ya existe, endurecer timeouts a 8s primer intento).

### C. Botones interactivos

`whatsapp-bot/server.js`:
- Añadir helper `sendInteractive(jid, { text, buttons?, list? })` que use `sock.sendMessage(jid, { text, buttons: [...], headerType: 1 })` con fallback automático a texto numerado si el envío interactivo falla o si el número está en la lista de "clientes sin soporte botones" (registrada en memoria tras primer fallo).
- Bump a `v8.22.0`.

### D. Migración

```sql
ALTER TABLE whatsapp_ai_carts
  ADD COLUMN IF NOT EXISTS last_inbound_msg_id text,
  ADD COLUMN IF NOT EXISTS last_reply_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_wa_carts_last_msg
  ON whatsapp_ai_carts (branch_id, phone, last_inbound_msg_id);
```
Actualizar `whatsapp_bot_handle_incoming` para setear/comparar `last_inbound_msg_id` y devolver `duplicate=true` cuando corresponde.

### E. CRM y POS

Ya funcionan; sólo asegurar que `confirm_order` reciba siempre `phone = from` (nunca lo que el cliente escribió) y que `customers` upsert use ese teléfono.

## Fuera de alcance (no se toca)

- Diseño del comprobante de pago (v2.24.0 recién estable).
- Módulos POS ajenos al bot.
- Print server.

## Validación

1. Escribir "hola" desde un número nuevo → recibe saludo + botones/opciones una sola vez (verificable con dos webhooks duplicados forzados).
2. Elegir "1" → recibe link del menú y no vuelve a molestar.
3. Elegir "2" → guía pidiendo sólo lo faltante, sin pedir teléfono.
4. En `SUMMARY` responder "sí" → pedido pasa a POS y responde confirmación.
5. Medir con `whatsapp_ai_diagnostics`: saludo <800ms, turnos con IA <3s.

## Alcance de archivos

- `src/routes/api/public/whatsapp-bot.ts` (grande, refactor FSM determinista).
- `whatsapp-bot/server.js` + `package.json` (v8.22.0, dedupe, interactive).
- Migración SQL nueva (dos columnas + índice + update de `whatsapp_bot_handle_incoming`).
- `.lovable/plan.md` actualizado.

¿Apruebas para implementar? Si prefieres partirlo, puedo empezar solo por (1) FSM + anti-duplicado + desbloqueo confirmación, y dejar botones interactivos del bot local para una segunda tanda.
