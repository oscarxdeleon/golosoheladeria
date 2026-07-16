import { useEffect } from "react";

/**
 * Modo kiosco para tablets:
 *  - Fullscreen automático al primer gesto (los navegadores exigen user activation).
 *  - Wake Lock para evitar suspensión de pantalla.
 *  - Bloqueo de menú contextual, arrastre y selección accidental.
 *  - Aviso antes de cerrar la pestaña.
 */
export function useKioskLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const goFullscreen = async () => {
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement
            .requestFullscreen({ navigationUI: "hide" })
            .catch(() => undefined);
        }
      } catch {
        /* noop */
      }
    };

    let wakeLock: { release: () => Promise<void> } | null = null;
    const requestWake = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
        };
        const wl = await nav.wakeLock?.request?.("screen");
        if (wl) wakeLock = wl;
      } catch {
        /* noop */
      }
    };

    const onFirstGesture = () => {
      void goFullscreen();
      void requestWake();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void requestWake();
    };
    const blockContext = (e: Event) => e.preventDefault();
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("pointerdown", onFirstGesture, { once: true });
    window.addEventListener("keydown", onFirstGesture, { once: true });
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("contextmenu", blockContext);
    document.addEventListener("dragstart", blockContext);
    window.addEventListener("beforeunload", beforeUnload);

    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("contextmenu", blockContext);
      document.removeEventListener("dragstart", blockContext);
      window.removeEventListener("beforeunload", beforeUnload);
      void wakeLock?.release?.().catch(() => undefined);
    };
  }, [enabled]);
}

/** Detecta si el kiosco debe activarse: ?kiosk=1, ?src=pwa o display standalone. */
export function isKioskContext(): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  if (url.searchParams.get("kiosk") === "1" || url.searchParams.get("kiosk") === "true") return true;
  if (url.searchParams.get("src") === "pwa") return true;
  try {
    if (window.matchMedia?.("(display-mode: standalone)")?.matches) return true;
    if (window.matchMedia?.("(display-mode: fullscreen)")?.matches) return true;
  } catch {
    /* noop */
  }
  // iOS Safari
  const navAny = navigator as Navigator & { standalone?: boolean };
  if (navAny.standalone) return true;
  return false;
}
