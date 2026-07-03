import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/s/$slug/manifest.webmanifest")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slug = params.slug;
        const url = process.env.SUPABASE_URL!;
        const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const sb = createClient(url, key, { auth: { persistSession: false } });
        const { data: branch } = await sb
          .from("branches")
          .select("name, logo_url")
          .eq("slug", slug)
          .maybeSingle();

        const displayName = branch?.name ? `Goloso · ${branch.name}` : "Goloso";
        const shortName = "Goloso";
        const branchIcon = branch?.logo_url ?? null;

        const icons: Array<Record<string, string>> = [];
        if (branchIcon) {
          icons.push({ src: branchIcon, sizes: "192x192 512x512", type: "image/png", purpose: "any" });
        }
        icons.push(
          { src: "/goloso-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/__l5e/assets-v1/87d5ae2a-93e3-4edd-a1e8-ebf1a5887baf/goloso-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/__l5e/assets-v1/13c29191-80ad-4e50-a93a-c2159a7a4242/goloso-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        );

        const manifest = {
          id: `/s/${slug}/`,
          name: displayName,
          short_name: shortName,
          description: `Pide en línea en ${branch?.name ?? "Heladería Goloso"}.`,
          start_url: `/s/${slug}/menu`,
          scope: `/s/${slug}/`,
          display: "standalone",
          orientation: "portrait",
          background_color: "#0EA5E9",
          theme_color: "#0EA5E9",
          lang: "es-CO",
          categories: ["food", "shopping", "lifestyle"],
          icons,
        };

        return new Response(JSON.stringify(manifest), {
          headers: {
            "Content-Type": "application/manifest+json; charset=utf-8",
            "Cache-Control": "public, max-age=300",
          },
        });
      },
    },
  },
});
