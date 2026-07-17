# WhatsApp Bot V1 — Integrado a Goloso POS

Bot local por sede que se conecta a WhatsApp Web (mismo patrón que tu sistema actual), configurado y monitoreado desde el POS.

## Arquitectura

```text
┌───────────────────────────┐         ┌────────────────────────────┐
│ PC de la sede (Windows)   │  HTTPS  │  Goloso POS (Lovable)      │
│ ─ goloso-bot (Node.js)    │◄───────►│ ─ Panel admin WhatsApp Bot │
│   • Baileys + WhatsApp Web│  polling│ ─ Config 3 bienvenidas     │
│   • QR local en navegador │         │ ─ Estado en tiempo real    │
│   • Responde automático   │         │ ─ Log de mensajes          │
│   • Arranca con Windows   │         │                            │
└───────────────────────────┘         └────────────────────────────┘
```

El bot corre **en el PC de la sede** (igual que hoy). El POS solo lo configura y muestra estado — no procesa mensajes de WhatsApp.

## Alcance V1

**Sí incluye:**
- Bot local Node.js (Baileys) con instalador Windows (`.bat`), como el `print-server` actual.
- Emparejamiento QR: el QR se muestra en `http://localhost:8790` del PC (o dentro del POS vía polling).
- 3 mensajes de bienvenida por sede, rotan aleatoriamente por conversación nueva del día.
- Trigger "menú" / "carta" / "pedido" → responde con link al menú online de esa sede.
- Panel admin en POS: `/ajustes` nueva pestaña "WhatsApp Bot".
- Estado por sede: Conectado / Desconectado / Esperando QR / Última actividad.
- Log de últimos 200 mensajes por sede (entrantes + respuestas del bot).
- Anti-spam: solo saluda una vez por número por día. Delay humano 2–5s antes de responder.

**No incluye (queda para V2):**
- Bandeja para chatear manualmente desde el POS.
- Envío masivo / difusión.
- Respuestas por IA / NLP.
- Gestión de pedidos entrantes por WhatsApp.
- Estadísticas avanzadas.

## Cambios en base de datos

Migración nueva:

```sql
-- Config del bot por sede
CREATE TABLE public.whatsapp_bot_config (
  branch_id uuid PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  welcome_messages text[] NOT NULL DEFAULT ARRAY[
    '¡Hola! 👋 Gracias por escribir a Heladería Goloso.',
    '¡Hola! 🍨 Bienvenido a Goloso, ¿en qué te ayudamos?',
    '¡Hola! 😊 Gracias por contactarnos.'
  ],
  menu_triggers text[] NOT NULL DEFAULT ARRAY['menu','menú','carta','pedido','domicilio'],
  menu_message text NOT NULL DEFAULT 'Mira nuestro menú y pide aquí 👉 {menu_link}',
  connection_status text NOT NULL DEFAULT 'disconnected',
  qr_code text,
  last_seen_at timestamptz,
  device_token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24),'hex'),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Log de mensajes procesados
CREATE TABLE public.whatsapp_bot_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  from_number text NOT NULL,
  direction text NOT NULL, -- 'in' | 'out'
  body text,
  received_at timestamptz DEFAULT now()
);

-- Tracking de a quién ya saludamos hoy (evita saludar 2 veces al mismo)
CREATE TABLE public.whatsapp_bot_greeted (
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  phone text NOT NULL,
  greeted_date date NOT NULL DEFAULT current_date,
  PRIMARY KEY (branch_id, phone, greeted_date)
);
```

Con GRANTs y policies: solo admin/supervisor pueden leer/escribir config. `whatsapp_bot_messages` visible al admin de la sede. Las tablas se acceden vía server routes públicos autenticados por `device_token` (para el bot local) o por sesión (para el panel).

## Endpoints HTTP para el bot local

Bajo `src/routes/api/public/whatsapp-bot/`:

- `GET /api/public/whatsapp-bot/config?token=XXX` → devuelve config de la sede
- `POST /api/public/whatsapp-bot/status` (body: `{token, status, qr?}`) → bot reporta estado + QR
- `POST /api/public/whatsapp-bot/incoming` (body: `{token, from, body}`) → bot reporta mensaje, servidor decide respuesta y la devuelve

Autenticación: `device_token` único por sede. Rate-limit por token.

## Panel admin en POS

Nueva pestaña en `src/routes/_authenticated/ajustes.tsx` → "WhatsApp Bot":

- Selector de sede (admin) o sede fija (supervisor).
- Estado grande: 🟢 Conectado / 🟡 Esperando QR / 🔴 Desconectado — con "última señal hace X min".
- Botón "Ver QR" (muestra el QR en modal, refresco cada 5s vía realtime del `qr_code`).
- Editor de las 3 bienvenidas (agregar/editar/quitar; mínimo 1).
- Editor del mensaje de menú con placeholder `{menu_link}` reemplazado por el link de la sede.
- Palabras clave que disparan menú (chips editables).
- Toggle "Bot activo".
- Log de últimos 50 mensajes con filtro por número.
- Botón "Descargar bot para Windows" → link al ZIP con el bot + instalador.

## Bot local (Node.js)

Nueva carpeta `whatsapp-bot/` (paralela a `print-server/`):

- `package.json`, `server.js`, `install-windows.bat`, `start-windows.bat`, `start-hidden.vbs`, `README.md`.
- Dependencias: `@whiskeysockets/baileys`, `qrcode-terminal`, `pino`.
- Guarda sesión de Baileys en `./auth_state/` (persiste al reiniciar el PC).
- Loop: cada 30s hace `GET /config` para refrescar mensajes; cada 60s `POST /status` con heartbeat.
- Al recibir mensaje entrante: `POST /incoming` → recibe la respuesta a enviar → la envía con delay 2–5s.
- Server local en `http://localhost:8790` muestra QR y estado (por si el PC no tiene acceso al POS aún).
- Config inicial: pide el `device_token` de la sede (aparece en el panel POS) y lo guarda en `config.json`.

## Flujo del usuario (una sede)

1. En el POS entras a Ajustes → WhatsApp Bot → seleccionas la sede → aparece un `device_token` y botón "Descargar bot".
2. Descargas el ZIP, lo copias al PC de la sede, doble-click `install-windows.bat`. Instala Node.js si falta, pega el `device_token`, se registra como servicio de Windows que arranca con el PC.
3. Se abre `http://localhost:8790` mostrando el QR. Escaneas desde WhatsApp Business del celular de la sede.
4. Estado en el POS pasa a 🟢 Conectado. El bot ya responde.
5. Al día siguiente enciendes el PC → el servicio arranca solo → sesión Baileys recuperada → bot activo sin escanear QR de nuevo.

## Detalles técnicos

- **Runtime del bot**: Node.js LTS. El instalador detecta y ofrece descargar Node si falta.
- **Persistencia sesión**: Baileys guarda credenciales en `./auth_state/` (mismo comportamiento que WhatsApp Web guardando cookies).
- **Anti-baneo**: sin envíos masivos, solo responde a quien escribe, delay 2–5s aleatorio, no envía a números que no lo contactaron.
- **Reconexión**: si Baileys se desconecta, reintenta cada 15s. Reporta estado al POS.
- **Selección de bienvenida**: hash del `from_number + fecha` → índice del array (aleatorio pero determinista para no repetir en el mismo día).
- **Trigger de menú**: normaliza texto entrante (lowercase, sin acentos), busca cualquier `menu_trigger` como substring.
- **Link del menú**: `https://golosoheladeria.lovable.app/s/{branch.slug}/menu` (usa el slug de la sede).

## Riesgos y mitigación

- **Baneo por Meta**: bajo con el patrón conservador (solo respuesta a mensajes entrantes, sin masivos). Mismo riesgo que tu sistema actual.
- **PC apagado**: el bot no responde hasta encender de nuevo (igual que hoy).
- **Cambio de número/re-vinculación**: si el celular hace "cerrar sesiones activas" en WhatsApp, hay que re-escanear QR desde el panel.
- **Baileys**: es no-oficial. Meta puede cambiar el protocolo. Lo mitigamos manteniendo la versión actualizada.

## Entregables

1. Migración SQL con las 3 tablas + GRANTs + RLS.
2. Server routes `src/routes/api/public/whatsapp-bot/{config,status,incoming}.ts`.
3. Panel admin en `src/routes/_authenticated/ajustes.tsx` (pestaña nueva).
4. Bot local en carpeta `whatsapp-bot/` con instalador Windows.
5. README con instrucciones paso-a-paso para el admin.

¿Apruebas y arranco?
