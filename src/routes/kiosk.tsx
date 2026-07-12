import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { PublicOrder } from "@/components/public-order";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";

const kioskSearch = z.object({
  sede: fallback(z.string().optional(), undefined),
  fullscreen: fallback(z.string().optional(), undefined),
});

export const Route = createFileRoute("/kiosk")({
  validateSearch: zodValidator(kioskSearch),
  head: () => ({
    meta: [{ title: "Auto-pedido · Goloso" }],
    links: [{ rel: "manifest", href: "/manifest-quiosco.webmanifest" }],
  }),
  component: KioskPage,
});

function KioskPage() {
  const { sede, fullscreen } = Route.useSearch();
  useKioskLock(fullscreen === "1" || fullscreen === "true");
  return <PublicOrder source="kiosk" branchSlug={sede} />;
}

/**
 * Bloqueos para modo Quiosco:
 *  - Fullscreen automático al primer gesto (los navegadores exigen user activation).
 *  - Wake Lock para evitar suspensión de pantalla.
 *  - Bloqueo de menú contextual, arrastre y selección accidental.
 *  - Aviso antes de cerrar la pestaña.
 */
function useKioskLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const goFullscreen = async () => {
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
        }
      } catch {
        /* noop */
      }
    };

    let wakeLock: { release: () => Promise<void> } | null = null;
    const requestWake = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } };
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
