// Identificador único y persistente por equipo (PC / navegador).
// Se guarda en localStorage y no se sincroniza jamás con la base de datos,
// así cada terminal conserva su propia identidad y su propia configuración
// de impresión independiente de otras sedes o equipos.

const TERMINAL_ID_KEY = "goloso.terminalId";
const TERMINAL_NAME_KEY = "goloso.terminalName";

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch { /* noop */ }
  return "term-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function getTerminalId(): string {
  if (typeof window === "undefined") return "server";
  try {
    let id = window.localStorage.getItem(TERMINAL_ID_KEY);
    if (!id) {
      id = randomId();
      window.localStorage.setItem(TERMINAL_ID_KEY, id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

export function getTerminalName(): string {
  if (typeof window === "undefined") return "";
  try { return window.localStorage.getItem(TERMINAL_NAME_KEY) ?? ""; } catch { return ""; }
}

export function setTerminalName(name: string): void {
  if (typeof window === "undefined") return;
  try {
    const value = name.trim();
    if (value) window.localStorage.setItem(TERMINAL_NAME_KEY, value);
    else window.localStorage.removeItem(TERMINAL_NAME_KEY);
  } catch { /* noop */ }
}
