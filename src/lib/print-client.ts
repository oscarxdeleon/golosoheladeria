// Cliente de impresión: intenta enviar el ticket a un servidor de impresión
// local (silencioso). Si no está disponible o no está configurado, hace
// fallback a impresión por iframe + window.print().
//
// Configuración por máquina (se guarda en el navegador del POS):
//   localStorage.setItem("LOCAL_PRINT_URL", "http://localhost:3001/print")
// Para desactivar y volver al diálogo de impresión:
//   localStorage.removeItem("LOCAL_PRINT_URL")

export type PrintPayload = {
  type: "comanda" | "precuenta" | "ticket" | "comprobante" | "drawer";
  ticket?: number;
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
  ticket_template?: "goloso_personalizado";
  cash_received?: number;
  printer_ip?: string;
  printer_port?: number;
  cashierMessage?: string;
  open_drawer?: boolean;
};


const LS_KEY = "LOCAL_PRINT_URL";
const DEFAULT_LOCAL_PRINT_URL = "http://localhost:3001/print";

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
 * Envía el payload al servidor local. Prueba TODOS los candidatos en
 * paralelo con AbortController: el primero que responda OK gana y
 * cancela los demás — así evitamos duplicados aunque `localhost` y
 * `127.0.0.1` apunten al mismo servidor, y no perdemos el primer
 * intento cuando la resolución IPv6 de `localhost` tarda varios
 * segundos. Nunca lanza.
 */
export async function sendToLocalPrinter(payload: PrintPayload): Promise<boolean> {
  const primary = _lastGoodUrl ?? getLocalPrintUrl();
  const candidates = Array.from(
    new Set(
      [
        primary,
        DEFAULT_LOCAL_PRINT_URL,
        "http://127.0.0.1:3001/print",
      ]
        .map((u) => normalizePrintUrl(u))
        .filter(Boolean) as string[],
    ),
  );

  const TIMEOUT_MS = 4000;
  const body = JSON.stringify(payload);
  const controllers = candidates.map(() => new AbortController());
  const timers = controllers.map((c) => setTimeout(() => c.abort(), TIMEOUT_MS));

  const attempts = candidates.map(async (url, i) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controllers[i].signal,
      mode: "cors",
      keepalive: true,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return url;
  });

  let winner: string | null = null;
  try {
    winner = await Promise.any(attempts);
  } catch {
    winner = null;
  } finally {
    // Cancela intentos pendientes para evitar impresión doble.
    controllers.forEach((c, i) => {
      try { if (candidates[i] !== winner) c.abort(); } catch { /* noop */ }
      clearTimeout(timers[i]);
    });
  }

  if (winner) {
    _lastGoodUrl = winner;
    if (winner !== getLocalPrintUrl()) setLocalPrintUrl(winner);
    return true;
  }

  console.warn("[print] ningún servidor local respondió; se usará fallback");
  return false;
}

/** Imprime HTML usando un iframe oculto (fallback al diálogo del navegador).
 *  Es no-bloqueante: el llamador retoma el control de inmediato y el diálogo
 *  de impresión se abre en el próximo tick del navegador.
 */
export function printHTMLFallback(html: string) {
  if (typeof document === "undefined") return;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.srcdoc = html;
  iframe.onload = () => {
    // Diferimos al siguiente tick para no bloquear el hilo actual
    setTimeout(() => {
      try {
        const win = iframe.contentWindow;
        if (!win) return;
        const cleanup = () => setTimeout(() => iframe.remove(), 500);
        win.addEventListener("afterprint", cleanup, { once: true });
        win.focus();
        win.print();
        // Garantía de limpieza si el navegador no dispara afterprint
        setTimeout(cleanup, 8000);
      } catch (e) {
        console.error("print error", e);
        iframe.remove();
      }
    }, 0);
  };
  document.body.appendChild(iframe);
}

/**
 * Intenta imprimir vía servidor local; si falla, usa el fallback HTML.
 * Es fire-and-forget: no bloquea la UI.
 *
 * Opciones:
 *   silent: si es true y no hay servidor local configurado, NO abre el
 *           diálogo nativo del navegador (evita interrumpir el flujo del
 *           cajero). Solo muestra un aviso en consola. Recomendado para
 *           comandas de cocina enviadas automáticamente.
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
    printHTMLFallback(fallbackHTML);
  })();
}

/**
 * Envía SOLO el pulso de apertura del cajón monedero al servidor local.
 * Útil cuando el ticket se imprime por el diálogo del navegador (HTML)
 * pero igualmente se desea abrir la gaveta mediante ESC/POS.
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

