import { createFileRoute } from "@tanstack/react-router";

const WHATSAPP_BOT_ASSET_URL = "https://golosoheladeria.lovable.app/__l5e/assets-v1/51f1a2f5-d99a-4494-983f-09ddc93640b9/whatsapp-bot-v2.zip";

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