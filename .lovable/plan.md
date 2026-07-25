## Objetivo

Añadir un botón **"Actualizar y Reconectar"** en Ajustes → WhatsApp Bot que ejecute de forma automática todo el ciclo: verificar → detener → actualizar → reiniciar → validar sesión → mostrar QR si es necesario → esperar vinculación → probar → confirmar operativo. Todo desde el POS, sin SSH.

## Arquitectura

La infraestructura ya existe:
- RPC `whatsapp_bot_request_command` (backend) → cola de comandos por sede
- `whatsapp-bot/server.js` v8.20.1 en cada Droplet consume la cola cada ~5s y ejecuta `restart` / `update`
- Endpoint público `/api/public/whatsapp-bot` reporta heartbeat, versión, estado de conexión y QR

Lo que falta es orquestar los pasos existentes en un solo flujo guiado desde la UI, sin agregar comandos nuevos al bot.

## Cambios

### 1. Backend — nuevo endpoint público de auto-prueba
`src/routes/api/public/whatsapp-bot-selftest.ts` (server route): dado `branch_id`, dispara un mensaje sintético contra el mismo pipeline que usa Baileys (usa `handleIncomingMessage` interno) y devuelve `{ok, latency_ms, reply}`. Sirve como paso final "el chatbot responde".

### 2. Backend — RPC de estado consolidado
Añadir `whatsapp_bot_full_status(branch_id)` que retorne en una sola llamada: `version`, `connected`, `has_qr`, `qr`, `last_heartbeat_at`, `pending_commands`, `last_command_status`. Reduce polling.

### 3. Frontend — componente `UpdateAndReconnectWizard`
Modal con máquina de estados que ejecuta secuencialmente y muestra cada paso con ✔/✖/⏳:

```text
1. Verificando estado actual         → lee full_status
2. Enviando orden de actualización   → RPC command 'update'
3. Actualizando bot (npm/git)        → poll versión hasta cambiar o timeout 3min
4. Reiniciando servicio              → poll connected/heartbeat
5. Validando sesión WhatsApp         → si connected=true, salta al paso 8
6. Generando código QR               → poll has_qr hasta true, muestra QR
7. Esperando vinculación             → poll connected=true (sin timeout, cancelable)
8. Ejecutando prueba de mensajería   → llama selftest endpoint
9. Bot operativo ✅
```

Cada paso: título, descripción, estado (pending/running/ok/error), tiempo transcurrido y detalle de error específico ("Bot no respondió en 180s: última versión reportada 8.19.3, se esperaba ≥8.20.1"). Botón "Reintentar este paso" cuando falla.

### 4. Botón en `whatsapp-bot-tab.tsx`
Reemplazar los dos botones separados (Actualizar / Reiniciar) por uno primario grande **"Actualizar y Reconectar"** que abre el wizard. Los individuales quedan colapsados en un menú "Avanzado" para uso puntual.

### 5. Independencia por sede
Todo el flujo recibe `branch_id`; wizard bloquea cambiar de sede mientras corre. Nada global.

## Detalles técnicos

- **Timeouts**: update 180s, restart 60s, QR gen 45s, vinculación sin timeout (usuario cancela), selftest 15s.
- **Anti-flapping**: se considera "conectado" solo tras 3 heartbeats consecutivos con `connected=true` (aprovecha protección anti-QR-fantasma ya existente en v8.20.1).
- **Persistencia**: si el usuario cierra el modal, el proceso continúa en el bot; al reabrir, el wizard reconstruye estado desde `full_status` + `last_command_status`.
- **Permisos**: gate por rol admin (ya presente en el tab).
- **Selftest**: solo admin, rate-limit 1/min por sede, no crea pedido real (marca `is_test=true` y hace early-return antes de persistir).

## Archivos

- `supabase/migrations/*` — RPC `whatsapp_bot_full_status`
- `src/routes/api/public/whatsapp-bot-selftest.ts` — nuevo
- `src/components/ajustes/update-reconnect-wizard.tsx` — nuevo
- `src/components/ajustes/whatsapp-bot-tab.tsx` — botón + integración
- `whatsapp-bot/server.js` — solo si es necesario reportar `last_command_status` en heartbeat (probablemente sí)
- Nuevo ZIP `v8.21.0` en `/public/downloads/`

## Fuera de alcance

- Cambiar el mecanismo de transporte de comandos (ya funciona).
- Modificar la lógica de IA/pedidos (fue estabilizada en v8.20.0).
