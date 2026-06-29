import { createFileRoute, useParams } from "@tanstack/react-router";
import { PublicOrder } from "@/components/public-order";

export const Route = createFileRoute("/s/$slug/menu")({
  head: ({ params }) => ({ meta: [{ title: `Menú · ${params.slug} · Goloso` }] }),
  component: SedeMenu,
});

function SedeMenu() {
  const { slug } = useParams({ from: "/s/$slug/menu" });
  return <PublicOrder source="online_menu" branchSlug={slug} />;
}
