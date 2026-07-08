// Cliente de impresión: envía tickets/comandas al servidor local de impresión
// silenciosa. Nunca usa window.print() para evitar cuadros del sistema.
//
// Configuración por máquina (se guarda en el navegador del POS):
//   localStorage.setItem("LOCAL_PRINT_URL", "http://localhost:3001/print")

export type PrintPayload = {
  type: "comanda" | "precuenta" | "ticket" | "comprobante" | "drawer";
  /** Cuando true, se imprime como "ADICIÓN AL PEDIDO" (solo comandas). */
  is_addition?: boolean;
  ticket?: number | null;
  ticket_number?: number | null;
  header: string;
  /** Origen del pedido — se imprime como "PEDIDO PARA MESA / EN LÍNEA / DESDE QUIOSCO / PARA LLEVAR". */
  order_type?: "mesa" | "llevar" | "domicilio" | "kiosko" | "online" | string;
  items: { name: string; qty: number; unit_price?: number; modifiers?: string[] }[];
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
  logo_raster_base64?: string;
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
    out.items = out.items.map((i) => {
      // Algunas rutas guardan el nombre con los modificadores embebidos como
      // líneas ("Producto\n  + 1× Mod"). El array `modifiers` ya los lleva
      // aparte, así que conservamos SOLO la primera línea del nombre para
      // evitar que se impriman por partida doble en la comanda.
      const firstLine = String(i.name ?? "").split(/\r?\n/)[0] ?? "";
      const cleaned = Array.isArray(i.modifiers)
        ? i.modifiers
            .map((m) => sanitizeForPrinter(m))
            .map((m) => m.replace(/^\s*[+*]\s*/, "").trim())
            .filter((m) => m.length > 0)
        : undefined;
      // Deduplicar (case-insensitive) manteniendo el orden original.
      const modifiers = cleaned
        ? cleaned.filter((m, idx, arr) => arr.findIndex((x) => x.toLowerCase() === m.toLowerCase()) === idx)
        : undefined;
      return { ...i, name: sanitizeForPrinter(firstLine), modifiers };
    });
  }
  return out;
}

/**
 * Convierte un modificador (string u objeto de carrito con name/qty) al texto
 * que se imprime en la comanda. Devuelve `""` si no hay nada legible.
 */
export function formatModifierLabel(m: unknown): string {
  if (m == null) return "";
  if (typeof m === "string") return m.trim();
  if (typeof m === "object") {
    const o = m as { name?: unknown; qty?: unknown };
    const name = String(o.name ?? "").trim();
    if (!name) return "";
    const qty = Number(o.qty ?? 1);
    return Number.isFinite(qty) && qty > 1 ? `${qty}x ${name}` : name;
  }
  return String(m).trim();
}

/** Normaliza cualquier arreglo de modificadores (JSON o string[]) a string[]. */
export function normalizeModifiers(mods: unknown): string[] {
  if (!Array.isArray(mods)) return [];
  return mods.map((m) => formatModifierLabel(m)).filter((s) => s.length > 0);
}

async function imageToEscPosRasterBase64(url: string, maxWidthPx = 384): Promise<string | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const src = String(url || "").trim();
  if (!src) return null;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      const timeout = window.setTimeout(() => reject(new Error("logo timeout")), 5000);
      image.crossOrigin = "anonymous";
      image.onload = () => {
        window.clearTimeout(timeout);
        resolve(image);
      };
      image.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("logo load error"));
      };
      image.src = src;
    });
    const width = Math.max(8, Math.floor(Math.min(img.naturalWidth || maxWidthPx, maxWidthPx) / 8) * 8);
    const ratio = width / Math.max(1, img.naturalWidth || width);
    const height = Math.max(1, Math.round((img.naturalHeight || width) * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const bytesPerRow = width / 8;
    const raster = new Uint8Array(bytesPerRow * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (a > 64 && lum < 175) raster[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    const bytes = [
      0x1b, 0x61, 0x01,
      0x1d, 0x76, 0x30, 0x00,
      bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
      height & 0xff, (height >> 8) & 0xff,
      ...Array.from(raster),
      0x0a,
      0x1b, 0x61, 0x00,
    ];
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
    }
    return window.btoa(binary);
  } catch (e) {
    console.warn("[print] no se pudo rasterizar logo en cliente", e);
    return null;
  }
}

async function withClientRasterLogo(payload: PrintPayload): Promise<PrintPayload> {
  if (payload.logo_raster_base64 || payload.type === "comanda" || payload.type === "drawer") return payload;
  const primary = payload.logo_url ? await imageToEscPosRasterBase64(payload.logo_url) : null;
  const fallback = !primary && payload.logo_fallback_url ? await imageToEscPosRasterBase64(payload.logo_fallback_url) : null;
  const logo_raster_base64 = primary ?? fallback ?? undefined;
  return logo_raster_base64 ? { ...payload, logo_raster_base64 } : payload;
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
let _printerTargetPromise: Promise<Pick<PrintPayload, "printer_ip" | "printer_port"> | null> | null = null;
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

async function getDefaultPrinterTarget(): Promise<Pick<PrintPayload, "printer_ip" | "printer_port"> | null> {
  if (_printerTargetPromise) return _printerTargetPromise;
  _printerTargetPromise = (async () => {
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("settings")
        .select("cashier_printer_ip,cashier_printer_port")
        .limit(1)
        .maybeSingle();
      const row = data as { cashier_printer_ip?: string | null; cashier_printer_port?: number | null } | null;
      const printer_ip = row?.cashier_printer_ip?.trim();
      return printer_ip ? { printer_ip, printer_port: row?.cashier_printer_port ?? 9100 } : null;
    } catch {
      return null;
    }
  })();
  return _printerTargetPromise;
}

async function withDefaultPrinterTarget(payload: PrintPayload): Promise<PrintPayload> {
  if (payload.printer_ip) return payload;
  const target = await getDefaultPrinterTarget();
  return target?.printer_ip ? { ...payload, ...target } : payload;
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
        DEFAULT_LOCAL_PRINT_URL,
        "http://127.0.0.1:3001/print",
      ]
        .map((u) => normalizePrintUrl(u))
        .filter(Boolean) as string[],
    ),
  );

  const TIMEOUT_MS = 12000;
  // Normalizamos comillas/controles, conservando tildes para que el servidor
  // local las codifique en CP850 antes de enviarlas a la impresora.
  const body = JSON.stringify(sanitizePayloadForPrinter(await withClientRasterLogo(await withDefaultPrinterTarget(payload))));


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

