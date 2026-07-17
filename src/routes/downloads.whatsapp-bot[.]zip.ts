import { createFileRoute } from "@tanstack/react-router";

const WHATSAPP_BOT_ASSET_URL = "https://golosoheladeria.lovable.app/__l5e/assets-v1/5ade7bec-c0ba-4427-9e00-e782c3522b60/whatsapp-bot.zip";

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