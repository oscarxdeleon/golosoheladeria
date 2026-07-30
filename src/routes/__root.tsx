import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { reconcileTables } from "@/lib/reconcile-tables";
// Modo offline desactivado — imports conservados como comentario para reactivar rápido.
// import { registerServiceWorker } from "@/lib/pwa-register";
// import { enableOfflineQueryPersistence } from "@/lib/offline-query-persister";
// import { OfflineBanner } from "@/components/offline-banner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  const stack = (error?.stack ?? "").split("\n").slice(0, 8).join("\n");
  const visibleMessage = /Missing Supabase environment variable|SUPABASE_SERVICE_ROLE_KEY/i.test(String(error?.message ?? error ?? ""))
    ? "La aplicación estaba usando una versión anterior. Recarga la página e intenta nuevamente."
    : String(error?.message ?? error ?? "Error desconocido");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-xl text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>

        {/* Detalle técnico visible para diagnóstico rápido. */}
        <details open className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-left">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-destructive">
            Detalle técnico
          </summary>
          <p className="mt-2 text-xs font-medium text-foreground break-words">
            {visibleMessage}
          </p>
          {stack ? (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 text-[11px] leading-snug text-muted-foreground">
{stack}
            </pre>
          ) : null}
        </details>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "google", content: "notranslate" },
      { httpEquiv: "Content-Language", content: "es" },
      { title: "Heladería Goloso — Menú Digital" },
      { name: "description", content: "Explora nuestro menú en línea, helados, toppings y realiza tu pedido en la sede seleccionada." },
      { name: "author", content: "Heladería Goloso" },
      { property: "og:title", content: "Heladería Goloso — Menú Digital" },
      { property: "og:description", content: "Explora nuestro menú en línea, helados, toppings y realiza tu pedido en la sede seleccionada." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Heladería Goloso — Menú Digital" },
      { name: "twitter:description", content: "Explora nuestro menú en línea, helados, toppings y realiza tu pedido en la sede seleccionada." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/lXiF2qokg6SKdOF3jxXyszJlny93/social-images/social-1782620274112-WhatsApp_Image_2026-06-03_at_9.44.10_PM.webp" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/lXiF2qokg6SKdOF3jxXyszJlny93/social-images/social-1782620274112-WhatsApp_Image_2026-06-03_at_9.44.10_PM.webp" },
      { name: "theme-color", content: "#ffffff" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Goloso" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "application-name", content: "Goloso" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // El <link rel="manifest"> se declara por ruta (menú, mesero, quiosco,
      // POS) para que cada PWA instalada abra su propio módulo. No agregar
      // aquí un manifest global: haría que todas las instalaciones abran el
      // menú en línea del cliente.
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Titan+One&family=Fredoka:wght@600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="es" translate="no" className="notranslate">
      <head>
        <HeadContent />
      </head>
      <body translate="no" className="notranslate">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    // Modo offline desactivado temporalmente — el banner "sin conexión" se
    // disparaba por falsos positivos del heartbeat. Reactivar cuando se
    // estabilice la detección de red.
    // enableOfflineQueryPersistence(queryClient);
    // registerServiceWorker();

    // El POS no debe seguir sirviendo bundles antiguos desde un Service Worker
    // previo: eso impide que las plantillas nuevas de impresión lleguen al
    // navegador. Mientras el modo offline está desactivado, se eliminan SW y
    // caches heredados en cada arranque.
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistrations()
        .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
        .catch(() => undefined);
    }
    if (typeof window !== "undefined" && "caches" in window) {
      void window.caches.keys()
        .then((keys) => Promise.all(keys.map((key) => window.caches.delete(key))))
        .catch(() => undefined);
    }
  }, [queryClient]);

  useEffect(() => {
    const invalidateMenu = () => {
      void queryClient.invalidateQueries({ queryKey: ["mod-groups"] });
      void queryClient.invalidateQueries({ queryKey: ["modifier-groups-all"] });
      void queryClient.invalidateQueries({ queryKey: ["mods"] });
      void queryClient.invalidateQueries({ queryKey: ["mods-for"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["products-all"] });
      void queryClient.invalidateQueries({ queryKey: ["public-products"] });
    };

    const channel = supabase
      .channel("menu-modifier-cache-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "modifiers" }, invalidateMenu)
      .on("postgres_changes", { event: "*", schema: "public", table: "modifier_groups" }, invalidateMenu)
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, invalidateMenu)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // Autocorrección de mesas: al iniciar el sistema y al recuperar conexión.
  useEffect(() => {
    let ranOnce = false;
    const run = async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return; // requiere sesión (RPC exige authenticated)
      const fixed = await reconcileTables(null, { silent: true });
      if (fixed > 0) {
        void queryClient.invalidateQueries({ queryKey: ["restaurant_tables"] });
      }
    };
    // Al iniciar (una sola vez)
    if (!ranOnce) {
      ranOnce = true;
      void run();
    }
    const onOnline = () => void run();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      {/* <OfflineBanner /> desactivado — ver useEffect arriba */}
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}
