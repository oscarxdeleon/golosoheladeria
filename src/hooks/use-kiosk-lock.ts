import { useEffect } from "react";

/**
 * Modo kiosco para tablets:
 *  - Fullscreen automático en cualquier gesto del usuario (los navegadores
 *    exigen user activation; no existe forma de saltarse esa restricción).
 *  - Re-solicita fullscreen al volver del background o al salir accidentalmente.
 *  - Wake Lock para evitar suspensión de pantalla.
 *  - Bloqueo de menú contextual, arrastre y selección accidental.
 *  - Aviso antes de cerrar la pestaña.
 *
 * Nota: cuando la app se abre como PWA/APK/TWA o desde un launcher tipo
 * FreeKiosk el navegador ya oculta su barra superior y esta lógica se
 * vuelve innecesaria — igual queda como red de seguridad.
 */
export function useKioskLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const isStandalone = () => {
      try {
        if (window.matchMedia?.("(display-mode: standalone)")?.matches) return true;
        if (window.matchMedia?.("(display-mode: fullscreen)")?.matches) return true;
      } catch {
        /* noop */
      }
      const navAny = navigator as Navigator & { standalone?: boolean };
      return !!navAny.standalone;
    };

    const goFullscreen = async () => {
      if (isStandalone()) return; // ya ocupa toda la pantalla
      if (document.fullscreenElement) return;
      try {
        await document.documentElement
          .requestFullscreen?.({ navigationUI: "hide" })
          .catch(() => undefined);
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

    // Cualquier gesto reintenta fullscreen si aún no lo estamos. Esto cubre
    // el caso en que el usuario salga con la tecla Esc o el gesto del
    // sistema — al tocar la pantalla de nuevo volvemos a modo kiosco.
    const onGesture = () => {
      void goFullscreen();
      void requestWake();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void requestWake();
        // Al volver del background, intentamos fullscreen; muchos navegadores
        // aceptan esta llamada porque la reactivación cuenta como user activation.
        void goFullscreen();
      }
    };
    const blockContext = (e: Event) => e.preventDefault();
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    // Escuchamos siempre (no `once`) para reintentar hasta lograrlo.
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("touchstart", onGesture, { passive: true });
    window.addEventListener("keydown", onGesture);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("contextmenu", blockContext);
    document.addEventListener("dragstart", blockContext);
    window.addEventListener("beforeunload", beforeUnload);

    // Intento inicial (puede fallar sin user activation, pero es gratis probar).
    void goFullscreen();
    void requestWake();

    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("touchstart", onGesture);
      window.removeEventListener("keydown", onGesture);
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
  const navAny = navigator as Navigator & { standalone?: boolean };
  if (navAny.standalone) return true;
  return false;
}
