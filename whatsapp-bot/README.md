# Goloso — Bot de WhatsApp

Bot local que corre en el **PC de cada sede** y responde automáticamente a los clientes que escriben al WhatsApp de esa sede. Se configura desde el POS de Goloso.

## Instalación (Windows)

1. Requisitos: [Node.js 18+](https://nodejs.org) instalado en el PC.
2. Descomprime esta carpeta en un directorio **permanente** (no el escritorio ni Descargas).
3. En el POS, abre **Ajustes → WhatsApp Bot**, elige la sede y copia el **Token**.
4. Doble-click a `install-windows.bat`. Cuando pida el token, pégalo.
5. Se abre `http://localhost:8790`. Cuando salga el QR, escanéalo con WhatsApp Business del celular de la sede (Menú → Dispositivos vinculados → Vincular un dispositivo).
6. Estado pasa a **Conectado**. Listo.

Si el QR no aparece en el POS, abre `http://localhost:8790` en el mismo PC donde instalaste el bot. Ese panel local muestra el QR y también indica si el token no coincide o si no pudo sincronizar con el POS.

Si durante la instalación aparece `npm error enoent spawn git`, descarga nuevamente el ZIP desde el POS. Esta versión valida el token antes de iniciar y evita reinstalar dependencias si ya vienen incluidas.

El bot queda registrado para **arrancar solo con Windows**. Al apagar el PC se detiene; al encenderlo se recupera sin volver a escanear.

## Estructura

- `server.js` — bot principal (Baileys + polling al POS).
- `setup.js` — configuración interactiva del token y URL.
- `config.json` — se genera al ejecutar setup (contiene el token, mantener privado).
- `auth_state/` — sesión de WhatsApp guardada por Baileys. **No borrar** (perdería la vinculación).
- `bot.log` / `bot-out.log` — logs.

## Desinstalar

Doble-click a `uninstall-windows.bat`. Luego borrar la carpeta.

## Notas

- Toda la configuración (mensajes de bienvenida, palabras clave del menú, etc.) se edita en el POS. Los cambios se reflejan al instante.
- No usa API oficial de Meta: escanea el QR igual que WhatsApp Web. El celular puede seguir usándose normal.
- Solo responde a **mensajes entrantes**. Nunca envía mensajes masivos.
