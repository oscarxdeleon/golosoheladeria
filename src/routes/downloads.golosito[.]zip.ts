import { createFileRoute } from "@tanstack/react-router";
import { BOT_DOWNLOAD_URL } from "@/lib/bot-version";

// URL estable que siempre redirige al ZIP de la última versión publicada
// del chatbot (golosito-vX.Y.Z.zip).
export const Route = createFileRoute("/downloads/golosito.zip")({
  server: {
    handlers: {
      GET: () =>
        new Response(null, {
          status: 302,
          headers: {
            Location: BOT_DOWNLOAD_URL,
            "Cache-Control": "no-store",
          },
        }),
      HEAD: () =>
        new Response(null, {
          status: 302,
          headers: {
            Location: BOT_DOWNLOAD_URL,
            "Cache-Control": "no-store",
          },
        }),
    },
  },
});
