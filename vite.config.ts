// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Detect deploy target: Vercel sets `VERCEL=1` in its build environment.
// Inside Lovable's sandbox, the Cloudflare preset is forced regardless.
const isVercel = process.env.VERCEL === "1" || !!process.env.VERCEL_ENV;

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  ...(isVercel
    ? {
        // Target Vercel's serverless runtime when building on Vercel CI.
        // Without this, Nitro emits a Cloudflare Worker bundle that Vercel
        // cannot invoke → 500 FUNCTION_INVOCATION_FAILED at runtime.
        nitro: { preset: "vercel" },
      }
    : {}),
});
