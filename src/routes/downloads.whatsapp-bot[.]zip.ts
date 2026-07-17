import { createFileRoute } from "@tanstack/react-router";

const WHATSAPP_BOT_ASSET_URL = "/__l5e/assets-v1/38cf1cfb-76aa-4943-806c-cb08f5235652/whatsapp-bot.zip";

export const Route = createFileRoute("/downloads/whatsapp-bot.zip")({
  server: {
    handlers: {
      GET: () =>
        new Response(null, {
          status: 302,
          headers: {
            Location: WHATSAPP_BOT_ASSET_URL,
            "Cache-Control": "no-store",
          },
        }),
      HEAD: () =>
        new Response(null, {
          status: 302,
          headers: {
            Location: WHATSAPP_BOT_ASSET_URL,
            "Cache-Control": "no-store",
          },
        }),
    },
  },
});