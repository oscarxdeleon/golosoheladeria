# Goloso — Bot de WhatsApp

Bot local que corre en el **PC de cada sede** y responde automáticamente a los clientes que escriben al WhatsApp de esa sede. Se configura desde el POS de Goloso.

## Actualizar sin volver a escanear QR

Si el bot ya estaba conectado en ese PC, **no borres la carpeta anterior** ni la carpeta `auth_state/`.

1. Descarga y descomprime el ZIP nuevo.
2. Ejecuta **`SOLUCION-SIN-SABER-CARPETA.bat`** si no sabes dónde quedó instalado el bot anterior. También funciona **`ACTUALIZAR-SIN-QR.bat`**.
3. El actualizador hará una búsqueda profunda en Windows, conservará `config.json` y `auth_state/`, reemplazará solo el código del bot y lo iniciará de nuevo.

Mientras `auth_state/` exista y WhatsApp no haya cerrado la sesión desde el celular, **no tendrás que vincular nuevamente con QR**. Esta versión además crea una copia local en `auth_state_backups/latest/` y la restaura automáticamente si la carpeta activa se daña o desaparece durante un reinicio/actualización.

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

Debe aparecer `Versión : 8.12.0`. Si aparece otra versión, PM2 está apuntando a otra carpeta; el log ahora muestra la línea `Carpeta : ...` para identificarla.

Si por error ejecutas `install-windows.bat`, esta versión primero intenta detectar la instalación anterior y convertir el proceso en actualización segura. Solo pedirá token y QR cuando no encuentre una instalación anterior con `auth_state/`.

## Instalación nueva (Windows)

1. Requisitos: [Node.js 18+](https://nodejs.org) instalado en el PC.
2. Descomprime esta carpeta en un directorio **permanente** (no el escritorio ni Descargas).
3. En el POS, abre **Ajustes → WhatsApp Bot**, elige la sede y copia el **Token**.
4. Doble-click a `install-windows.bat`. Cuando pida el token, pégalo. No pide URL: usa automáticamente la URL publicada del POS.
5. Se abre `http://localhost:8790`. Cuando salga el QR, escanéalo con WhatsApp Business del celular de la sede (Menú → Dispositivos vinculados → Vincular un dispositivo).
6. Estado pasa a **Conectado**. Listo.

Si el QR no aparece en el POS, abre `http://localhost:8790` en el mismo PC donde instalaste el bot. Ese panel local muestra el QR y también indica si el token no coincide o si no pudo sincronizar con el POS. Como respaldo, el QR también se dibuja en la consola cuando WhatsApp lo entrega.

Si durante la instalación aparece `npm error enoent spawn git`, descarga nuevamente el ZIP desde el POS. Esta versión valida el token antes de iniciar y evita reinstalar dependencias si ya vienen incluidas.

El bot queda registrado para **arrancar solo con Windows**. Al apagar el PC se detiene; al encenderlo se recupera sin volver a escanear.

## Estructura

- `server.js` — bot principal (Baileys + polling al POS).
- `setup.js` — configuración interactiva del token y URL para instalaciones nuevas.
- `SOLUCION-SIN-SABER-CARPETA.bat` — busca automáticamente la sesión anterior aunque no sepas la ruta.
- `ACTUALIZAR-SIN-QR.bat` — actualización segura que conserva la sesión de WhatsApp.
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
