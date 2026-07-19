import { createFileRoute } from "@tanstack/react-router";

const WHATSAPP_BOT_ASSET_URL = "https://golosoheladeria.lovable.app/__l5e/assets-v1/ecd98a16-b7fc-4d5a-a5eb-0076087abf39/whatsapp-bot-v3.zip";

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