// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      VitePWA({
        // El registro lo hace nuestro wrapper con guardas Lovable. No dejar que
        // el plugin inyecte su propio registrador.
        injectRegister: null,
        registerType: "autoUpdate",
        // No emitir service worker en dev/preview — evita cachear HTML del editor.
        devOptions: { enabled: false },
        filename: "sw.js",
        manifest: false, // el manifest se sirve desde public/manifest.webmanifest
        workbox: {
          // Nunca cachear rutas de OAuth ni endpoints de servidor.
          navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//, /^\/_serverFn/],
          // HTML: siempre red primero (autoUpdate + NetworkFirst para navegaciones).
          navigateFallback: null,
          globPatterns: ["**/*.{js,css,ico,png,svg,webp,woff2}"],
          runtimeCaching: [
            {
              // Navegaciones: red primero, fallback a caché para funcionar offline.
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "html-nav",
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 7 },
              },
            },
            {
              // Assets hasheados propios (JS/CSS del bundle).
              urlPattern: ({ request, url }) =>
                url.origin === self.location.origin &&
                (request.destination === "script" || request.destination === "style"),
              handler: "CacheFirst",
              options: {
                cacheName: "assets",
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              // Imágenes/logos de la app.
              urlPattern: ({ request }) => request.destination === "image",
              handler: "CacheFirst",
              options: {
                cacheName: "img",
                expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
      }),
    ],
  },
});
