# Fase 2B — Bot toma pedidos de domicilio

El bot arma el pedido conversando con el cliente, y cuando este confirma, entra al POS como pedido pendiente en la pestaña "Pedidos online" con badge especial 🤖 para que el cajero revise antes de imprimir comanda.

## Alcance confirmado

- **Solo domicilio** en Fase 2B (recoger y programado se agregan en 2C si funciona bien).
- **Cajero revisa y confirma** antes de que la comanda vaya a cocina.
- **Pago**: efectivo o transferencia con confirmación manual del cajero.

## Piezas a construir

### 1. Base de datos

- Nueva tabla `whatsapp_ai_carts` (borrador del pedido en curso por cliente/sede): items, dirección, teléfono, método de pago, estado (`building` / `confirmed` / `cancelled` / `posted`).
- Extender `sales` con `ai_review_status text` (`pending_review` / `approved` / `rejected`) y `source` = `'whatsapp_bot'`.
- Nuevas RPCs invocables por el endpoint del bot (via token de sede):
  - `whatsapp_bot_ai_search_products(_token, _query)` → devuelve productos activos que matcheen, con precios reales.
  - `whatsapp_bot_ai_get_flavors(_token, _product_id)` → sabores disponibles del grupo modificador correcto.
  - `whatsapp_bot_ai_cart_upsert(_token, _phone, _payload)` → crea/actualiza carrito borrador.
  - `whatsapp_bot_ai_cart_confirm(_token, _phone)` → valida carrito, inserta en `sales` + `sale_items` con `ai_review_status='pending_review'`, devuelve nº pedido.
- RLS: admins/supervisores ven los carritos; el bot escribe vía SECURITY DEFINER con token.

### 2. Endpoint IA con tool-calling

Modificar `src/routes/api/public/whatsapp-bot.ts` (acción `ai_reply`):
- Ampliar el llamado a Gemini con **function calling**: se declaran las tools `search_products`, `get_flavors`, `add_to_cart`, `set_delivery_info`, `show_cart`, `confirm_order`, `cancel_order`.
- Loop de hasta 5 rondas: el modelo pide tool → servidor ejecuta RPC → devuelve resultado → modelo continúa hasta responder al cliente.
- Cada tool valida contra la DB (precios/sabores/stock reales, nada inventado).
- Bloqueos automáticos: fuera de horario → responde con opción de programar (Fase 2C) o rechaza; sin dirección → no permite confirmar.

### 3. Panel de revisión en el POS

Modificar `src/routes/_authenticated/pedidos-online.tsx`:
- Los pedidos con `ai_review_status='pending_review'` aparecen con banner amarillo **🤖 Pedido IA — Revisar**.
- Botones: **Aprobar y imprimir comanda** / **Editar** / **Rechazar**.
- Al aprobar → cambia estado, dispara impresión de comanda (mismo flujo actual), notifica al cliente por WhatsApp: *"¡Pedido confirmado! 🎉 Llega en ~X min."*
- Al rechazar → notifica al cliente con motivo.

### 4. Notificaciones al cliente

Reutiliza `whatsapp_outbound_queue` existente:
- Confirmación con nº pedido y ETA cuando el cajero aprueba.
- Aviso "salió a domicilio" cuando cambia estado (ya existe).

### 5. Salvaguardas

- **Confirmación explícita** antes de crear pedido — el bot debe mostrar resumen y esperar "sí"/"confirmo".
- **Dedup**: si el mismo número confirma dos veces seguidas en 60s → segundo pedido rechazado.
- **Rate limit**: máx 3 pedidos por número por día vía bot.
- **Log de auditoría**: cada acción tool queda en `whatsapp_bot_messages` para depuración.
- **Modo sandbox sigue vigente**: la toma de pedidos IA solo funciona para los números autorizados hasta que la actives para todos.

## Configuración por sede (nueva sección en pestaña WhatsApp Bot)

- Toggle **"Bot puede tomar pedidos"** (independiente del toggle de conversación).
- Monto mínimo de domicilio.
- Zonas/barrios de cobertura (texto libre que el bot lee).
- Costo de domicilio base o por zona.
- Datos de transferencia (Nequi/Daviplata/número) que el bot comparte cuando el cliente elige transferir.

## Fuera de alcance (Fase 2C+)

- Pedidos para recoger.
- Programación de pedidos fuera de horario.
- Cálculo automático de domicilio por distancia GPS.
- Pasarela de pago en línea.
- Modificación del pedido después de aprobado.

## Orden de implementación

1. Migración DB (tabla `whatsapp_ai_carts` + columnas `ai_review_status` + RPCs).
2. Endpoint IA con tool-calling (mensaje más largo — es el corazón).
3. Panel de revisión en `pedidos-online.tsx`.
4. Configuración en pestaña WhatsApp Bot.
5. Prueba en sandbox con tu número.

Total estimado: 4-5 mensajes de build hasta tener el flujo end-to-end funcionando en sandbox.

## Detalles técnicos

- **Modelo**: `google/gemini-3.6-flash` (soporta function calling nativo, ya lo usamos). Fallback `openai/gpt-5.5` si Gemini rechaza el tool schema.
- **Tool schemas** definidos en el endpoint TS, sin bounds estrictos (siguiendo `ai-sdk-agent-patterns`: los límites van en el prompt, no en el schema, para evitar rechazos del gateway).
- **Estado del carrito** persistido en DB, no en memoria — el bot es stateless y varias sedes comparten worker.
- **Sin cambios en el bot local (Baileys)** — el flujo actual `incoming → ai_reply → send` sigue igual, todo el trabajo nuevo pasa server-side.

¿Apruebas? Si dices **sí** arranco por la migración.