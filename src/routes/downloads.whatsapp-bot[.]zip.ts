import { createFileRoute } from "@tanstack/react-router";

const WHATSAPP_BOT_ASSET_URL = "https://golosoheladeria.lovable.app/__l5e/assets-v1/21ea47b7-572c-4115-8e49-408f67317397/whatsapp-bot-v4.zip";

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