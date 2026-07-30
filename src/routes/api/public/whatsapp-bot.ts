import { createFileRoute } from "@tanstack/react-router";
import { runBotAction } from "@/lib/bot/engine";

// Ruta pública delgada: toda la lógica vive en `src/lib/bot/engine.ts`
// para poder reutilizarla en proceso desde el webhook de Evolution.

export const Route = createFileRoute("/api/public/whatsapp-bot")({
  server: {
    handlers: {
      OPTIONS: () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }),
      POST: async ({ request }) => runBotAction(request),
    },
  },
});
