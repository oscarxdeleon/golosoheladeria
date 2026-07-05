// Cliente de impresión: envía tickets/comandas al servidor local de impresión
// silenciosa. Nunca usa window.print() para evitar cuadros del sistema.
//
// Configuración por máquina (se guarda en el navegador del POS):
//   localStorage.setItem("LOCAL_PRINT_URL", "http://localhost:3001/print")

export type PrintPayload = {
  type: "comanda" | "precuenta" | "ticket" | "comprobante" | "drawer";
  ticket?: number;
  ticket_number?: number;
  header: string;
  items: { name: string; qty: number; unit_price?: number }[];
  subtotal?: number;
  tax?: number;
  deliveryFee?: number;
  total?: number;
  payment_method?: string;
  customer?: string;
  notes?: string;
  address?: string;
  phone?: string;
  user_name?: string;
  created_at?: string;
  // Datos de la sede (impresos en el encabezado del ticket).
  business_name?: string;
  nit?: string;
  address_biz?: string;
  phone_biz?: string;
  email_biz?: string;
  footer_text?: string;
  logo_url?: string;
  logo_fallback_url?: string;
  ticket_config?: Record<string, unknown>;
  ticket_template?: "goloso_personalizado";
  cash_received?: number;
  printer_ip?: string;
  printer_port?: number;
  cashierMessage?: string;
  open_drawer?: boolean;
};


const LS_KEY = "LOCAL_PRINT_URL";
const DEFAULT_LOCAL_PRINT_URL = "http://localhost:3001/print";

/**
 * Normaliza texto para el servidor ESC/POS sin quitar tildes ni ñ. El servidor
 * local convierte esos caracteres a la página de códigos de la impresora.
 */
function sanitizeForPrinter(input: unknown): string {
  if (input === null || input === undefined) return "";
  let s = String(input);
  // Comillas y guiones tipográficos → ASCII
  s = s
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/[\u2022\u25CF\u25AA\u25A0]/g, "*")
    .replace(/\u00D7/g, "x")
    .replace(/\u00B0/g, "o");
  s = s.normalize("NFC");
  // Eliminar solo controles invisibles; conservar Latin-1 imprimible.
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return s;
}

function sanitizePayloadForPrinter(p: PrintPayload): PrintPayload {
  const strFields: (keyof PrintPayload)[] = [
    "header", "payment_method", "customer", "notes", "address", "phone",
    "user_name", "business_name", "nit", "address_biz", "phone_biz",
    "email_biz", "footer_text", "logo_url", "logo_fallback_url", "cashierMessage",
  ];
  const out: PrintPayload = { ...p };
  for (const k of strFields) {
    const v = out[k];
    if (typeof v === "string") (out as Record<string, unknown>)[k] = sanitizeForPrinter(v);
  }
  if (Array.isArray(out.items)) {
    out.items = out.items.map((i) => ({ ...i, name: sanitizeForPrinter(i.name) }));
  }
  return out;
}


// Cache en memoria — evita ir a localStorage/supabase en cada impresión.
let _cachedUrl: string | null | undefined = undefined;
let _lastGoodUrl: string | null = null;

function normalizePrintUrl(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.pathname === "/" || url.pathname === "") url.pathname = "/print";
    return url.toString();
  } catch {
    return value.endsWith("/print") ? value : value.replace(/\/+$/, "") + "/print";
  }
}

export function getLocalPrintUrl(): string | null {
  if (_cachedUrl !== undefined) return _cachedUrl;
  if (typeof window === "undefined") return null;
  try {
    _cachedUrl = normalizePrintUrl(window.localStorage.getItem(LS_KEY));
    return _cachedUrl;
  } catch {
    return null;
  }
}

export function setLocalPrintUrl(url: string | null) {
  if (typeof window === "undefined") return;
  try {
    const normalized = normalizePrintUrl(url);
    _cachedUrl = normalized;
    if (normalized) window.localStorage.setItem(LS_KEY, normalized);
    else window.localStorage.removeItem(LS_KEY);
  } catch {
    /* noop */
  }
}

let _bootstrapPromise: Promise<string | null> | null = null;
/**
 * Si no hay URL en localStorage, la lee UNA VEZ desde la tabla `settings`
 * (columna `local_print_url`) y la persiste en localStorage.
 */
export async function bootstrapLocalPrintUrl(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const existing = getLocalPrintUrl();
  if (existing) return existing;
  if (_bootstrapPromise) return _bootstrapPromise;
  _bootstrapPromise = (async () => {
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("settings")
        .select("local_print_url")
        .limit(1)
        .maybeSingle();
      const url = normalizePrintUrl((data as { local_print_url?: string | null } | null)?.local_print_url ?? null);
      if (url) setLocalPrintUrl(url);
      return url;
    } catch {
      return null;
    }
  })();
  return _bootstrapPromise;
}

// Dispara bootstrap en segundo plano lo antes posible.
if (typeof window !== "undefined") {
  void bootstrapLocalPrintUrl();
}

/**
 * Envía el payload al servidor local. Prueba los candidatos SECUENCIALMENTE
 * — nunca en paralelo — para evitar impresión doble cuando `localhost` y
 * `127.0.0.1` apuntan al mismo servidor. El primer candidato que responda
 * OK se cachea como `_lastGoodUrl` y se usa como primera opción en el
 * próximo envío. Nunca lanza.
 */
export async function sendToLocalPrinter(payload: PrintPayload): Promise<boolean> {
  let configuredUrl = getLocalPrintUrl();
  if (!configuredUrl) {
    configuredUrl = await bootstrapLocalPrintUrl();
  }
  const primary = _lastGoodUrl ?? configuredUrl;
  const candidates = Array.from(
    new Set(
      [
        primary,
        primary ? null : DEFAULT_LOCAL_PRINT_URL,
        primary ? null : "http://127.0.0.1:3001/print",
      ]
        .map((u) => normalizePrintUrl(u))
        .filter(Boolean) as string[],
    ),
  );

  const TIMEOUT_MS = 4000;
  // Normalizamos comillas/controles, conservando tildes para que el servidor
  // local las codifique en CP850 antes de enviarlas a la impresora.
  const body = JSON.stringify(sanitizePayloadForPrinter(payload));


  for (const url of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
        mode: "cors",
        keepalive: true,
      });
      if (res.ok) {
        _lastGoodUrl = url;
        if (url !== getLocalPrintUrl()) setLocalPrintUrl(url);
        return true;
      }
    } catch {
      /* prueba el siguiente candidato */
    } finally {
      clearTimeout(timer);
    }
  }

  console.warn("[print] ningún servidor local respondió; no se abrirá diálogo del sistema");
  return false;
}

export function printHTMLFallback(html: string) {
  void html;
  console.warn("[print] fallback HTML deshabilitado: impresión solo por servidor local silencioso");
}

/**
 * Intenta imprimir vía servidor local; si falla, no abre diálogos del sistema.
 * Es fire-and-forget: no bloquea la UI.
 *
 * Opciones:
  *   silent: se conserva por compatibilidad; ningún modo abre diálogo nativo.
 */
export function printSilent(
  payload: PrintPayload,
  fallbackHTML: string,
  opts: { silent?: boolean } = {},
) {
  void (async () => {
    const ok = await sendToLocalPrinter(payload);
    if (ok) return;
    if (opts.silent) {
      console.warn(
        "[print] servidor local no configurado; comanda no impresa. " +
          'Configura localStorage.LOCAL_PRINT_URL="http://localhost:3001/print"',
      );
      return;
    }
    void fallbackHTML;
    console.warn("[print] no se imprimió: servidor local no disponible");
  })();
}

/**
 * Envía SOLO el pulso de apertura del cajón monedero al servidor local.
 * Útil para abrir la gaveta mediante ESC/POS sin imprimir ticket.
 *
 * Nunca llamar desde flujos de cocina/KDS — la gaveta debe permanecer
 * cerrada al imprimir comandas.
 */
export async function kickCashDrawer(opts: { printer_ip?: string; printer_port?: number } = {}): Promise<boolean> {
  return sendToLocalPrinter({
    type: "drawer",
    header: "DRAWER",
    items: [],
    open_drawer: true,
    printer_ip: opts.printer_ip,
    printer_port: opts.printer_port,
  });
}

