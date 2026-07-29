// ---------------------------------------------------------------------------
// Lectura tolerante de las variables de entorno de Evolution API y del POS.
// Acepta el nombre técnico (EVOLUTION_API_URL) y también variantes creadas por
// paneles traducidos (ej. "URL_DE_LA_API_DE_EVOLUCIÓN", "CLAVE_API_DE_EVOLUCION",
// "TOKEN_DE_WEBHOOK_DE_EVOLUCION", "POS_URL_PÚBLICA"), sin importar acentos,
// mayúsculas o guiones. Solo se usa en código de servidor.
// ---------------------------------------------------------------------------

function normalize(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Palabras clave que deben estar presentes (en cualquier orden) en el nombre. */
const MATCHERS: Record<string, string[][]> = {
  EVOLUTION_API_URL: [
    ["EVOLUTION", "API", "URL"],
    ["EVOLUCION", "API", "URL"],
  ],
  EVOLUTION_API_KEY: [
    ["EVOLUTION", "API", "KEY"],
    ["EVOLUCION", "API", "CLAVE"],
    ["EVOLUCION", "API", "KEY"],
    ["EVOLUTION", "API", "CLAVE"],
  ],
  EVOLUTION_WEBHOOK_TOKEN: [
    ["EVOLUTION", "WEBHOOK", "TOKEN"],
    ["EVOLUCION", "WEBHOOK", "TOKEN"],
  ],
  POS_PUBLIC_URL: [
    ["POS", "PUBLIC", "URL"],
    ["POS", "URL", "PUBLICA"],
    ["POS", "URL", "PUBLICO"],
    ["URL", "PUBLICA", "POS"],
  ],
};

export function readEvolutionEnv(
  canonical: "EVOLUTION_API_URL" | "EVOLUTION_API_KEY" | "EVOLUTION_WEBHOOK_TOKEN" | "POS_PUBLIC_URL",
): string | undefined {
  const env = process.env as Record<string, string | undefined>;
  const direct = env[canonical];
  if (direct && direct.trim()) return direct.trim();

  const patterns = MATCHERS[canonical];
  for (const [rawName, rawValue] of Object.entries(env)) {
    if (!rawValue || !rawValue.trim()) continue;
    const key = normalize(rawName);
    const parts = key.split("_");
    for (const pattern of patterns) {
      if (pattern.every((word) => parts.includes(word))) {
        // Evitar que la URL se confunda con la clave y viceversa.
        if (canonical === "EVOLUTION_API_URL" && !/^https?:\/\//i.test(rawValue.trim())) continue;
        if (canonical !== "EVOLUTION_API_URL" && /^https?:\/\//i.test(rawValue.trim())) continue;
        return rawValue.trim();
      }
    }
  }
  return undefined;
}
