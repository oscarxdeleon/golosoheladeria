// Registro guardado del service worker. NUNCA registra en:
// - dev / build no-PROD
// - iframe (preview Lovable embebido)
// - hosts de preview (id-preview--*, preview--*, *.lovableproject.com,
//   *.lovableproject-dev.com, *.beta.lovable.dev)
// - `?sw=off` (kill switch manual)
//
// Cuando se rechaza el registro, además desinstala cualquier SW previo
// (`/sw.js`) para que un usuario que instaló en producción y luego abre el
// preview no arrastre un caché obsoleto.

const SW_PATH = "/sw.js";

function isPreviewHost(host: string): boolean {
  if (!host) return false;
  if (host.startsWith("id-preview--") || host.startsWith("preview--")) return true;
  if (host === "lovableproject.com" || host.endsWith(".lovableproject.com")) return true;
  if (host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com")) return true;
  if (host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev")) return true;
  return false;
}

async function unregisterMatchingSW(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      const url = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || "";
      if (url.endsWith(SW_PATH)) {
        await reg.unregister();
      }
    }
  } catch {
    /* noop */
  }
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const isProd = import.meta.env.PROD;
  const inIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();
  const host = window.location.hostname;
  const killSwitch = new URLSearchParams(window.location.search).has("sw") &&
    new URLSearchParams(window.location.search).get("sw") === "off";

  const refuse =
    !isProd || inIframe || isPreviewHost(host) || killSwitch;

  if (refuse) {
    void unregisterMatchingSW();
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(SW_PATH, { scope: "/" })
      .catch((err) => {
        console.warn("[pwa] no se pudo registrar el service worker", err);
      });
  });
}
