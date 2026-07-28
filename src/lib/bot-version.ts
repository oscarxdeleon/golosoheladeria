// Nomenclatura estandarizada del chatbot de WhatsApp.
// Cada nueva versión debe agregarse al inicio de BOT_VERSION_HISTORY.

export const BOT_NAME = "Golosito";
export const BOT_VERSION = "8.22.9";

/** Nombre estandarizado del archivo descargable: `golosito-vX.Y.Z.zip`. */
export const BOT_DOWNLOAD_FILENAME = `golosito-v${BOT_VERSION}.zip`;

/** URL directa al ZIP versionado publicado en /public/downloads. */
export const BOT_DOWNLOAD_URL = `/downloads/${BOT_DOWNLOAD_FILENAME}`;

/** URL estable (redirect) que siempre apunta a la última versión publicada. */
export const BOT_LATEST_DOWNLOAD_URL = "/downloads/golosito.zip";

/** SHA-256 del ZIP oficial publicado para validar integridad en instaladores remotos. */
export const BOT_DOWNLOAD_SHA256 = "f4c15ce7a24f0bcb0f4ab76100bc9356ff8ee36fa01cf69aa481a8786f745fda";

export type BotReleaseStatus = "exitosa" | "fallida";

export interface BotReleaseEntry {
  version: string;
  date: string; // ISO
  author: string;
  status: BotReleaseStatus;
  notes: string;
}

// Historial más reciente primero.
export const BOT_VERSION_HISTORY: BotReleaseEntry[] = [
  {
    version: "8.22.9",
    date: "2026-07-28",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Sustitución total del actualizador Windows por instalación limpia: crea una única ruta fija de ejecución en LocalAppData, cierra procesos viejos, limpia Startup/Registro/tareas/cachés, neutraliza copias antiguas, conserva sesión por sede aparte y valida package/server/installation/status antes y después de simular reinicio.",
  },
  {
    version: "8.22.8",
    date: "2026-07-28",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Corrige el falso error del instalador Windows en sede Parque: ahora detecta automáticamente el panel local en cualquier puerto 8790-8810, abre el puerto correcto y no falla cuando Parque usa 8791.",
  },
  {
    version: "8.22.7",
    date: "2026-07-28",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Cambio definitivo de metodología en Windows: instala en carpeta canónica por sede, registra un launcher permanente, neutraliza arranques antiguos 8.20.9, valida la versión activa y conserva config.json/auth_state sin pedir QR.",
  },
  {
    version: "8.22.6",
    date: "2026-07-28",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Corrige el aviso de cierre de sesión en Windows: ante logged_out el bot conserva credenciales, reinicia el proceso local para reconectar sin QR, limpia avisos transitorios al conectar y solo genera QR nuevo tras varios rechazos seguros de WhatsApp.",
  },
  {
    version: "8.22.5",
    date: "2026-07-28",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Corrige el actualizador Windows sin QR: ya no cancela por falsos negativos, busca sesiones persistentes y respaldos por token de sede, y evita mezclar sesiones entre Santa y Parque.",
  },
  {
    version: "8.22.4",
    date: "2026-07-28",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Blindaje definitivo de sesión WhatsApp en Windows: las credenciales se migran a una carpeta persistente por sede en AppData, el actualizador respalda/restaura sesiones y el bot ya no borra auth_state automáticamente ante falsos cierres durante actualización.",
  },
  {
    version: "8.22.3",
    date: "2026-07-28",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Corrige el falso bloqueo por 'Instancia duplicada pausada' durante actualizaciones: una instancia nueva puede tomar control sobre el registro anterior, los procesos duplicados se cierran solos y el actualizador limpia candados locales obsoletos antes de arrancar.",
  },
  {
    version: "8.22.2",
    date: "2026-07-28",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Corrección definitiva del sistema de actualización: el comando remoto ahora descarga siempre el update-linux.sh más reciente, el actualizador Linux dejó de apuntar a 8.20.9, soporta ZIP con carpeta raíz whatsapp-bot/, y el actualizador Windows detecta correctamente Santa/Parque (puertos 8790/8791) antes de verificar la versión activa.",
  },
  {
    version: "8.22.1",
    date: "2026-07-28",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Actualizador remoto para Windows: nuevo .bat que descarga siempre el ZIP más reciente desde la nube, lo extrae en temp y ejecuta el updater desde allí (los archivos nuevos SÍ reemplazan los viejos). Verificación de versión post-instalación consultando /status.json — si la versión activa no coincide con la esperada, el actualizador aborta con error explícito en lugar de reportar falso éxito.",
  },
  {
    version: "8.22.0",
    date: "2026-07-28",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Soporte para respuestas con opciones estructuradas: el backend puede enviar 'options' y el bot las convierte en lista numerada (1, 2, 3…) que el cliente puede responder por número o por texto. Base para el rediseño de flujo conversacional.",
  },
  {
    version: "8.21.0",
    date: "2026-07-28",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Anti-duplicado a nivel base de datos: el bot reenvía el ID del mensaje y el backend descarta reintentos del mismo webhook, evitando saludos y respuestas duplicadas.",
  },
  {
    version: "8.20.9",
    date: "2026-07-26",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Root fix del apagón: reinicio automático si el bot queda conectado sin revisar cola, heartbeat más estricto y estado vencido visible como desconectado.",
  },
  {
    version: "8.20.8",
    date: "2026-07-26",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Actualizador definitivo para Santa: elimina procesos viejos de la sede, fuerza el puerto correcto y preserva la versión activa cuando una instancia obsoleta reporta estado.",
  },
  {
    version: "8.20.7",
    date: "2026-07-26",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Corrige memoria conversacional por contacto, expira carritos incompletos y preserva JIDs anónimos de WhatsApp para que Santa y Parque respondan sin reutilizar pedidos.",
  },
  {
    version: "8.20.6",
    date: "2026-07-26",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Corrige bloqueos de conversación, timeouts del bot local, memoria de mensajes cortos y fallback operativo para evitar silencios.",
  },
  {
    version: "8.20.5",
    date: "2026-07-25",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Corrige silencio por cooldown, endurece instancias duplicadas y agrega verificación activa del WebSocket de WhatsApp.",
  },
  {
    version: "8.20.4",
    date: "2026-07-25",
    author: "Equipo Goloso",
    status: "exitosa",
    notes:
      "Nomenclatura golosito-vX.Y.Z, envío directo prioriza número real y encola respuesta si WhatsApp falla.",
  },
  {
    version: "8.20.3",
    date: "2026-07-24",
    author: "Equipo Goloso",
    status: "exitosa",
    notes: "Fallback vía cola cuando el envío directo falla, JID de teléfono real priorizado.",
  },
  {
    version: "8.20.2",
    date: "2026-07-22",
    author: "Equipo Goloso",
    status: "exitosa",
    notes: "Estabilidad anti-flapping en el estado Conectado/Desconectado.",
  },
  {
    version: "8.20.1",
    date: "2026-07-20",
    author: "Equipo Goloso",
    status: "exitosa",
    notes: "Lock local .goloso-bot.lock para evitar procesos duplicados.",
  },
  {
    version: "8.20.0",
    date: "2026-07-18",
    author: "Equipo Goloso",
    status: "exitosa",
    notes: "Prioriza Gemini directo, flujos deterministas y quota tracking.",
  },
];

export function botFilenameForVersion(version: string): string {
  return `golosito-v${version}.zip`;
}
