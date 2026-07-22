# Fase 1 — Asistente IA de WhatsApp (MVP)

Basado en tus respuestas: IA responde saludos, preguntas generales y menú con contexto; entiende audios de voz; **actúa solo cuando la respuesta fija actual no aplica**; **modo sandbox** (whitelist de números); tono juvenil con emojis.

## Arquitectura

```text
Cliente WA ──► Bot local (PC sede)
                    │
                    ▼
        POST /api/public/whatsapp-bot { action: "incoming" }
                    │
                    ▼
        RPC whatsapp_bot_handle_incoming
        - ¿matchea keyword fijo (menú/horario)? → responde fijo
        - ¿no matchea + IA activa + número en sandbox? → { use_ai: true, context }
                    │
                    ▼ (bot local ve use_ai:true)
        POST /api/public/whatsapp-bot { action: "ai_reply", text/audio_b64 }
                    │
                    ▼
        TanStack server route → Lovable AI Gateway
        google/gemini-3.6-flash (texto + audio OGG nativo, un solo call)
                    │
                    ▼
        Devuelve texto al bot → bot lo envía por WhatsApp
```

**Por qué Gemini 3.6 Flash**: acepta audio OGG/Opus nativo (formato de WhatsApp) sin transcodificar → no requiere ffmpeg en los PCs de las sedes. Un solo modelo para texto y voz. Costo: ~centavos/mes.

## Cambios

### 1. Base de datos (migración)
Extender `whatsapp_bot_config` con:
- `ai_enabled boolean default false`
- `ai_sandbox_numbers text[] default '{}'` (números autorizados en pruebas; vacío = nadie)
- `ai_system_prompt text` (opcional, con default juvenil pre-cargado)
- `ai_last_reply_at timestamptz` (telemetría)

Nueva RPC `whatsapp_bot_ai_context(_token)` → devuelve nombre sede, link menú, horarios de hoy, teléfono. La usa el endpoint IA para construir el system prompt dinámico.

Modificar `whatsapp_bot_handle_incoming` para que devuelva `{ use_ai: true, message_id }` cuando: no matcheó keyword fijo + `ai_enabled` + número en `ai_sandbox_numbers`.

### 2. Nuevo endpoint TanStack
`src/routes/api/public/whatsapp-bot.ts` — agregar acción `ai_reply`:
- Recibe `{ token, from, text?, audio_b64?, audio_mime? }`
- Valida token de sede (RPC existente)
- Obtiene contexto de sede (nueva RPC)
- Llama Lovable AI Gateway con system prompt + contexto + input del cliente
- Devuelve `{ reply: "texto para enviar" }`

Sin persistencia de conversación en Fase 1 (cada mensaje es stateless — mantiene el scope MVP acotado).

### 3. Bot local (`whatsapp-bot/server.js`)
- Al recibir `use_ai:true` en respuesta a `incoming`, llamar `ai_reply` con el texto o el audio (base64 del OGG que ya recibe de Baileys).
- Enviar la respuesta por WhatsApp usando el mismo flujo actual.
- Bump versión → **v8**. Publicar ZIP nuevo en `/public/downloads/whatsapp-bot-v8.zip`.
- Actualizar `install-windows.bat` y `update-windows.bat` para conservar sesión.

### 4. UI POS
En `src/components/ajustes/whatsapp-bot-tab.tsx`, nueva sub-sección "**Asistente IA (Beta)**":
- Toggle "Activar asistente IA"
- Textarea "Números autorizados en pruebas" (uno por línea, formato +57...)
- Textarea "Personalidad del asistente" (con valor default juvenil pre-cargado, editable)
- Texto informativo: "En modo sandbox, la IA solo responderá a los números aquí listados. Los demás verán las respuestas fijas actuales."

### 5. System prompt (default juvenil)
```
Eres el asistente de Heladería Goloso, sede {sede}. Tono cercano, juvenil, 
con emojis de helado 🍦🍨. Respuestas cortas (2-3 líneas máx). 
Horario hoy: {horario}. Menú: {link_menu}. Si el cliente pide algo 
específico del menú, dirígelo al link. Si pregunta por sabores/precios 
sin ver el menú, envía el link. No inventes promociones. Si no sabes 
algo, di que un asesor lo contacta pronto.
```

## Detalles técnicos

- **Modelo**: `google/gemini-3.6-flash` vía Lovable AI Gateway (`LOVABLE_API_KEY` ya provisionada). Fallback a `openai/gpt-5.5` si Gemini falla.
- **Audio**: se pasa como `input_audio` block en chat completions, `format: "ogg"`, base64. Sin transcodificación cliente ni STT separado.
- **Sandbox check**: normalización de números (quitar `+`, espacios, guiones) antes de comparar.
- **Sin memoria conversacional en Fase 1**: cada mensaje independiente. Reduce complejidad y costo. Si funciona bien, la Fase 2 agrega historial en tabla `whatsapp_ai_messages`.
- **Rate limiting**: máx 20 respuestas IA por número por día (protección contra loops o abuso). Se guarda en tabla ligera `whatsapp_ai_usage`.
- **Errores del gateway** (429/402): se registran y el bot NO envía nada (mejor silencio que un mensaje roto). Se loguea para diagnóstico.

## Alcance excluido de Fase 1 (para Fase 2+)
- Toma de pedidos por conversación
- Modificación del estado en `sales`
- Interpretación de imágenes
- Memoria multi-turno
- Panel de conversaciones IA en el POS

## Orden de implementación
1. Migración DB (RPCs + campos config)
2. Endpoint TanStack `ai_reply`
3. UI en pestaña WhatsApp Bot
4. Cambios en `whatsapp-bot/server.js` + ZIP v8
5. Prueba con tu número personal en sandbox

¿Apruebas el plan? Si sí, arranco por el paso 1 (migración) y sigo en orden. Total estimado: 4-6 mensajes de build hasta tener el ZIP v8 listo para instalar en una sede de prueba.