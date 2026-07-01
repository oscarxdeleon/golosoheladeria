import { createFileRoute, useParams } from "@tanstack/react-router";
import { PublicOrder } from "@/components/public-order";

export const Route = createFileRoute("/s/$slug/menu")({
  head: ({ params }) => ({
    meta: [
      { title: `Menú · ${params.slug} · Goloso` },
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
