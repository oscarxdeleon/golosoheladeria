import { createFileRoute } from "@tanstack/react-router";
import { PublicOrder } from "@/components/public-order";

export const Route = createFileRoute("/kiosk")({
  head: () => ({ meta: [{ title: "Auto-pedido · Goloso" }] }),
  component: () => <PublicOrder source="kiosk" />,
});
