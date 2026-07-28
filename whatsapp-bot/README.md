# Goloso — Bot de WhatsApp

Bot local que corre en el **PC de cada sede** y responde automáticamente a los clientes que escriben al WhatsApp de esa sede. Se configura desde el POS de Goloso.

## Instalación / actualización Windows

La instalación oficial se hace desde el POS con un único botón: **Ajustes → WhatsApp Bot → Instalar / Actualizar Bot**.

Ese instalador descarga el paquete oficial, valida SHA-256, cierra procesos anteriores, elimina instalaciones viejas, instala en `%LOCALAPPDATA%\GolositoBot\app`, registra los nuevos accesos e inicia el bot validando la versión en ejecución.

La sesión de WhatsApp se guarda separada del código en AppData por sede para evitar volver a escanear QR durante actualizaciones normales.

## Actualización definitiva en Ubuntu / Droplet con PM2

Si en los logs sigue saliendo una versión vieja como `8.4.0`, el proceso PM2 está arrancando desde una carpeta antigua o `git pull` no está actualizando el código real. Ejecuta este comando en el servidor para descargar el paquete publicado, copiarlo sobre la carpeta correcta y reiniciar PM2 desde esa misma ruta:

```bash
curl -fsSL https://golosoheladeria.lovable.app/downloads/update-linux.sh | bash -s -- /opt/goloso/sede2 goloso-parque
```

Luego valida:

```bash
pm2 logs goloso-parque --lines 40 --nostream
curl -s http://localhost:8791/status.json
```

Debe aparecer `Versión : 8.20.7`. Si aparece otra versión, PM2 está apuntando a otra carpeta; el log ahora muestra la línea `Carpeta : ...` para identificarla.

Si por error ejecutas `install-windows.bat`, esta versión primero intenta detectar la instalación anterior y convertir el proceso en actualización segura. Solo pedirá token y QR cuando no encuentre una instalación anterior con `auth_state/`.

## Instalación nueva (Windows)

1. Requisito: [Node.js 18+](https://nodejs.org) instalado en el PC.
2. En el POS, abre **Ajustes → WhatsApp Bot** y presiona **Instalar / Actualizar Bot**.
3. Ejecuta el archivo descargado. No pide token, rutas ni carpetas.
4. Si es primera vinculación, escanea el QR desde WhatsApp Business de la sede.

Si el QR no aparece en el POS, abre `http://localhost:8790` en el mismo PC donde instalaste el bot. Ese panel local muestra el QR y también indica si el token no coincide o si no pudo sincronizar con el POS. Como respaldo, el QR también se dibuja en la consola cuando WhatsApp lo entrega.

Si durante la instalación aparece `npm error enoent spawn git`, descarga nuevamente el ZIP desde el POS. Esta versión valida el token antes de iniciar y evita reinstalar dependencias si ya vienen incluidas.

El bot queda registrado para **arrancar solo con Windows**. Al apagar el PC se detiene; al encenderlo se recupera sin volver a escanear.

## Estructura

- `server.js` — bot principal (Baileys + polling al POS).
- `goloso-bot-installer.js` — instalador único Windows con limpieza, instalación y validación.
- `setup.js` — respaldo para configuración local manual.
- `update-linux.sh` — actualización segura para Ubuntu/Droplet con PM2.
- `config.json` — se genera al ejecutar setup (contiene el token, mantener privado).
- `auth_state/` — sesión de WhatsApp guardada por Baileys. **No borrar** (perdería la vinculación).
- `bot.log` / `bot-out.log` — logs.

## Desinstalar

Doble-click a `uninstall-windows.bat`. Luego borrar la carpeta.

## Notas

- Toda la configuración (mensajes de bienvenida, palabras clave del menú, etc.) se edita en el POS. Los cambios se reflejan al instante.
- No usa API oficial de Meta: escanea el QR igual que WhatsApp Web. El celular puede seguir usándose normal.
- Solo responde a **mensajes entrantes**. Nunca envía mensajes masivos.
