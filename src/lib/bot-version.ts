// Nomenclatura estandarizada del chatbot de WhatsApp.
// Cada nueva versión debe agregarse al inicio de BOT_VERSION_HISTORY.

export const BOT_NAME = "Golosito";
export const BOT_VERSION = "8.20.4";

/** Nombre estandarizado del archivo descargable: `golosito-vX.Y.Z.zip`. */
export const BOT_DOWNLOAD_FILENAME = `golosito-v${BOT_VERSION}.zip`;

/** URL directa al ZIP versionado publicado en /public/downloads. */
export const BOT_DOWNLOAD_URL = `/downloads/${BOT_DOWNLOAD_FILENAME}`;

/** URL estable (redirect) que siempre apunta a la última versión publicada. */
export const BOT_LATEST_DOWNLOAD_URL = "/downloads/golosito.zip";

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
