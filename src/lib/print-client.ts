// Cliente de impresión: intenta enviar el ticket a un servidor de impresión
// local (silencioso). Si no está disponible o no está configurado, hace
// fallback a impresión por iframe + window.print().
//
// Configuración por máquina (se guarda en el navegador del POS):
//   localStorage.setItem("LOCAL_PRINT_URL", "http://localhost:3001/print")
// Para desactivar y volver al diálogo de impresión:
//   localStorage.removeItem("LOCAL_PRINT_URL")

export type PrintPayload = {
  type: "comanda" | "precuenta" | "ticket";
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
};

const LS_KEY = "LOCAL_PRINT_URL";

export function getLocalPrintUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

export function setLocalPrintUrl(url: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (url) window.localStorage.setItem(LS_KEY, url);
    else window.localStorage.removeItem(LS_KEY);
  } catch {
    /* noop */
  }
}

/**
 * Envía el payload al servidor local. Devuelve true si el servidor respondió OK.
 * Se ejecuta en segundo plano: nunca lanza.
 */
export async function sendToLocalPrinter(payload: PrintPayload): Promise<boolean> {
  const url = getLocalPrintUrl();
  if (!url) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      mode: "cors",
    });
    clearTimeout(t);
    return res.ok;
  } catch (e) {
    console.warn("[print] servidor local no disponible", e);
    return false;
  }
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
 */
export function printSilent(payload: PrintPayload, fallbackHTML: string) {
  void (async () => {
    const ok = await sendToLocalPrinter(payload);
    if (!ok) printHTMLFallback(fallbackHTML);
  })();
}
