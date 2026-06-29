import { createFileRoute, useParams } from "@tanstack/react-router";
import { PublicOrder } from "@/components/public-order";

export const Route = createFileRoute("/s/$slug/kiosk")({
  head: ({ params }) => ({ meta: [{ title: `Auto-pedido · ${params.slug} · Goloso` }] }),
  component: SedeKiosk,
});

function SedeKiosk() {
  const { slug } = useParams({ from: "/s/$slug/kiosk" });
  return <PublicOrder source="kiosk" branchSlug={slug} />;
}
