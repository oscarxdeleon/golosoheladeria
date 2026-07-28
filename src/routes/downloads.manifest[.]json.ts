import { createFileRoute } from "@tanstack/react-router";
import { BOT_DOWNLOAD_URL, BOT_LATEST_DOWNLOAD_URL, BOT_VERSION } from "@/lib/bot-version";

export const Route = createFileRoute("/downloads/manifest.json")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          {
            app: "Goloso WhatsApp Bot",
            name: "Golosito",
            version: BOT_VERSION,
            zipUrl: BOT_DOWNLOAD_URL,
            latestZipUrl: BOT_LATEST_DOWNLOAD_URL,
            updatedAt: "2026-07-28",
          },
          {
            headers: {
              "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
              Pragma: "no-cache",
            },
          },
        ),
      HEAD: () =>
        new Response(null, {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            Pragma: "no-cache",
          },
        }),
    },
  },
});