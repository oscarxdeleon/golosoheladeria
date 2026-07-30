import { createFileRoute, useParams } from "@tanstack/react-router";
import { PublicOrder } from "@/components/public-order";

export const Route = createFileRoute("/s/$slug/menu")({
  head: ({ params }) => ({
    meta: [
      { title: `Menú · ${params.slug} · Goloso` },
      { name: "description", content: "Mira el menú de Heladería Goloso y haz tu pedido en línea." },
      { property: "og:title", content: "Heladería Goloso — Menú Digital" },
      { property: "og:description", content: "Mira el menú de Heladería Goloso y haz tu pedido en línea." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `https://golosoheladeria.lovable.app/s/${params.slug}/menu` },
      { property: "og:image", content: "https://golosoheladeria.vercel.app/og-menu.jpg?v=3" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://golosoheladeria.vercel.app/og-menu.jpg?v=3" },
      { name: "apple-mobile-web-app-title", content: `Goloso ${params.slug}` },
      { name: "application-name", content: `Goloso ${params.slug}` },
    ],
    links: [
      { rel: "manifest", href: `/s/${params.slug}/manifest.webmanifest` },
    ],
  }),
  component: SedeMenu,
});

function SedeMenu() {
  const { slug } = useParams({ from: "/s/$slug/menu" });
  return <PublicOrder source="online_menu" branchSlug={slug} />;
}
